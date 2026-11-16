import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { cronTick } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
    return NextResponse.json(await cronTick(240_000))
  } catch (e) {
    console.error('[brand-radar cron]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
