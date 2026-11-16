import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { runDue } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  try {
    return NextResponse.json(await runDue(ctx))
  } catch (e) {
    console.error('[brand-radar due]', errMsg(e))
    return bad('Could not check the schedule', 500)
  }
}
