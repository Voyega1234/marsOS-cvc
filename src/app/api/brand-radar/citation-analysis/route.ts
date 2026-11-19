import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { parseFilters } from '@/lib/brand-radar/queries'
import { buildCitationAnalysis } from '@/lib/brand-radar/citation-analysis'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  try {
    return NextResponse.json(await buildCitationAnalysis(ctx, parseFilters(sp)))
  } catch (e) {
    console.error('[brand-radar citation-analysis]', errMsg(e))
    return bad('Citation analysis failed', 500)
  }
}
