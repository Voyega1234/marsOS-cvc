import { NextRequest, NextResponse } from 'next/server'
import { isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { buildOverview, parseFilters } from '@/lib/brand-radar/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  return NextResponse.json(await buildOverview(ctx, parseFilters(sp)))
}
