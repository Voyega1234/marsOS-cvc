import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, errMsg, requireStaff, toRuleLite } from '@/lib/compliance/server'
import { ruleSnapshot } from '@/lib/compliance/engine'
import { STARTER_RULES } from '@/lib/compliance/starter-rules'
import { RULE_EDITOR_ROLES } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!RULE_EDITOR_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = (await req.json().catch(() => ({}))) as { industry?: unknown }
    const industry = typeof body.industry === 'string' ? body.industry : ''
    const starters = Object.prototype.hasOwnProperty.call(STARTER_RULES, industry) ? STARTER_RULES[industry] : undefined
    if (!starters) return NextResponse.json({ error: 'ไม่มีชุดกฎตั้งต้นสำหรับอุตสาหกรรมนี้' }, { status: 400 })

    const existing = await prisma.complianceRule.findMany({
      where: { organizationId: ctx.orgId, industry },
      select: { code: true },
    })
    const have = new Set(existing.map((r) => r.code))
    let created = 0
    let skipped = 0
    for (const s of starters) {
      if (have.has(s.code)) { skipped++; continue }
      const row = await prisma.complianceRule.create({
        data: {
          organizationId: ctx.orgId,
          industry,
          code: s.code,
          title: s.title,
          description: s.description,
          ruleType: s.ruleType,
          terms: JSON.stringify(s.terms),
          severity: s.severity,
          guidance: s.guidance,
          sourceName: s.sourceName,
          version: 1,
          status: 'DRAFT',
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      })
      await prisma.complianceRuleVersion.create({
        data: {
          organizationId: ctx.orgId,
          ruleId: row.id,
          version: 1,
          snapshot: JSON.stringify(ruleSnapshot(toRuleLite(row))),
          changeNote: 'นำเข้าชุดกฎตั้งต้น (ฉบับร่าง)',
          changedById: ctx.userId,
        },
      })
      created++
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'STARTER_IMPORT', detail: { industry, created, skipped } })
    return NextResponse.json({ created, skipped })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
