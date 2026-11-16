/**
 * GET /api/brand-radar/prompts/[id]/responses?projectId=&runId=&provider=&from=&to=&country=&language=
 * Full-answer viewer: every repeat ask of one prompt for one run + AI platform, with names and cited pages.
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildResponseViewer, parseFilters } from '@/lib/brand-radar/queries'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const res = await buildResponseViewer(ctx, parseFilters(sp), params.id, sp.get('runId'), sp.get('viewProvider'))
  if (!res) return bad('Prompt not found', 404)
  return NextResponse.json(res)
}
