import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { stepRun } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  try {
    const r = await stepRun({ orgId: ctx.orgId, userId: ctx.userId, projectId: ctx.project.id }, params.id)
    if (!r) return bad('Run not found', 404)
    return NextResponse.json(r)
  } catch (e) {
    console.error('[brand-radar step]', errMsg(e))
    return bad('Could not process the scan step', 500)
  }
}
