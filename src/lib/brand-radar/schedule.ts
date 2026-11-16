/**
 * Brand Radar — schedule helpers. Server-only (uses node:crypto).
 * All period boundaries are Asia/Bangkok, fixed offset +07:00 (no DST).
 */
import { createHash } from 'node:crypto'
import type { Schedule } from './types'

const OFFSET_MS = 7 * 3600_000
const DAY_MS = 86_400_000

interface Local { y: number; m: number; d: number }

/** Calendar date in Bangkok (m is 1-12). */
function bangkokDate(at: Date): Local {
  const b = new Date(at.getTime() + OFFSET_MS)
  return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate() }
}

/** Instant of 00:00 Bangkok on the given calendar date (overflowing days/months are normalised). */
function bangkokMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS)
}

const p2 = (n: number) => String(n).padStart(2, '0')

function isoWeek(l: Local): { year: number; week: number } {
  const date = new Date(Date.UTC(l.y, l.m - 1, l.d))
  const dayNum = (date.getUTCDay() + 6) % 7 // Monday = 0
  const thursday = new Date(date.getTime() - dayNum * DAY_MS + 3 * DAY_MS)
  const year = thursday.getUTCFullYear()
  const yearStart = Date.UTC(year, 0, 1)
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7)
  return { year, week }
}

export function periodKey(schedule: Schedule, at: Date): string | null {
  const l = bangkokDate(at)
  switch (schedule) {
    case 'manual': return null
    case 'daily': return `${l.y}-${p2(l.m)}-${p2(l.d)}`
    case 'weekly': {
      const w = isoWeek(l)
      return `${w.year}-W${p2(w.week)}`
    }
    case 'monthly': return `${l.y}-${p2(l.m)}`
  }
}

export function nextRunAfter(schedule: Schedule, at: Date): Date | null {
  const l = bangkokDate(at)
  switch (schedule) {
    case 'manual': return null
    case 'daily': return bangkokMidnight(l.y, l.m, l.d + 1)
    case 'weekly': {
      const dow = (new Date(Date.UTC(l.y, l.m - 1, l.d)).getUTCDay() + 6) % 7
      return bangkokMidnight(l.y, l.m, l.d - dow + 7)
    }
    case 'monthly': return bangkokMidnight(l.y, l.m + 1, 1)
  }
}

export function isDue(schedule: Schedule, nextRunAt: Date | null, now: Date): boolean {
  if (schedule === 'manual') return false
  return nextRunAt === null || nextRunAt.getTime() <= now.getTime()
}

export function promptSetHash(promptIds: string[]): string {
  return createHash('sha256').update([...promptIds].sort().join(',')).digest('hex').slice(0, 16)
}

export function monthKey(at: Date): string {
  const l = bangkokDate(at)
  return `${l.y}-${p2(l.m)}`
}

export function monthRange(at: Date): { start: Date; end: Date } {
  const l = bangkokDate(at)
  return { start: bangkokMidnight(l.y, l.m, 1), end: bangkokMidnight(l.y, l.m + 1, 1) }
}

/** Last n month keys including the month of `at`, oldest first. */
export function lastMonthKeys(at: Date, n: number): string[] {
  const l = bangkokDate(at)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(l.y, l.m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`)
  }
  return out
}

function validDay(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return { y, m, d }
}

export function parseDayRange(from?: string | null, to?: string | null): { gte?: Date; lte?: Date } {
  const out: { gte?: Date; lte?: Date } = {}
  const f = validDay(from)
  const t = validDay(to)
  if (f) out.gte = new Date(`${from}T00:00:00.000+07:00`)
  if (t) out.lte = new Date(`${to}T23:59:59.999+07:00`)
  return out
}

export function previousRange(from: string, to: string): { from: string; to: string } | null {
  const f = validDay(from)
  const t = validDay(to)
  if (!f || !t) return null
  const fMs = Date.UTC(f.y, f.m - 1, f.d)
  const tMs = Date.UTC(t.y, t.m - 1, t.d)
  if (tMs < fMs) return null
  const len = Math.round((tMs - fMs) / DAY_MS) + 1
  const prevTo = fMs - DAY_MS
  const prevFrom = prevTo - (len - 1) * DAY_MS
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: iso(prevFrom), to: iso(prevTo) }
}
