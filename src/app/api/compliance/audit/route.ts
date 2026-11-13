import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errMsg, parseJsonObject, requireStaff, userNames } from '@/lib/compliance/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const rows = await prisma.complianceAuditLog.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const names = await userNames(rows.map((r) => r.actorId))
    return NextResponse.json({
      logs: rows.map((r) => ({
        id: r.id,
        action: r.action,
        checkId: r.checkId,
        ruleId: r.ruleId,
        detail: parseJsonObject(r.detail),
        actorId: r.actorId,
        actorName: names.get(r.actorId) ?? '',
        createdAt: r.createdAt,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
