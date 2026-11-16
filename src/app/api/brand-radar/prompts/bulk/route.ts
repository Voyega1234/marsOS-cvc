import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { PRIORITIES, type PromptBulkAction } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

const ACTIONS: PromptBulkAction[] = ['activate', 'deactivate', 'reject', 'delete', 'set_priority']

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const action = body.action as PromptBulkAction
  if (!ACTIONS.includes(action)) return bad('Invalid action')
  if (!Array.isArray(body.ids)) return bad('No prompts selected')
  const requested = Array.from(new Set(body.ids.filter((x): x is string => typeof x === 'string' && x !== ''))).slice(0, 2000)
  if (requested.length === 0) return bad('No prompts selected')

  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  // Only ids that belong to this client are touched; foreign ids are silently ignored.
  const owned = await prisma.brandRadarPrompt.findMany({ where: { ...where, id: { in: requested } }, select: { id: true } })
  const ids = owned.map((o) => o.id)
  if (ids.length === 0) return NextResponse.json({ affected: 0 })

  if (action === 'delete') {
    // A deleted prompt takes its collected answers with it so no orphan data keeps counting.
    const [, , , r] = await prisma.$transaction([
      prisma.brandRadarCitation.deleteMany({ where: { ...where, promptId: { in: ids } } }),
      prisma.brandRadarMention.deleteMany({ where: { ...where, promptId: { in: ids } } }),
      prisma.brandRadarResponse.deleteMany({ where: { ...where, promptId: { in: ids } } }),
      prisma.brandRadarPrompt.deleteMany({ where: { ...where, id: { in: ids } } }),
    ])
    return NextResponse.json({ affected: r.count })
  }
  let data: { status?: string; priority?: string }
  if (action === 'set_priority') {
    if (typeof body.priority !== 'string' || !(PRIORITIES as readonly string[]).includes(body.priority)) return bad('Invalid priority')
    data = { priority: body.priority }
  } else {
    data = { status: action === 'activate' ? 'ACTIVE' : action === 'deactivate' ? 'INACTIVE' : 'REJECTED' }
  }
  const r = await prisma.brandRadarPrompt.updateMany({ where: { ...where, id: { in: ids } }, data })
  return NextResponse.json({ affected: r.count })
}
