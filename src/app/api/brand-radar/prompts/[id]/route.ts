import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { toPromptDTO } from '@/lib/brand-radar/queries'
import { cleanPromptPatch } from '@/lib/brand-radar/prompt-input'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const row = await prisma.brandRadarPrompt.findFirst({ where: { ...where, id: params.id } })
  if (!row) return bad('Prompt not found', 404)

  const clean = cleanPromptPatch(body)
  if (!clean.ok) return bad(clean.reason)
  const data = clean.data
  if (data.textKey && data.textKey !== row.textKey) {
    const clash = await prisma.brandRadarPrompt.findFirst({ where: { ...where, textKey: data.textKey, NOT: { id: row.id } }, select: { id: true } })
    if (clash) return bad('Another prompt with the same text already exists', 409)
  }
  const updated = await prisma.brandRadarPrompt.update({ where: { id: row.id }, data })
  return NextResponse.json({ prompt: toPromptDTO(updated) })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireProject(req.nextUrl.searchParams.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const row = await prisma.brandRadarPrompt.findFirst({ where: { ...where, id: params.id }, select: { id: true } })
  if (!row) return bad('Prompt not found', 404)
  await prisma.$transaction([
    prisma.brandRadarCitation.deleteMany({ where: { ...where, promptId: row.id } }),
    prisma.brandRadarMention.deleteMany({ where: { ...where, promptId: row.id } }),
    prisma.brandRadarResponse.deleteMany({ where: { ...where, promptId: row.id } }),
    prisma.brandRadarPrompt.delete({ where: { id: row.id } }),
  ])
  return NextResponse.json({ ok: true })
}
