import { NextRequest, NextResponse } from 'next/server'
import { isRadarCtx, requireProjectReader } from '@/lib/brand-radar/server'
import { buildCitations, parseFilters } from '@/lib/brand-radar/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProjectReader(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const res = await buildCitations(ctx, parseFilters(sp), {
    view: sp.get('view') ?? undefined,
    q: sp.get('q') ?? undefined,
    competitorId: sp.get('competitorId') ?? undefined,
    page: Number(sp.get('page')) || 1,
    pageSize: Number(sp.get('pageSize')) || 50,
    vendorOnly: sp.get('vendorOnly') === '1',
  })
  return NextResponse.json(res)
}
