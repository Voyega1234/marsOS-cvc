import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, requireStaff } from '@/lib/compliance/server'
import { brandError, loadBrandDetail } from '@/lib/compliance/brand-server'
import { BRAND_PULL_MAX, BRAND_RULES_MAX, sanitizeBrandRuleInput } from '@/lib/compliance/brand'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const brand = await prisma.complianceBrand.findFirst({ where: { id: params.id, organizationId: ctx.orgId }, select: { id: true, name: true } })
    if (!brand) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    const raw = await req.json().catch(() => ({}))
    const body: Record<string, unknown> = raw && typeof raw === 'object' ? raw : {}

    const existing = await prisma.complianceBrandRule.findMany({
      where: { organizationId: ctx.orgId, brandId: brand.id },
      select: { libraryRuleId: true },
    })
    const room = BRAND_RULES_MAX - existing.length

    if (Array.isArray(body.libraryRuleIds)) {
      const requested = Array.from(new Set(body.libraryRuleIds.filter((x): x is string => typeof x === 'string' && x.length > 0)))
      const ids = requested.slice(0, BRAND_PULL_MAX)
      if (!ids.length) return NextResponse.json({ error: 'ยังไม่ได้เลือกกฎ' }, { status: 400 })
      if (room <= 0) return NextResponse.json({ error: `แบรนด์นี้มีกฎครบ ${BRAND_RULES_MAX} ข้อแล้ว` }, { status: 400 })
      const found = await prisma.complianceRule.findMany({
        where: { organizationId: ctx.orgId, id: { in: ids }, status: { not: 'ARCHIVED' } },
        select: { id: true },
      })
      const foundIds = new Set(found.map((r) => r.id))
      const linked = new Set(existing.map((r) => r.libraryRuleId).filter((x): x is string => !!x))
      const fresh = ids.filter((id) => foundIds.has(id) && !linked.has(id))
      const toAdd = fresh.slice(0, room)
      const skipped = requested.length - toAdd.length // รวมส่วนที่เกินเพดานต่อครั้ง
      if (toAdd.length) {
        await prisma.complianceBrandRule.createMany({
          data: toAdd.map((libraryRuleId) => ({
            organizationId: ctx.orgId, brandId: brand.id, libraryRuleId, createdById: ctx.userId, updatedById: ctx.userId,
          })),
          skipDuplicates: true,
        })
        await prisma.complianceBrand.update({ where: { id: brand.id }, data: { updatedById: ctx.userId } })
      }
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_RULE_PULL', detail: { brandId: brand.id, brandName: brand.name, added: toAdd.length, skipped } })
      return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, brand.id), added: toAdd.length, skipped })
    }

    const parsed = sanitizeBrandRuleInput(body)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    if (room <= 0) return NextResponse.json({ error: `แบรนด์นี้มีกฎครบ ${BRAND_RULES_MAX} ข้อแล้ว` }, { status: 400 })
    const { data } = parsed
    const row = await prisma.complianceBrandRule.create({
      data: {
        organizationId: ctx.orgId,
        brandId: brand.id,
        code: data.code,
        title: data.title,
        description: data.description,
        ruleType: data.ruleType,
        terms: JSON.stringify(data.terms),
        severity: data.severity,
        guidance: data.guidance,
        sourceName: data.sourceName,
        status: 'ACTIVE',
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
    })
    await prisma.complianceBrand.update({ where: { id: brand.id }, data: { updatedById: ctx.userId } })
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_RULE_ADD', detail: { brandId: brand.id, brandName: brand.name, ruleId: row.id, title: row.title } })
    return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, brand.id) }, { status: 201 })
  } catch (e) {
    return brandError(e)
  }
}
