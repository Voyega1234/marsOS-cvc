import { NextRequest, NextResponse } from 'next/server'
import { isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { buildPromptRows, parseFilters } from '@/lib/brand-radar/queries'
import { promptsToCsv } from '@/lib/brand-radar/prompts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const rows = await buildPromptRows(ctx, parseFilters(sp), {
    status: sp.get('status') ?? undefined,
    source: sp.get('source') ?? undefined,
    intent: sp.get('intent') ?? undefined,
    topic: sp.get('topic') ?? undefined,
    q: sp.get('q') ?? undefined,
    sort: sp.get('sort') ?? undefined,
  })
  const csv = promptsToCsv(rows) // starts with a UTF-8 BOM so Excel reads Thai correctly
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="brand-radar-prompts.csv"',
      'Cache-Control': 'no-store',
    },
  })
}
