/**
 * Brand Radar — URL Monitor maths. Pure functions: no database, no network.
 * See url-monitor-types.ts for the counting rule. A number that cannot be computed is null, never 0.
 */
import { filterDataset, rate, scanProgress, topicProviderHeat, type CitationRow, type Dataset, type RespRow, type RunLite } from './metrics'
import { normalizeUrl } from './normalize'
import { gradePosition, gradeRate, monthKey } from './scorecard'
import type { ScoreGrade } from './scorecard-types'
import { LIMITS, PROVIDER_KEYS } from './types'
import type {
  MonitoredUrl, UrlMonthStat, UrlPromptRow, UrlProviderRow, UrlReport, UrlScanPoint, UrlScorecard, UrlSummaryRow, UrlTotals,
} from './url-monitor-types'

/** Most URLs one project can monitor */
export const URL_MONITOR_MAX = 50
/** Most matched pages listed for a prefix URL */
export const URL_MONITOR_PAGES_SHOWN = 20
/** Benchmark names shown on the grade tiles */
export const BENCHMARK_PROJECT = 'ค่าเฉลี่ยทั้งโปรเจกต์'
export const BENCHMARK_SOURCES = 'ค่าเฉลี่ยแหล่งอ้างอิงอื่น'

// ── Stored list ──────────────────────────────────────────────────────────────

/** The AppSetting key of one project's monitored list */
export function urlMonitorKey(projectId: string): string {
  return `brand_radar_url_monitor:${projectId}`
}

/** The stored JSON -> a clean list. Anything malformed is dropped, never thrown. */
export function parseMonitoredUrls(raw: string | null | undefined): MonitoredUrl[] {
  let v: unknown
  try {
    v = JSON.parse(raw || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(v)) return []
  const out: MonitoredUrl[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || typeof o.url !== 'string' || typeof o.normalizedUrl !== 'string' || !o.normalizedUrl) continue
    if (seen.has(o.id)) continue
    seen.add(o.id)
    out.push({
      id: o.id,
      url: o.url.slice(0, LIMITS.urlMax),
      normalizedUrl: o.normalizedUrl.slice(0, LIMITS.urlMax),
      prefix: o.prefix === true,
      addedAt: typeof o.addedAt === 'string' ? o.addedAt : '',
    })
    if (out.length >= URL_MONITOR_MAX) break
  }
  return out
}

export type CleanUrlResult =
  | { ok: true; item: Pick<MonitoredUrl, 'url' | 'normalizedUrl' | 'prefix'> }
  | { ok: false; error: string; status: number }

/** Validate what staff typed against the list already stored */
export function cleanMonitoredInput(url: unknown, prefix: unknown, existing: MonitoredUrl[]): CleanUrlResult {
  const typed = typeof url === 'string' ? url.trim() : ''
  if (!typed) return { ok: false, error: 'กรุณาใส่ URL', status: 400 }
  if (typed.length > LIMITS.urlMax) return { ok: false, error: `URL ยาวเกิน ${LIMITS.urlMax} ตัวอักษร`, status: 400 }
  const normalizedUrl = normalizeUrl(typed)
  if (!normalizedUrl) return { ok: false, error: 'URL ไม่ถูกต้อง ต้องเป็นลิงก์เว็บ เช่น https://example.com/page', status: 400 }
  const wantPrefix = prefix === true
  if (existing.some((m) => m.normalizedUrl === normalizedUrl && m.prefix === wantPrefix)) {
    return { ok: false, error: 'URL นี้ติดตามอยู่แล้ว', status: 409 }
  }
  if (existing.length >= URL_MONITOR_MAX) return { ok: false, error: `ติดตามได้ไม่เกิน ${URL_MONITOR_MAX} URL ต่อโปรเจกต์`, status: 400 }
  const shown = /^https?:\/\//i.test(typed) ? typed : `https://${typed.replace(/^\/\//, '')}`
  return { ok: true, item: { url: shown, normalizedUrl, prefix: wantPrefix } }
}

/** Does a citation's normalizedUrl belong to the monitored URL? */
export function urlMatcher(m: Pick<MonitoredUrl, 'normalizedUrl' | 'prefix'>): (normalized: string) => boolean {
  const base = m.normalizedUrl
  if (!m.prefix) return (n) => n === base
  // a prefix URL with a query string has no "pages under it": only the exact page
  if (base.includes('?')) return (n) => n === base
  const slash = `${base}/`
  const query = `${base}?`
  return (n) => n === base || n.startsWith(slash) || n.startsWith(query)
}

// ── Report ───────────────────────────────────────────────────────────────────

function mean(xs: number[]): number | null {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

/** 0-based stored position -> the place people read (1 = first) */
function placesOf(cs: CitationRow[]): number[] {
  const out: number[] = []
  for (const c of cs) if (typeof c.position === 'number' && Number.isFinite(c.position)) out.push(c.position + 1)
  return out
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

interface Matched { citations: CitationRow[]; citing: Set<string> }

function matchOf(ds: Dataset, m: Pick<MonitoredUrl, 'normalizedUrl' | 'prefix'>): Matched {
  const match = urlMatcher(m)
  const citations = ds.citations.filter((c) => match(c.normalizedUrl))
  return { citations, citing: new Set(citations.map((c) => c.responseId)) }
}

function totalsOf(responses: RespRow[], matched: Matched): UrlTotals {
  const citingRows = responses.filter((r) => matched.citing.has(r.id))
  const brandMentioned = citingRows.filter((r) => r.brandMentioned === true).length
  const prompts = new Set(responses.map((r) => r.promptId))
  const citingPrompts = new Set(citingRows.map((r) => r.promptId))
  let last: number | null = null
  for (const r of citingRows) {
    if (r.collectedAt && (last === null || r.collectedAt.getTime() > last)) last = r.collectedAt.getTime()
  }
  return {
    answers: responses.length,
    citingAnswers: citingRows.length,
    citationRate: rate(citingRows.length, responses.length),
    brandMentioned,
    brandMentionRate: rate(brandMentioned, citingRows.length),
    prompts: prompts.size,
    citingPrompts: citingPrompts.size,
    visibility: rate(citingRows.length, responses.length),
    avgPlace: mean(placesOf(matched.citations)),
    lastCitedAt: iso(last),
  }
}

/** Headline numbers of every monitored URL, in the stored order */
export function summarizeUrls(ds: Dataset, list: MonitoredUrl[]): UrlSummaryRow[] {
  return list.map((m) => {
    const t = totalsOf(ds.responses, matchOf(ds, m))
    return { ...m, citingAnswers: t.citingAnswers, citationRate: t.citationRate, citingPrompts: t.citingPrompts, lastCitedAt: t.lastCitedAt }
  })
}

function providerRows(ds: Dataset, citing: Set<string>): UrlProviderRow[] {
  const out: UrlProviderRow[] = []
  for (const provider of PROVIDER_KEYS) {
    const rs = ds.responses.filter((r) => r.provider === provider)
    if (rs.length === 0) continue
    const cited = rs.filter((r) => citing.has(r.id))
    const brandMentioned = cited.filter((r) => r.brandMentioned === true).length
    out.push({
      provider, answers: rs.length, citingAnswers: cited.length, citationRate: rate(cited.length, rs.length),
      brandMentioned, brandMentionRate: rate(brandMentioned, cited.length),
    })
  }
  return out
}

function promptRows(ds: Dataset, citing: Set<string>): UrlPromptRow[] {
  const byPrompt = new Map<string, RespRow[]>()
  for (const r of ds.responses) {
    const list = byPrompt.get(r.promptId)
    if (list) list.push(r)
    else byPrompt.set(r.promptId, [r])
  }
  const out: UrlPromptRow[] = []
  for (const p of ds.prompts) {
    const rs = byPrompt.get(p.id)
    if (!rs || rs.length === 0) continue
    const cited = rs.filter((r) => citing.has(r.id))
    let newest: RespRow | null = null
    for (const r of cited) {
      if (newest === null || (r.collectedAt?.getTime() ?? 0) > (newest.collectedAt?.getTime() ?? 0)) newest = r
    }
    const providers = PROVIDER_KEYS.filter((k) => cited.some((r) => r.provider === k))
    out.push({
      promptId: p.id, text: p.text, topic: p.topic, asked: rs.length, cited: cited.length, citationRate: rate(cited.length, rs.length),
      brandMentioned: cited.filter((r) => r.brandMentioned === true).length,
      providers,
      latest: newest ? { responseId: newest.id, runId: newest.runId, provider: newest.provider, at: newest.collectedAt ? newest.collectedAt.toISOString() : null } : null,
    })
  }
  return out.sort((a, b) => b.cited - a.cited || b.asked - a.asked || a.text.localeCompare(b.text))
}

function scanPoints(ds: Dataset, runs: RunLite[], matched: Matched): UrlScanPoint[] {
  const respByRun = new Map<string, RespRow[]>()
  for (const r of ds.responses) {
    const list = respByRun.get(r.runId)
    if (list) list.push(r)
    else respByRun.set(r.runId, [r])
  }
  const citesByRun = new Map<string, CitationRow[]>()
  for (const c of matched.citations) {
    const list = citesByRun.get(c.runId)
    if (list) list.push(c)
    else citesByRun.set(c.runId, [c])
  }
  // scanProgress owns the round order, the label and the "same prompt set" flag
  return scanProgress(ds, runs).map((p) => {
    const t = totalsOf(respByRun.get(p.runId) ?? [], { citations: citesByRun.get(p.runId) ?? [], citing: matched.citing })
    return {
      runId: p.runId, date: p.date, label: p.label, asked: t.answers, cited: t.citingAnswers, citationRate: t.citationRate,
      prompts: t.prompts, citingPrompts: t.citingPrompts, visibility: t.visibility,
      brandMentioned: t.brandMentioned, brandMentionRate: t.brandMentionRate, avgPlace: t.avgPlace,
      sameSetAsPrevious: p.sameSetAsPrevious,
    }
  })
}

/**
 * Three grades, in the order citation, mention, position:
 *   citation — C / N against every other cited page (answers citing that page / N);
 *   mention  — B / C against the project's own rate (answers naming the brand / N);
 *   position — the URL's mean place against the mean place of every other source.
 */
export function gradeUrl(ds: Dataset, matched: { citations: CitationRow[]; citing: Set<string> }, totals: UrlTotals): ScoreGrade[] {
  const n = ds.responses.length
  const mine = new Set(matched.citations)
  const others = new Map<string, { url: string; answers: Set<string> }>()
  const otherPlaces: number[] = []
  for (const c of ds.citations) {
    if (mine.has(c)) continue
    let o = others.get(c.normalizedUrl)
    if (!o) others.set(c.normalizedUrl, (o = { url: c.url, answers: new Set() }))
    o.answers.add(c.responseId)
    if (typeof c.position === 'number' && Number.isFinite(c.position)) otherPlaces.push(c.position + 1)
  }
  const pages = n > 0 ? Array.from(others.values()).map((o) => ({ name: o.url, value: o.answers.size / n })) : []
  const projectRate = rate(ds.responses.filter((r) => r.brandMentioned === true).length, n)
  const otherPlace = mean(otherPlaces)
  return [
    gradeRate('citation', totals.citationRate, pages),
    gradeRate('mention', totals.brandMentionRate, projectRate === null ? [] : [{ name: BENCHMARK_PROJECT, value: projectRate }]),
    gradePosition(totals.avgPlace, otherPlace === null ? [] : [{ name: BENCHMARK_SOURCES, value: otherPlace }]),
  ]
}

/** Everything of the report that needs no extra query (insight and months are added by the loader) */
export function buildUrlReport(ds: Dataset, runs: RunLite[], url: MonitoredUrl): { report: UrlReport; citing: Set<string> } {
  const matched = matchOf(ds, url)
  const totals = totalsOf(ds.responses, matched)

  // topicProviderHeat reads `brandMentioned`; here the question per answer is "does it cite the URL?"
  const heat = topicProviderHeat({ ...ds, responses: ds.responses.map((r) => ({ ...r, brandMentioned: matched.citing.has(r.id) })) })

  const pageAcc = new Map<string, { url: string; title: string; answers: Set<string> }>()
  for (const c of matched.citations) {
    let p = pageAcc.get(c.normalizedUrl)
    if (!p) pageAcc.set(c.normalizedUrl, (p = { url: c.url, title: '', answers: new Set() }))
    if (!p.title && c.title) p.title = c.title
    p.answers.add(c.responseId)
  }
  const pages = Array.from(pageAcc.values())
    .map((p) => ({ url: p.url, title: p.title, answers: p.answers.size }))
    .sort((a, b) => b.answers - a.answers || a.url.localeCompare(b.url))
    .slice(0, URL_MONITOR_PAGES_SHOWN)

  return {
    report: {
      url,
      totals,
      byProvider: providerRows(ds, matched.citing),
      heat,
      prompts: promptRows(ds, matched.citing),
      scans: scanPoints(ds, runs, matched),
      scorecard: { grades: gradeUrl(ds, matched, totals), months: null },
      pages,
    },
    citing: matched.citing,
  }
}

/** The answers that cite the URL, with their mentions and citations (for the sentiment block) */
export function citingDataset(ds: Dataset, citing: Set<string>): Dataset {
  return filterDataset(ds, (r) => citing.has(r.id))
}

// ── Months (whole history) ───────────────────────────────────────────────────

/** One scan round of the whole history, already matched against the URL */
export interface UrlMonthRow {
  startedAt: Date
  asked: number
  cited: number
  brandMentioned: number
  placeSum: number
  placeCount: number
  /** prompts with an answer in the round */
  promptIds: string[]
  /** prompts with an answer that cites the URL */
  citingPromptIds: string[]
}

/** Months with answers, ascending. Prompts are counted once per month, not once per round. */
export function buildUrlMonthStats(rows: UrlMonthRow[]): UrlMonthStat[] {
  interface Acc { scans: number; asked: number; cited: number; brandMentioned: number; placeSum: number; placeCount: number; prompts: Set<string>; citingPrompts: Set<string> }
  const acc = new Map<string, Acc>()
  for (const r of rows) {
    if (r.asked <= 0) continue
    const key = monthKey(r.startedAt)
    let a = acc.get(key)
    if (!a) acc.set(key, (a = { scans: 0, asked: 0, cited: 0, brandMentioned: 0, placeSum: 0, placeCount: 0, prompts: new Set(), citingPrompts: new Set() }))
    a.scans += 1
    a.asked += r.asked
    a.cited += r.cited
    a.brandMentioned += r.brandMentioned
    a.placeSum += r.placeSum
    a.placeCount += r.placeCount
    for (const id of r.promptIds) a.prompts.add(id)
    for (const id of r.citingPromptIds) a.citingPrompts.add(id)
  }
  return Array.from(acc.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, a]) => ({
      month,
      scans: a.scans,
      asked: a.asked,
      cited: a.cited,
      citationRate: rate(a.cited, a.asked),
      visibility: rate(a.cited, a.asked),
      brandMentionRate: rate(a.brandMentioned, a.cited),
      avgPlace: a.placeCount > 0 ? a.placeSum / a.placeCount : null,
    }))
}

/** The calendar month right before a YYYY-MM key */
function previousMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** current = latest month with answers; previous = the calendar month before it; first = earliest month (null when it is current) */
export function pickUrlMonths(stats: UrlMonthStat[]): NonNullable<UrlScorecard['months']> {
  if (stats.length === 0) return { current: null, previous: null, first: null }
  const sorted = [...stats].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  const current = sorted[sorted.length - 1]
  const previous = sorted.find((s) => s.month === previousMonthKey(current.month)) ?? null
  const earliest = sorted[0]
  return { current, previous, first: earliest.month === current.month ? null : earliest }
}
