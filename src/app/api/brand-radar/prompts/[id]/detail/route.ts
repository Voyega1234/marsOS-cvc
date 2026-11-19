import { NextRequest, NextResponse } from 'next/server'
import { bad, isRadarCtx, requireProjectReader } from '@/lib/brand-radar/server'
import { buildPromptDetail, parseFilters } from '@/lib/brand-radar/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProjectReader(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const res = await buildPromptDetail(ctx, parseFilters(sp), params.id, sp.get('vendorOnly') === '1')
  if (!res) return bad('Prompt not found', 404)
  return NextResponse.json(res)
}
