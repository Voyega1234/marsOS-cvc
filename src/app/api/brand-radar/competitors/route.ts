import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { toCompetitorDTO } from '@/lib/brand-radar/queries'
import { cleanCompetitorInput } from '@/lib/brand-radar/profile-input'
import { nameKey } from '@/lib/brand-radar/normalize'
import { LIMITS } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const clean = cleanCompetitorInput(body)
  if (!clean.ok) return bad(clean.error)
  const d = clean.data
  if (!d.name) return bad('Competitor name is required')

  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const count = await prisma.brandRadarCompetitor.count({ where })
  if (count >= LIMITS.competitorsMax) return bad(`A client can track at most ${LIMITS.competitorsMax} competitors`)
  const key = nameKey(d.name)
  if (await prisma.brandRadarCompetitor.findFirst({ where: { ...where, nameKey: key } })) return bad('This competitor already exists', 409)

  const created = await prisma.brandRadarCompetitor.create({
    data: {
      ...where, name: d.name, nameKey: key,
      aliases: JSON.stringify(d.aliases ?? []), domains: JSON.stringify(d.domains ?? []),
      status: d.status ?? 'ACTIVE', createdById: ctx.userId,
    },
  })
  return NextResponse.json({ competitor: toCompetitorDTO(created) })
}
