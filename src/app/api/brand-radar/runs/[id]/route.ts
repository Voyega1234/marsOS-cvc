import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { getRunDetail } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireProject(req.nextUrl.searchParams.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  try {
    const d = await getRunDetail(ctx, params.id)
    if (!d) return bad('Run not found', 404)
    return NextResponse.json(d)
  } catch (e) {
    console.error('[brand-radar run GET]', errMsg(e))
    return bad('Could not load the run', 500)
  }
}
