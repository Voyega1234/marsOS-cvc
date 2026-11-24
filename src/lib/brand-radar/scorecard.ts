/**
 * Brand Radar — scorecard maths: a grade per headline number against tracked competitors,
 * and monthly statistics. Pure functions, no server imports.
 */
import { bangkokDay } from './insight'
import type { Grade, MonthStat, ScoreGrade, ScoreMetricKey, ScorecardDTO } from './scorecard-types'
import type { EntityShare } from './types'

/** Rate metrics (mention, citation): ours / best competitor at or above this is "good" */
export const RATE_GOOD_RATIO = 0.8
/** Rate metrics: at or above this (and below good) is "fair"; lower is "poor" */
export const RATE_FAIR_RATIO = 0.4
/** Position: our average position at most this many places behind the best competitor is "good" */
export const POSITION_GOOD_GAP = 0.5
/** Position: at most this many places behind is "fair"; more is "poor" */
export const POSITION_FAIR_GAP = 1.5

interface Candidate { name: string; value: number }

export function gradeRate(metric: ScoreMetricKey, ours: number | null, others: Candidate[]): ScoreGrade {
  const best = others.reduce<Candidate | null>((b, c) => (b === null || c.value > b.value ? c : b), null)
  const bestCompetitor = best ? { name: best.name, value: best.value } : null
  if (!best || ours === null) return { metric, value: ours, bestCompetitor, grade: null, rank: null, outOf: 0 }
  let grade: Grade
  if (ours === 0) grade = 'poor'
  else if (best.value === 0) grade = 'good'
  else {
    const ratio = ours / best.value
    grade = ratio >= RATE_GOOD_RATIO ? 'good' : ratio >= RATE_FAIR_RATIO ? 'fair' : 'poor'
  }
  const rank = 1 + others.filter((c) => c.value > ours).length
  return { metric, value: ours, bestCompetitor, grade, rank, outOf: others.length + 1 }
}

export function gradePosition(ours: number | null, others: Candidate[]): ScoreGrade {
  const best = others.reduce<Candidate | null>((b, c) => (b === null || c.value < b.value ? c : b), null)
  const bestCompetitor = best ? { name: best.name, value: best.value } : null
  if (!best || ours === null) return { metric: 'position', value: ours, bestCompetitor, grade: null, rank: null, outOf: 0 }
  const gap = ours - best.value
  const grade: Grade = gap <= POSITION_GOOD_GAP ? 'good' : gap <= POSITION_FAIR_GAP ? 'fair' : 'poor'
  const rank = 1 + others.filter((c) => c.value < ours).length
  return { metric: 'position', value: ours, bestCompetitor, grade, rank, outOf: others.length + 1 }
}

/** Three grades in the order mention, citation, position. The brand is the 'brand' entity; the rest are tracked competitors. */
export function gradeScores(entities: EntityShare[], responses: number): ScoreGrade[] {
  const brand = entities.find((e) => e.entityType === 'brand') ?? null
  const competitors = entities.filter((e) => e.entityType !== 'brand')
  const hasAnswers = responses > 0

  const mentionOf = (e: EntityShare) => (hasAnswers ? e.mentionRate : null)
  const citationOf = (e: EntityShare) => (hasAnswers ? e.cited / responses : null)

  const rateCandidates = (value: (e: EntityShare) => number | null): Candidate[] =>
    competitors.flatMap((c) => {
      const v = value(c)
      return v === null || !Number.isFinite(v) ? [] : [{ name: c.name, value: v }]
    })
  const positionCandidates: Candidate[] = competitors.flatMap((c) =>
    c.avgPosition === null || !Number.isFinite(c.avgPosition) ? [] : [{ name: c.name, value: c.avgPosition }])

  return [
    gradeRate('mention', brand ? mentionOf(brand) : null, rateCandidates(mentionOf)),
    gradeRate('citation', brand ? citationOf(brand) : null, rateCandidates(citationOf)),
    gradePosition(brand ? brand.avgPosition : null, positionCandidates),
  ]
}

/** Bangkok calendar month, YYYY-MM */
export function monthKey(d: Date): string {
  return bangkokDay(d).slice(0, 7)
}

/** One scan round, already aggregated */
export interface MonthRow {
  startedAt: Date
  asked: number
  mentioned: number
  ownedCited: number
  appeared: number
  positionSum: number
  positionCount: number
}

/** Months with answers, ascending. A metric that cannot be computed is null, never 0. */
export function buildMonthStats(rows: MonthRow[]): MonthStat[] {
  const acc = new Map<string, { scans: number; asked: number; mentioned: number; ownedCited: number; appeared: number; positionSum: number; positionCount: number }>()
  for (const r of rows) {
    if (r.asked <= 0) continue
    const key = monthKey(r.startedAt)
    let a = acc.get(key)
    if (!a) acc.set(key, (a = { scans: 0, asked: 0, mentioned: 0, ownedCited: 0, appeared: 0, positionSum: 0, positionCount: 0 }))
    a.scans += 1
    a.asked += r.asked
    a.mentioned += r.mentioned
    a.ownedCited += r.ownedCited
    a.appeared += r.appeared
    a.positionSum += r.positionSum
    a.positionCount += r.positionCount
  }
  return Array.from(acc.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, a]) => ({
      month,
      scans: a.scans,
      asked: a.asked,
      mentionRate: a.asked > 0 ? a.mentioned / a.asked : null,
      citationRate: a.asked > 0 ? a.ownedCited / a.asked : null,
      appearRate: a.asked > 0 ? a.appeared / a.asked : null,
      avgPosition: a.positionCount > 0 ? a.positionSum / a.positionCount : null,
    }))
}

/** The calendar month right before a YYYY-MM key */
function previousMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** current = latest month with data; previous = the calendar month before it (if present); first = earliest month (null when it is current) */
export function pickMonths(stats: MonthStat[]): ScorecardDTO['months'] {
  if (stats.length === 0) return { current: null, previous: null, first: null }
  const sorted = [...stats].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  const current = sorted[sorted.length - 1]
  const previous = sorted.find((s) => s.month === previousMonthKey(current.month)) ?? null
  const earliest = sorted[0]
  return { current, previous, first: earliest.month === current.month ? null : earliest }
}
