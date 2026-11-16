import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { cancelRun } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  try {
    const run = await cancelRun(ctx, params.id)
    if (!run) return bad('Run not found', 404)
    return NextResponse.json({ run })
  } catch (e) {
    console.error('[brand-radar cancel]', errMsg(e))
    return bad('Could not cancel the scan', 500)
  }
}
