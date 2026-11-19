import { NextRequest, NextResponse } from 'next/server'
import { isRadarCtx, requireProjectReader } from '@/lib/brand-radar/server'
import { buildCompetitorInsights, parseFilters } from '@/lib/brand-radar/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProjectReader(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  return NextResponse.json(await buildCompetitorInsights(ctx, parseFilters(sp)))
}
