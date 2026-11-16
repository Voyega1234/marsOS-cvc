import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { toCompetitorDTO } from '@/lib/brand-radar/queries'
import { cleanCompetitorInput } from '@/lib/brand-radar/profile-input'
import { nameKey } from '@/lib/brand-radar/normalize'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const row = await prisma.brandRadarCompetitor.findFirst({ where: { ...where, id: params.id } })
  if (!row) return bad('Competitor not found', 404)

  const clean = cleanCompetitorInput(body)
  if (!clean.ok) return bad(clean.error)
  const d = clean.data
  let key: string | undefined
  if (d.name !== undefined) {
    key = nameKey(d.name)
    if (key !== row.nameKey && (await prisma.brandRadarCompetitor.findFirst({ where: { ...where, nameKey: key } }))) {
      return bad('This competitor already exists', 409)
    }
  }
  const updated = await prisma.brandRadarCompetitor.update({
    where: { id: row.id },
    data: {
      ...(d.name !== undefined ? { name: d.name, nameKey: key as string } : {}),
      ...(d.aliases ? { aliases: JSON.stringify(d.aliases) } : {}),
      ...(d.domains ? { domains: JSON.stringify(d.domains) } : {}),
      ...(d.status ? { status: d.status } : {}),
    },
  })
  return NextResponse.json({ competitor: toCompetitorDTO(updated) })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireProject(req.nextUrl.searchParams.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const row = await prisma.brandRadarCompetitor.findFirst({ where: { ...where, id: params.id }, select: { id: true } })
  if (!row) return bad('Competitor not found', 404)
  await prisma.brandRadarCompetitor.delete({ where: { id: row.id } })
  return NextResponse.json({ ok: true })
}
