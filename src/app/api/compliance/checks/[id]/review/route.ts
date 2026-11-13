import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, errMsg, parseJsonArray, requireStaff, userNames } from '@/lib/compliance/server'
import { REVIEWER_ROLES } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'

const DECISIONS = ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!REVIEWER_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = (await req.json().catch(() => ({}))) as { decision?: unknown; note?: unknown }
    const decision = typeof body.decision === 'string' ? body.decision : ''
    if (!DECISIONS.includes(decision)) return NextResponse.json({ error: 'decision ไม่ถูกต้อง' }, { status: 400 })
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''

    const check = await prisma.complianceCheck.findFirst({ where: { id: params.id, organizationId: ctx.orgId } })
    if (!check) return NextResponse.json({ error: 'ไม่พบผลตรวจ' }, { status: 404 })
    if (decision === 'APPROVED' && (check.riskLevel === 'CRITICAL' || check.riskLevel === 'HIGH') && note.length < 10) {
      return NextResponse.json({ error: 'การอนุมัติผลตรวจที่มีความเสี่ยงสูง/วิกฤต ต้องเขียนเหตุผลอย่างน้อย 10 ตัวอักษร' }, { status: 400 })
    }

    const row = await prisma.complianceCheck.update({
      where: { id: check.id },
      data: { status: decision, reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note },
    })
    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, action: 'CHECK_REVIEW', checkId: row.id,
      detail: { decision, riskLevel: row.riskLevel, note },
    })
    const names = await userNames([row.createdById, row.reviewedById])
    return NextResponse.json({
      check: {
        ...row,
        findings: parseJsonArray(row.findings),
        rulesSnapshot: parseJsonArray(row.rulesSnapshot),
        createdByName: names.get(row.createdById) ?? '',
        reviewedByName: row.reviewedById ? names.get(row.reviewedById) ?? '' : '',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
