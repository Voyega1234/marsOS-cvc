import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { usageDaily } from '@/lib/brand-radar/runner'
import { bangkokDay } from '@/lib/brand-radar/insight'
import { parseUsageRange, type UsageDailyDTO } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

// Per-day usage for a chosen date range (Settings > usage summary). Staff only, like /usage.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const ctx = await requireProject(q.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const range = parseUsageRange(q.get('from'), q.get('to'), bangkokDay(new Date()))
  if ('error' in range) return bad(range.error, 400)
  try {
    const body: UsageDailyDTO = { from: range.from, to: range.to, daily: await usageDaily(ctx, range.from, range.to, range.days) }
    return NextResponse.json(body)
  } catch (e) {
    console.error('[brand-radar usage/daily]', errMsg(e))
    return bad('Could not load usage', 500)
  }
}
