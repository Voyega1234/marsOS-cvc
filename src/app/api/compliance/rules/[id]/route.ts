import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, errMsg, parseJsonObject, requireStaff, toRuleLite, userNames } from '@/lib/compliance/server'
import { CONTENT_FIELDS, sanitizeRuleInput } from '@/lib/compliance/rule-input'
import { activationProblems, ruleSnapshot } from '@/lib/compliance/engine'
import { RULE_EDITOR_ROLES } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'

const STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED']

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const row = await prisma.complianceRule.findFirst({ where: { id: params.id, organizationId: ctx.orgId } })
    if (!row) return NextResponse.json({ error: 'ไม่พบกฎ' }, { status: 404 })
    const versions = await prisma.complianceRuleVersion.findMany({
      where: { organizationId: ctx.orgId, ruleId: row.id },
      orderBy: { version: 'desc' },
    })
    const names = await userNames(versions.map((v) => v.changedById))
    return NextResponse.json({
      rule: { ...toRuleLite(row), status: row.status },
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        changeNote: v.changeNote,
        changedBy: names.get(v.changedById) ?? '',
        createdAt: v.createdAt,
        snapshot: parseJsonObject(v.snapshot),
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!RULE_EDITOR_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const existing = await prisma.complianceRule.findFirst({ where: { id: params.id, organizationId: ctx.orgId } })
    if (!existing) return NextResponse.json({ error: 'ไม่พบกฎ' }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const { data, error } = sanitizeRuleInput(body)
    if (error) return NextResponse.json({ error }, { status: 400 })
    if (data.industry === '') return NextResponse.json({ error: 'ต้องระบุอุตสาหกรรม' }, { status: 400 })
    if (data.title === '') return NextResponse.json({ error: 'ต้องระบุชื่อกฎ' }, { status: 400 })

    const before = toRuleLite(existing)
    const changedFields = CONTENT_FIELDS.filter((f) => {
      if (!(f in data)) return false
      const next = (data as Record<string, unknown>)[f]
      if (f === 'effectiveDate') {
        const nv = next instanceof Date ? next.toISOString().slice(0, 10) : null
        return nv !== before.effectiveDate
      }
      return JSON.stringify(next) !== JSON.stringify((before as unknown as Record<string, unknown>)[f])
    })

    let nextStatus: string | undefined
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) return NextResponse.json({ error: 'สถานะไม่ถูกต้อง' }, { status: 400 })
      if (body.status !== existing.status) nextStatus = body.status
    }

    const update: Record<string, unknown> = {}
    for (const f of changedFields) {
      const v = (data as Record<string, unknown>)[f]
      update[f] = f === 'terms' ? JSON.stringify(v ?? []) : v
    }

    if ((nextStatus ?? existing.status) === 'ACTIVE' && (nextStatus || changedFields.length)) {
      // ตรวจกับค่าหลังแก้ (ถ้าแก้ field พร้อมกัน)
      const merged = { ...before, ...(data as Record<string, unknown>) } as Record<string, unknown>
      const problems = activationProblems({
        title: String(merged.title ?? ''),
        sourceName: String(merged.sourceName ?? ''),
        effectiveDate: merged.effectiveDate instanceof Date ? merged.effectiveDate.toISOString() : (merged.effectiveDate as string | null),
        ruleType: String(merged.ruleType ?? ''),
        terms: Array.isArray(merged.terms) ? (merged.terms as string[]) : [],
      })
      if (problems.length) return NextResponse.json({ error: 'เปิดใช้กฎไม่ได้ — ข้อมูลยังไม่ครบ', problems }, { status: 400 })
    }

    if (!changedFields.length && !nextStatus) {
      return NextResponse.json({ rule: { ...before, status: existing.status } })
    }

    const bump = changedFields.length > 0
    const row = await prisma.complianceRule.update({
      where: { id: existing.id },
      data: {
        ...update,
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(bump ? { version: existing.version + 1 } : {}),
        updatedById: ctx.userId,
      },
    })
    const lite = toRuleLite(row)
    const changeNote = typeof body.changeNote === 'string' ? body.changeNote.trim().slice(0, 500) : ''
    if (bump) {
      await prisma.complianceRuleVersion.create({
        data: {
          organizationId: ctx.orgId,
          ruleId: row.id,
          version: row.version,
          snapshot: JSON.stringify(ruleSnapshot(lite)),
          changeNote,
          changedById: ctx.userId,
        },
      })
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'RULE_UPDATE', ruleId: row.id, detail: { fields: changedFields, version: row.version, changeNote } })
    }
    if (nextStatus) {
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'RULE_STATUS', ruleId: row.id, detail: { from: existing.status, to: nextStatus, code: row.code } })
    }
    return NextResponse.json({ rule: { ...lite, status: row.status } })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}

/** ไม่ลบจริง — ตั้งเป็น ARCHIVED */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!RULE_EDITOR_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const existing = await prisma.complianceRule.findFirst({ where: { id: params.id, organizationId: ctx.orgId } })
    if (!existing) return NextResponse.json({ error: 'ไม่พบกฎ' }, { status: 404 })
    if (existing.status !== 'ARCHIVED') {
      await prisma.complianceRule.update({ where: { id: existing.id }, data: { status: 'ARCHIVED', updatedById: ctx.userId } })
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'RULE_STATUS', ruleId: existing.id, detail: { from: existing.status, to: 'ARCHIVED', code: existing.code } })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
