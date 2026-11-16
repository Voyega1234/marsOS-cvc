import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, errMsg, requireStaff, toRuleLite } from '@/lib/compliance/server'
import { activationProblems, ruleSnapshot } from '@/lib/compliance/engine'
import { STARTER_RULES, starterEffectiveDate } from '@/lib/compliance/starter-rules'
import { RULE_EDITOR_ROLES } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * นำเข้าชุดกฎตั้งต้น — industry = key ของอุตสาหกรรม หรือ "all" (ทุกอุตสาหกรรมที่มีชุดกฎ)
 * กฎที่มีแหล่งอ้างอิงยืนยันแล้ว + วันที่มีผลบังคับใช้ จะเปิดใช้ (ACTIVE) ทันที
 * กฎที่แหล่งอ้างอิงยังขึ้นต้นด้วย "(ต้องยืนยัน)" จะเป็นฉบับร่าง (DRAFT) เหมือนเดิม
 * ไม่แตะกฎที่มีรหัสเดียวกันอยู่แล้ว
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!RULE_EDITOR_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = (await req.json().catch(() => ({}))) as { industry?: unknown }
    const industry = typeof body.industry === 'string' ? body.industry : ''
    const targets = industry === 'all'
      ? Object.keys(STARTER_RULES)
      : Object.prototype.hasOwnProperty.call(STARTER_RULES, industry) ? [industry] : []
    if (!targets.length) return NextResponse.json({ error: 'ไม่มีชุดกฎตั้งต้นสำหรับอุตสาหกรรมนี้' }, { status: 400 })

    const existing = await prisma.complianceRule.findMany({
      where: { organizationId: ctx.orgId, industry: { in: targets } },
      select: { industry: true, code: true },
    })
    const have = new Set(existing.map((r) => `${r.industry}::${r.code}`))
    let created = 0
    let skipped = 0
    let activated = 0
    let drafts = 0
    for (const key of targets) {
      for (const s of STARTER_RULES[key]) {
        if (have.has(`${key}::${s.code}`)) { skipped++; continue }
        const effectiveDate = starterEffectiveDate(s)
        const ready = activationProblems({
          title: s.title,
          sourceName: s.sourceName,
          effectiveDate,
          ruleType: s.ruleType,
          terms: s.terms,
        }).length === 0
        const row = await prisma.complianceRule.create({
          data: {
            organizationId: ctx.orgId,
            industry: key,
            code: s.code,
            title: s.title,
            description: s.description,
            ruleType: s.ruleType,
            terms: JSON.stringify(s.terms),
            severity: s.severity,
            guidance: s.guidance,
            sourceName: s.sourceName,
            sourceUrl: s.sourceUrl ?? '',
            sourceRef: s.sourceRef ?? '',
            effectiveDate,
            version: 1,
            status: ready ? 'ACTIVE' : 'DRAFT',
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
            changeNote: ready ? 'นำเข้าชุดกฎตั้งต้น (เปิดใช้)' : 'นำเข้าชุดกฎตั้งต้น (ฉบับร่าง)',
            changedById: ctx.userId,
          },
        })
        created++
        if (ready) activated++
        else drafts++
      }
    }
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'STARTER_IMPORT',
      detail: { industry, industries: targets, created, activated, drafts, skipped },
    })
    return NextResponse.json({ created, skipped, activated, drafts })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
