import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errMsg, parseJsonArray, requireStaff, userNames } from '@/lib/compliance/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const row = await prisma.complianceCheck.findFirst({ where: { id: params.id, organizationId: ctx.orgId } })
    if (!row) return NextResponse.json({ error: 'ไม่พบผลตรวจ' }, { status: 404 })
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
