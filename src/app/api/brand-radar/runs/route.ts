import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { getRunDTO, listRuns, startRun } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  try {
    return NextResponse.json(await listRuns(ctx, Number(sp.get('page')) || 1, Number(sp.get('pageSize')) || 20))
  } catch (e) {
    console.error('[brand-radar runs GET]', errMsg(e))
    return bad('Could not load runs', 500)
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  try {
    const r = await startRun(ctx, 'manual')
    if (r.kind === 'blocked') return bad(r.reason, 400)
    const run = await getRunDTO(ctx, r.run.id)
    if (r.kind === 'conflict') return NextResponse.json({ error: 'A scan is already running for this client', run }, { status: 409 })
    return NextResponse.json({ run })
  } catch (e) {
    console.error('[brand-radar runs POST]', errMsg(e))
    return bad('Could not start the scan', 500)
  }
}
