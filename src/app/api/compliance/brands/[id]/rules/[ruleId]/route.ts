import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, parseTermsJson, requireStaff } from '@/lib/compliance/server'
import { brandError, loadBrandDetail } from '@/lib/compliance/brand-server'
import { sanitizeBrandRuleInput } from '@/lib/compliance/brand'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string; ruleId: string } }

const CONTENT_KEYS = ['title', 'description', 'terms', 'ruleType', 'severity', 'guidance', 'code', 'sourceName'] as const

async function findRule(orgId: string, brandId: string, ruleId: string) {
  const brand = await prisma.complianceBrand.findFirst({ where: { id: brandId, organizationId: orgId }, select: { id: true, name: true } })
  if (!brand) return { brand: null, rule: null }
  const rule = await prisma.complianceBrandRule.findFirst({ where: { id: ruleId, organizationId: orgId, brandId } })
  return { brand, rule }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const { brand, rule } = await findRule(ctx.orgId, params.id, params.ruleId)
    if (!brand) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    if (!rule) return NextResponse.json({ error: 'ไม่พบกฎ' }, { status: 404 })
    const raw = await req.json().catch(() => ({}))
    const body: Record<string, unknown> = raw && typeof raw === 'object' ? raw : {}
    const hasContent = CONTENT_KEYS.some((k) => k in body)

    if (rule.libraryRuleId && hasContent) {
      return NextResponse.json({ error: 'กฎที่ดึงจากคลังกฎ แก้เนื้อหาได้ที่คลังกฎเท่านั้น' }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    let status: string | undefined
    if (body.status === 'ACTIVE' || body.status === 'INACTIVE') {
      if (body.status !== rule.status) data.status = body.status
      status = body.status
    }

    let contentChanged = false
    if (!rule.libraryRuleId && hasContent) {
      const merged = {
        code: rule.code, title: rule.title, description: rule.description, ruleType: rule.ruleType,
        terms: parseTermsJson(rule.terms), severity: rule.severity, guidance: rule.guidance, sourceName: rule.sourceName,
        ...Object.fromEntries(CONTENT_KEYS.filter((k) => k in body).map((k) => [k, body[k]])),
      }
      const parsed = sanitizeBrandRuleInput(merged)
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
      const d = parsed.data
      const termsJson = JSON.stringify(d.terms)
      contentChanged =
        d.code !== rule.code || d.title !== rule.title || d.description !== rule.description || d.ruleType !== rule.ruleType ||
        termsJson !== JSON.stringify(parseTermsJson(rule.terms)) || d.severity !== rule.severity || d.guidance !== rule.guidance ||
        d.sourceName !== rule.sourceName
      if (contentChanged) {
        Object.assign(data, {
          code: d.code, title: d.title, description: d.description, ruleType: d.ruleType, terms: termsJson,
          severity: d.severity, guidance: d.guidance, sourceName: d.sourceName, version: rule.version + 1,
        })
      }
    }

    if (Object.keys(data).length) {
      await prisma.complianceBrandRule.update({ where: { id: rule.id }, data: { ...data, updatedById: ctx.userId } })
      await prisma.complianceBrand.update({ where: { id: brand.id }, data: { updatedById: ctx.userId } })
      await audit({
        orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_RULE_UPDATE',
        detail: { brandId: brand.id, brandName: brand.name, ruleId: rule.id, ...(status ? { status } : {}), contentChanged },
      })
    }
    return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, brand.id) })
  } catch (e) {
    return brandError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const { brand, rule } = await findRule(ctx.orgId, params.id, params.ruleId)
    if (!brand) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    if (!rule) return NextResponse.json({ error: 'ไม่พบกฎ' }, { status: 404 })
    await prisma.complianceBrandRule.delete({ where: { id: rule.id } })
    await prisma.complianceBrand.update({ where: { id: brand.id }, data: { updatedById: ctx.userId } })
    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_RULE_REMOVE',
      detail: { brandId: brand.id, brandName: brand.name, ruleId: rule.id, libraryRuleId: rule.libraryRuleId, title: rule.title },
    })
    return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, brand.id) })
  } catch (e) {
    return brandError(e)
  }
}
