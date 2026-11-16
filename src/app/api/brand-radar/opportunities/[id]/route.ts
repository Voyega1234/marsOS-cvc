import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { toOpportunityDTO } from '@/lib/brand-radar/queries'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const status = body.status
  if (status !== 'OPEN' && status !== 'DISMISSED' && status !== 'DONE') return bad('Invalid status')
  const row = await prisma.brandRadarOpportunity.findFirst({
    where: { id: params.id, organizationId: ctx.orgId, projectId: ctx.project.id }, select: { id: true },
  })
  if (!row) return bad('Opportunity not found', 404)
  const updated = await prisma.brandRadarOpportunity.update({ where: { id: row.id }, data: { status } })
  return NextResponse.json({ opportunity: toOpportunityDTO(updated) })
}
