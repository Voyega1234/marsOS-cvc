import { NextRequest, NextResponse } from 'next/server'
import { isRadarCtx, requireProjectReader } from '@/lib/brand-radar/server'
import { buildAnswerFeed, parseFilters } from '@/lib/brand-radar/queries'
import { ANSWER_MENTION_FILTERS, type AnswerMentionFilter } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

/** Result-first report: how often AI answers name the brand and the competitors, plus the answers themselves. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProjectReader(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const raw = sp.get('mention') ?? ''
  const mention = (ANSWER_MENTION_FILTERS as readonly string[]).includes(raw) ? (raw as AnswerMentionFilter) : 'all'
  const num = (k: string): number | undefined => {
    const n = Number(sp.get(k))
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  return NextResponse.json(
    await buildAnswerFeed(ctx, parseFilters(sp), {
      mention,
      q: (sp.get('q') ?? '').slice(0, 200),
      page: num('page'),
      pageSize: num('pageSize'),
    }),
  )
}
