// Sample-size test (pure): summarise and compare two independent sets of answers to the same prompt.
// No server imports, because the Settings component imports this file in the browser.

/** Mirrors the DataForSEO LLM Scraper list price in providers.ts (providers.ts cannot be imported into client code). */
export const SCRAPER_ASK_PRICE_USD = 0.004

export type AskResult =
  | {
      ok: true
      brandMentioned: boolean
      brandRecommended: boolean
      positionPct: number | null
      competitors: string[]
      domains: string[]
      ownCited: boolean
      costUsd: number
      answer: string
    }
  | { ok: false; error: string; costUsd: number }

export interface SetSummary {
  asked: number
  answered: number
  failed: number
  mentionRate: number | null
  recommendRate: number | null
  ownCitedRate: number | null
  avgPositionPct: number | null
  competitors: Array<{ name: string; count: number; rate: number }>
  domains: Array<{ domain: string; count: number; rate: number }>
  costUsd: number
  /** 95% margin of error of mentionRate in percentage points (Wilson score interval half-width) */
  marginPp: number | null
}

export type RateKey = 'mention' | 'recommend' | 'ownCited'

export interface RateRow {
  key: RateKey
  a: number | null
  b: number | null
  diffPp: number | null
  /** true = the gap is within what chance alone produces at these sample sizes; null = a side has no answers */
  likelyNoise: boolean | null
}

export interface EntityRow {
  name: string
  a: number
  b: number
  diffPp: number
  onlyIn: 'A' | 'B' | null
}

export interface Comparison {
  rows: RateRow[]
  competitors: EntityRow[]
  domains: EntityRow[]
  onlyInA: string[]
  onlyInB: string[]
  verdict: 'no_clear_difference' | 'different' | 'not_enough_data'
}

const Z95 = 1.96

function wilsonHalfWidth(p: number, n: number): number {
  const z2 = Z95 * Z95
  return (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}

function tally(lists: string[][], answered: number): Array<{ name: string; count: number; rate: number }> {
  const counts = new Map<string, number>()
  for (const list of lists) for (const name of Array.from(new Set(list))) counts.set(name, (counts.get(name) || 0) + 1)
  return Array.from(counts, ([name, count]) => ({ name, count, rate: answered ? count / answered : 0 }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name))
}

export function summarize(asks: AskResult[]): SetSummary {
  const done = asks.filter((a): a is Extract<AskResult, { ok: true }> => a.ok)
  const n = done.length
  const rate = (f: (a: Extract<AskResult, { ok: true }>) => boolean) => (n ? done.filter(f).length / n : null)
  const positions = done.map((a) => a.positionPct).filter((v): v is number => typeof v === 'number')
  const mentionRate = rate((a) => a.brandMentioned)
  return {
    asked: asks.length,
    answered: n,
    failed: asks.length - n,
    mentionRate,
    recommendRate: rate((a) => a.brandRecommended),
    ownCitedRate: rate((a) => a.ownCited),
    avgPositionPct: positions.length ? positions.reduce((s, v) => s + v, 0) / positions.length : null,
    competitors: tally(done.map((a) => a.competitors), n),
    domains: tally(done.map((a) => a.domains), n).map((d) => ({ domain: d.name, count: d.count, rate: d.rate })),
    costUsd: asks.reduce((s, a) => s + (a.costUsd || 0), 0),
    marginPp: mentionRate === null ? null : wilsonHalfWidth(mentionRate, n) * 100,
  }
}

/** Two-proportion z-test at 95%. True when the gap could easily be chance. */
function isNoise(pa: number, na: number, pb: number, nb: number): boolean {
  const pooled = (pa * na + pb * nb) / (na + nb)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb))
  if (se === 0) return pa === pb
  return Math.abs((pa - pb) / se) < Z95
}

function rateRow(key: RateKey, a: SetSummary, b: SetSummary, pick: (s: SetSummary) => number | null): RateRow {
  const ra = pick(a)
  const rb = pick(b)
  if (ra === null || rb === null) return { key, a: ra, b: rb, diffPp: null, likelyNoise: null }
  return { key, a: ra, b: rb, diffPp: (rb - ra) * 100, likelyNoise: isNoise(ra, a.answered, rb, b.answered) }
}

function entityRows(a: Array<{ name: string; rate: number }>, b: Array<{ name: string; rate: number }>): EntityRow[] {
  const ma = new Map(a.map((x) => [x.name, x.rate]))
  const mb = new Map(b.map((x) => [x.name, x.rate]))
  const names = Array.from(new Set(Array.from(ma.keys()).concat(Array.from(mb.keys()))))
  return names
    .map((name): EntityRow => {
      const ra = ma.get(name) ?? 0
      const rb = mb.get(name) ?? 0
      return { name, a: ra, b: rb, diffPp: (rb - ra) * 100, onlyIn: !ma.has(name) ? 'B' : !mb.has(name) ? 'A' : null }
    })
    .sort((x, y) => Math.abs(y.diffPp) - Math.abs(x.diffPp) || x.name.localeCompare(y.name))
    .slice(0, 15)
}

export function compare(a: SetSummary, b: SetSummary): Comparison {
  const rows = [
    rateRow('mention', a, b, (s) => s.mentionRate),
    rateRow('recommend', a, b, (s) => s.recommendRate),
    rateRow('ownCited', a, b, (s) => s.ownCitedRate),
  ]
  const competitors = entityRows(a.competitors, b.competitors)
  const domains = entityRows(a.domains.map((d) => ({ name: d.domain, rate: d.rate })), b.domains.map((d) => ({ name: d.domain, rate: d.rate })))
  const names = (x: Array<{ name: string }>) => new Set(x.map((e) => e.name))
  const aNames = new Set(Array.from(names(a.competitors)).concat(a.domains.map((d) => d.domain)))
  const bNames = new Set(Array.from(names(b.competitors)).concat(b.domains.map((d) => d.domain)))
  const verdict: Comparison['verdict'] =
    a.answered === 0 || b.answered === 0 ? 'not_enough_data' : rows.some((r) => r.likelyNoise === false) ? 'different' : 'no_clear_difference'
  return {
    rows,
    competitors,
    domains,
    onlyInA: Array.from(aNames).filter((x) => !bNames.has(x)),
    onlyInB: Array.from(bNames).filter((x) => !aNames.has(x)),
    verdict,
  }
}

/** All of set A first, then set B, each cut into requests of at most batchSize asks. */
export function planBatches(countA: number, countB: number, batchSize = 5): Array<{ set: 'A' | 'B'; asks: number }> {
  const out: Array<{ set: 'A' | 'B'; asks: number }> = []
  const size = Math.max(1, Math.floor(batchSize))
  for (const [set, total] of [['A', countA], ['B', countB]] as const) {
    for (let left = Math.max(0, Math.floor(total)); left > 0; left -= size) out.push({ set, asks: Math.min(size, left) })
  }
  return out
}
