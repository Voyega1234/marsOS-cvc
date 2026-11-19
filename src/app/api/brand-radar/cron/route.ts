import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { cronTick } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'
// One scan step can take about 300 s in the worst case (provider 130 s + sentiment 30 s + grouping 45 s +
// two closing sweeps of 45 s). A step that is cut off loses answers that were already paid for, so the
// last step has to start early enough to finish inside this limit: START_WINDOW_MS + 300 s < 800 s.
export const maxDuration = 800
const START_WINDOW_MS = 420_000

function tokenMatches(header: string, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(header)
  if (got.length !== expected.length) return false
  return timingSafeEqual(got, expected)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 })
  if (!tokenMatches(req.headers.get('authorization') || '', secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await cronTick(START_WINDOW_MS))
  } catch (e) {
    console.error('[brand-radar cron]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
