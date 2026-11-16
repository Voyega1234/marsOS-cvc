import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { estimateRun } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  try {
    return NextResponse.json(await estimateRun(ctx))
  } catch (e) {
    console.error('[brand-radar estimate]', errMsg(e))
    return bad('Could not estimate the scan', 500)
  }
}
