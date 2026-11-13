import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, errMsg, requireStaff, toRuleLite } from '@/lib/compliance/server'
import { sanitizeRuleInput } from '@/lib/compliance/rule-input'
import { ruleSnapshot } from '@/lib/compliance/engine'
import { RULE_EDITOR_ROLES } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const sp = req.nextUrl.searchParams
    const industry = sp.get('industry')?.trim()
    const status = sp.get('status')?.trim()
    const rows = await prisma.complianceRule.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(industry ? { industry } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return NextResponse.json({
      rules: rows.map((r) => ({ ...toRuleLite(r), status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!RULE_EDITOR_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const { data, error } = sanitizeRuleInput(body && typeof body === 'object' ? body : {})
    if (error) return NextResponse.json({ error }, { status: 400 })
    if (!data.industry) return NextResponse.json({ error: 'ต้องระบุอุตสาหกรรม' }, { status: 400 })
    if (!data.title) return NextResponse.json({ error: 'ต้องระบุชื่อกฎ' }, { status: 400 })

    const row = await prisma.complianceRule.create({
      data: {
        organizationId: ctx.orgId,
        industry: data.industry,
        code: data.code ?? '',
        title: data.title,
        description: data.description ?? '',
        ruleType: data.ruleType ?? 'PROHIBITED_TERM',
        terms: JSON.stringify(data.terms ?? []),
        severity: data.severity ?? 'MEDIUM',
        guidance: data.guidance ?? '',
        sourceName: data.sourceName ?? '',
        sourceUrl: data.sourceUrl ?? '',
        sourceRef: data.sourceRef ?? '',
        effectiveDate: data.effectiveDate ?? null,
        version: 1,
        status: 'DRAFT',
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
    })
    const lite = toRuleLite(row)
    await prisma.complianceRuleVersion.create({
      data: {
        organizationId: ctx.orgId,
        ruleId: row.id,
        version: 1,
        snapshot: JSON.stringify(ruleSnapshot(lite)),
        changeNote: 'สร้างกฎ',
        changedById: ctx.userId,
      },
    })
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'RULE_CREATE', ruleId: row.id, detail: { code: row.code, title: row.title, industry: row.industry } })
    return NextResponse.json({ rule: { ...lite, status: row.status } }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
