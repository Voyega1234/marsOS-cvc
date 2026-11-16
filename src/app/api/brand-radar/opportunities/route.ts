import { NextRequest, NextResponse } from 'next/server'
import { isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { buildOpportunityList } from '@/lib/brand-radar/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const res = await buildOpportunityList(ctx, {
    type: sp.get('type') ?? undefined,
    status: sp.get('status') ?? undefined,
    page: Number(sp.get('page')) || 1,
    pageSize: Number(sp.get('pageSize')) || 25,
  })
  return NextResponse.json(res)
}
