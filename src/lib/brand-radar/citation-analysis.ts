/**
 * Brand Radar — Citation Analysis builder.
 * Everything is computed from stored scan data (answers, mentions, citations, sentiment); no AI call is made.
 *
 * Split in two parts:
 *  - pure functions on plain arrays (unit-tested in citation-analysis.test.ts, no database)
 *  - buildCitationAnalysis(), which loads the rows and calls them. Every query filters by organization AND project.
 */
import type { Prisma } from '@prisma/client'
import { bangkokDay, parseStoredFoundSources, parseStoredSentiment, type FoundSource } from './insight'
import { rate, type CitationRow, type CompLite, type Dataset, type MentionRow, type PromptLite, type RespRow, type RunLite } from './metrics'
import { normalizeDomain, normalizeUrl } from './normalize'
import type { FlagSources } from './queries'
import { parseDayRange, previousRange } from './schedule'
import type { RadarCtx } from './server'
import { PROVIDERS, isProviderKey, type CitationOwner, type ProviderKey, type RadarFilters } from './types'
import type {
  AnalysisDomainRow, AnalysisPage, AnalysisPrevious, AnalysisRange, AnalysisRun, AnalysisTotals, AnswerVariationRow,
  CitationAnalysisDTO, CompetitorCitedRow, FixAction, FoundFunnel, FoundNotCitedPage, MentionedNotCitedRow, OwnPageRow, PromptFixRow, SentimentCounts, SiteType, TrendPoint, WhySignal,
} from './citation-analysis-types'

export const ANALYSIS_LIMITS = {
  runs: 30, domains: 60, pages: 8, prompts: 8, variation: 60, variationDomains: 6, variationCompetitors: 4,
  ownPages: 30, ownPagePrompts: 5, gaps: 20, citedInstead: 5, gapCompetitors: 5, title: 300, promptText: 500,
  fixPages: 50, fixPagesPerRow: 3, foundPages: 30, foundPagePrompts: 3, sameTolerance: 0.02,
} as const

type Tone = keyof SentimentCounts

// ── Small helpers ────────────────────────────────────────────────────────────

const r4 = (n: number): number => Math.round(n * 10000) / 10000
const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s)

function bump<K>(m: Map<K, number>, k: K, by = 1): void {
  m.set(k, (m.get(k) || 0) + by)
}

function addTo<K, V>(m: Map<K, Set<V>>, k: K, v: V): void {
  const s = m.get(k)
  if (s) s.add(v)
  else m.set(k, new Set([v]))
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k)
  if (arr) arr.push(v)
  else m.set(k, [v])
}

/** Keys of a counter, highest count first; ties by key so the order is stable. */
function topKeys(m: Map<string, number>, max: number): string[] {
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map((e) => e[0])
}

function providerList(set: Set<ProviderKey>): ProviderKey[] {
  return Array.from(set).sort()
}

/** Provider name without the collection-method wording, same rule as queries.ts */
function providerLabelFor(key: ProviderKey, clientView: boolean): string {
  return clientView ? PROVIDERS[key].label.replace(/\s*\(.*\)\s*$/, '') : PROVIDERS[key].label
}

// ── Site type / page type ────────────────────────────────────────────────────

const FORUM_HOSTS = ['pantip.com', 'reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com']
const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'linkedin.com', 'threads.net', 'line.me', 'fb.com', 'fb.me', 'fb.watch']
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com']
const REFERENCE_HOSTS = ['wikipedia.org', 'wikihow.com', 'britannica.com']
const MARKETPLACE_LABELS = ['shopee', 'lazada', 'amazon', 'ebay']
const MARKETPLACE_HOSTS = ['aliexpress.com', 'jd.co.th']
const NEWS_HOSTS = [
  'thairath.co.th', 'sanook.com', 'kapook.com', 'matichon.co.th', 'bangkokpost.com', 'prachachat.net', 'bangkokbiznews.com',
  'thestandard.co', 'brandinside.asia', 'marketingoops.com', 'forbes.com', 'bbc.com', 'cnn.com', 'reuters.com', 'nytimes.com',
  'theguardian.com', 'techcrunch.com',
]
const REVIEW_HOSTS = ['wongnai.com', 'trustpilot.com', 'g2.com', 'capterra.com']
const REVIEW_LABELS = ['tripadvisor']
const DIRECTORY_HOSTS = ['clutch.co']
const DIRECTORY_LABELS = ['yellowpages']
const GOV_RE = /(\.go\.th|\.gov|\.gov\.[a-z]{2}|\.ac\.th|\.edu|\.edu\.[a-z]{2}|\.or\.th)$/

const NEWS_PATH_RE = /\/news\//
const REVIEW_PATH_RE = /review|รีวิว|compare|-vs-|best-/
const DIRECTORY_PATH_RE = /\/directory\/|\/listing\/|\/companies\//
const BLOG_PATH_RE = /\/blog\/|\/article|\/บทความ|\/content\/|\/post/

function cleanHost(h: string): string {
  return h.toLowerCase().replace(/^www\./, '')
}

function hostOfUrl(url: string): string {
  try {
    return cleanHost(new URL(url).hostname)
  } catch {
    return ''
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Decoded, lower-case path of a URL; '' when the URL cannot be parsed or has no path. */
function pathOfUrl(url: string): string {
  try {
    const u = new URL(url)
    const p = safeDecode(u.pathname).toLowerCase()
    return p === '/' ? '' : p
  } catch {
    return ''
  }
}

function hostIn(host: string, list: string[]): boolean {
  return list.some((d) => host === d || host.endsWith(`.${d}`))
}

function hasLabel(host: string, labels: string[]): boolean {
  const parts = host.split('.')
  return labels.some((l) => parts.indexOf(l) >= 0)
}

function isForumHost(host: string): boolean {
  return hostIn(host, FORUM_HOSTS) || /^(forum|community|board)\./.test(host)
}

function majorityPaths(urls: string[], re: RegExp): boolean {
  const paths = urls.map(pathOfUrl).filter((p) => p !== '')
  if (paths.length === 0) return false
  return paths.filter((p) => re.test(p)).length / paths.length > 0.5
}

export function inferSiteType(domain: string, urls: string[], ownerType: CitationOwner): SiteType {
  if (ownerType === 'own' || ownerType === 'competitor') return 'official'
  const d = cleanHost(domain)
  const hosts = [d].concat(urls.map(hostOfUrl).filter((h) => h !== ''))
  const anyHost = (f: (h: string) => boolean): boolean => hosts.some(f)
  if (anyHost(isForumHost)) return 'forum'
  if (anyHost((h) => hostIn(h, SOCIAL_HOSTS))) return 'social'
  if (anyHost((h) => hostIn(h, VIDEO_HOSTS))) return 'video'
  if (anyHost((h) => hostIn(h, REFERENCE_HOSTS))) return 'reference'
  if (anyHost((h) => hasLabel(h, MARKETPLACE_LABELS) || hostIn(h, MARKETPLACE_HOSTS))) return 'marketplace'
  if (GOV_RE.test(d)) return 'government'
  if (hostIn(d, NEWS_HOSTS) || majorityPaths(urls, NEWS_PATH_RE)) return 'news'
  if (hostIn(d, REVIEW_HOSTS) || hasLabel(d, REVIEW_LABELS) || majorityPaths(urls, REVIEW_PATH_RE)) return 'review'
  if (hostIn(d, DIRECTORY_HOSTS) || hasLabel(d, DIRECTORY_LABELS) || majorityPaths(urls, DIRECTORY_PATH_RE)) return 'directory'
  if (majorityPaths(urls, BLOG_PATH_RE)) return 'blog'
  return 'other'
}

export function inferPageType(url: string): string {
  const host = hostOfUrl(url)
  const path = pathOfUrl(url)
  if (host && path === '') return 'home'
  if (host && isForumHost(host)) return 'forum thread'
  if (host && hostIn(host, VIDEO_HOSTS)) return 'video'
  if (/(^|[\/-])vs([\/-]|$)|compare|เปรียบเทียบ/.test(path)) return 'comparison'
  if (/(^|[\/-])best|(^|[\/-])top-|(^|[\/-])\d+-|รวม|แนะนำ/.test(path)) return 'list'
  if (/review|รีวิว/.test(path)) return 'review'
  if (/\/product|\/p\/|\/shop|\/pricing|\/service/.test(path)) return 'product'
  if (/\/blog|\/article|\/news|\/content|\/post|บทความ/.test(path)) return 'article'
  return 'other'
}

// ── Title / prompt term matching ─────────────────────────────────────────────

const STOP_WORDS = new Set(['this', 'that', 'with', 'from', 'what', 'which', 'best', 'have', 'does', 'your', 'about', 'there', 'their', 'would', 'should', 'where', 'when'])
const THAI_RUN_RE = /[฀-๿]{6,}/g
const THAI_WINDOW = 6

/** True when the prompt and the page text share a meaningful term (Latin word of 4+ chars, or 6+ Thai characters). */
export function sharesTerm(promptText: string, pageText: string): boolean {
  const hay = pageText.toLowerCase()
  if (!hay) return false
  const words = promptText.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
  for (const w of words.slice(0, 40)) if (hay.indexOf(w) >= 0) return true
  const runs = promptText.match(THAI_RUN_RE) || []
  for (const run of runs.slice(0, 10)) {
    for (let i = 0; i + THAI_WINDOW <= Math.min(run.length, 60); i++) {
      if (hay.indexOf(run.slice(i, i + THAI_WINDOW)) >= 0) return true
    }
  }
  return false
}

// ── Client view scoping ──────────────────────────────────────────────────────

/**
 * Customer login: a citation of a competitor that is not ACTIVE is shown as an ordinary external citation.
 * Staff view: rows are returned unchanged.
 */
export function scopeCitations(citations: CitationRow[], activeCompetitorIds: ReadonlySet<string>, clientView: boolean): CitationRow[] {
  if (!clientView) return citations
  return citations.map((c) => (c.ownerType === 'competitor' && !(c.competitorId && activeCompetitorIds.has(c.competitorId))
    ? { ...c, ownerType: 'external' as const, competitorId: null }
    : c))
}

/** Customer login: only mentions of ACTIVE competitors survive. */
export function scopeMentions(mentions: MentionRow[], activeCompetitorIds: ReadonlySet<string>, clientView: boolean): MentionRow[] {
  if (!clientView) return mentions
  return mentions.filter((m) => m.entityType !== 'competitor' || activeCompetitorIds.has(m.competitorId ?? m.entityKey))
}

// ── Shared input ─────────────────────────────────────────────────────────────

export interface PreviousData {
  range: AnalysisRange
  responses: Array<{ id: string; brandMentioned: boolean | null; brandRecommended: boolean | null }>
  citations: Array<{ responseId: string; domain: string; ownerType: CitationOwner }>
}

export interface AnalysisInput {
  ds: Dataset
  /** Run rows (start time) for the runs of the period. */
  runs: RunLite[]
  /** `${responseId}|${normalizedUrl}` -> stored position (0-based, as the runner stores it). */
  positions: Map<string, number>
  /** responseId -> tone of what the answer says about our brand. Missing = not counted. */
  tones: Map<string, Tone>
  prev: PreviousData | null
  /** competitor id -> name, any status. */
  competitorNames: Map<string, string>
  activeCompetitorIds: ReadonlySet<string>
  clientView: boolean
  range: AnalysisRange
  /** responseId -> sources the platform reported finding while searching. Missing = no platform reported any. */
  found?: Map<string, FoundSource[]>
}

function citationsByResponse(citations: CitationRow[]): Map<string, CitationRow[]> {
  const m = new Map<string, CitationRow[]>()
  for (const c of citations) pushTo(m, c.responseId, c)
  return m
}

function ownCitedSet(citations: CitationRow[]): Set<string> {
  const s = new Set<string>()
  for (const c of citations) if (c.ownerType === 'own') s.add(c.responseId)
  return s
}

function competitorCitedSet(citations: CitationRow[]): Set<string> {
  const s = new Set<string>()
  for (const c of citations) if (c.ownerType === 'competitor') s.add(c.responseId)
  return s
}

function promptTextOf(prompts: PromptLite[]): Map<string, string> {
  return new Map(prompts.map((p) => [p.id, clip(p.text, ANALYSIS_LIMITS.promptText)]))
}

// ── Totals / previous ────────────────────────────────────────────────────────

export function computeTotals(ds: Dataset, runCount: number): AnalysisTotals {
  const answers = ds.responses.length
  const cited = new Set(ds.citations.map((c) => c.responseId))
  const own = ownCitedSet(ds.citations)
  const comp = competitorCitedSet(ds.citations)
  const ownCitations = ds.citations.filter((c) => c.ownerType === 'own').length
  const mentioned = ds.responses.filter((r) => r.brandMentioned === true)
  const recommended = ds.responses.filter((r) => r.brandRecommended === true).length
  return {
    answers,
    answersWithCitations: cited.size,
    citations: ds.citations.length,
    domains: new Set(ds.citations.map((c) => c.domain).filter((d) => d !== '')).size,
    ownCitedAnswers: own.size,
    ownCitations,
    ownCitationShare: rate(ownCitations, ds.citations.length),
    citationRate: rate(own.size, answers),
    brandMentions: mentioned.length,
    mentionRate: rate(mentioned.length, answers),
    brandRecommended: recommended,
    recommendedRate: rate(recommended, answers),
    mentionedNotCited: mentioned.filter((r) => !own.has(r.id)).length,
    competitorCitedNotUs: ds.responses.filter((r) => comp.has(r.id) && !own.has(r.id)).length,
    runs: runCount,
    prompts: new Set(ds.responses.map((r) => r.promptId)).size,
  }
}

/** null when the previous period holds no answers. */
export function computePrevious(prev: PreviousData | null): AnalysisPrevious | null {
  if (!prev || prev.responses.length === 0) return null
  const n = prev.responses.length
  const own = new Set<string>()
  let ownCitations = 0
  for (const c of prev.citations) {
    if (c.ownerType === 'own') { own.add(c.responseId); ownCitations++ }
  }
  return {
    range: prev.range,
    answers: n,
    mentionRate: rate(prev.responses.filter((r) => r.brandMentioned === true).length, n),
    citationRate: rate(own.size, n),
    recommendedRate: rate(prev.responses.filter((r) => r.brandRecommended === true).length, n),
    ownCitationShare: rate(ownCitations, prev.citations.length),
    domains: new Set(prev.citations.map((c) => c.domain).filter((d) => d !== '')).size,
  }
}

// ── Runs / trend ─────────────────────────────────────────────────────────────

/** Runs with at least one answer, oldest first, the most recent `max`. */
export function computeRuns(responses: RespRow[], runs: RunLite[], max: number = ANALYSIS_LIMITS.runs): AnalysisRun[] {
  const counts = new Map<string, number>()
  const firstAt = new Map<string, number>()
  for (const r of responses) {
    bump(counts, r.runId)
    const t = r.collectedAt ? r.collectedAt.getTime() : 0
    const cur = firstAt.get(r.runId)
    if (t > 0 && (cur === undefined || t < cur)) firstAt.set(r.runId, t)
  }
  const startOf = new Map(runs.map((r) => [r.id, r.startedAt.getTime()]))
  const rows = Array.from(counts.entries()).map(([runId, answers]) => {
    const t = startOf.get(runId) ?? firstAt.get(runId) ?? 0
    return { runId, t, answers }
  })
  rows.sort((a, b) => a.t - b.t || a.runId.localeCompare(b.runId))
  return rows.slice(-max).map((r) => ({ runId: r.runId, date: new Date(r.t).toISOString(), answers: r.answers }))
}

function trendPoint(key: string, date: string, rs: RespRow[], own: Set<string>, comp: Set<string>, tones: Map<string, Tone>): TrendPoint {
  const n = rs.length
  const counts: SentimentCounts = { positive: 0, neutral: 0, mixed: 0, negative: 0 }
  let counted = 0
  for (const r of rs) {
    const t = tones.get(r.id)
    if (!t) continue
    counts[t]++
    counted++
  }
  return {
    key,
    date,
    answers: n,
    mentionRate: rate(rs.filter((r) => r.brandMentioned === true).length, n),
    citationRate: rate(rs.filter((r) => own.has(r.id)).length, n),
    recommendedRate: rate(rs.filter((r) => r.brandRecommended === true).length, n),
    competitorCitationRate: rate(rs.filter((r) => comp.has(r.id)).length, n),
    sentiment: counted > 0 ? counts : null,
  }
}

export function computeTrend(ds: Dataset, runs: AnalysisRun[], tones: Map<string, Tone>): { byDay: TrendPoint[]; byRun: TrendPoint[] } {
  const own = ownCitedSet(ds.citations)
  const comp = competitorCitedSet(ds.citations)
  const byDayMap = new Map<string, RespRow[]>()
  const byRunMap = new Map<string, RespRow[]>()
  for (const r of ds.responses) {
    if (r.collectedAt) pushTo(byDayMap, bangkokDay(r.collectedAt), r)
    pushTo(byRunMap, r.runId, r)
  }
  const byDay = Array.from(byDayMap.keys()).sort().map((day) => trendPoint(day, day, byDayMap.get(day) || [], own, comp, tones))
  const byRun = runs.map((run) => trendPoint(run.runId, run.date, byRunMap.get(run.runId) || [], own, comp, tones))
  return { byDay, byRun }
}

// ── Domains ──────────────────────────────────────────────────────────────────

function mostCommon(values: string[]): string {
  const m = new Map<string, number>()
  for (const v of values) if (v) bump(m, v)
  return topKeys(m, 1)[0] || ''
}

interface PageAcc {
  url: string
  titles: string[]
  citations: number
  answers: Set<string>
  prompts: Set<string>
  providers: Set<ProviderKey>
}

function buildPages(rows: CitationRow[]): PageAcc[] {
  const m = new Map<string, PageAcc>()
  for (const c of rows) {
    const key = c.normalizedUrl || c.url
    let p = m.get(key)
    if (!p) {
      p = { url: c.url, titles: [], citations: 0, answers: new Set(), prompts: new Set(), providers: new Set() }
      m.set(key, p)
    }
    p.citations++
    p.answers.add(c.responseId)
    p.prompts.add(c.promptId)
    p.providers.add(c.provider)
    if (c.title) p.titles.push(c.title)
  }
  return Array.from(m.values()).sort((a, b) => b.answers.size - a.answers.size || b.citations - a.citations || a.url.localeCompare(b.url))
}

export function computeSignals(args: {
  providersCiting: number
  providersTotal: number
  pageCount: number
  runsPresent: number
  runsTotal: number
  promptCount: number
  promptsAsked: number
  avgPosition: number | null
  titleMatch: { matched: number; considered: number }
  pageTypes: Map<string, number>
}): WhySignal[] {
  const out: WhySignal[] = []
  if (args.providersCiting >= 2) out.push({ code: 'multi_platform', value: args.providersCiting, total: args.providersTotal })
  if (args.pageCount >= 3) out.push({ code: 'many_pages', value: args.pageCount })
  if (args.runsTotal >= 2 && args.runsPresent / args.runsTotal >= 0.6) out.push({ code: 'consistent', value: args.runsPresent, total: args.runsTotal })
  if (args.promptCount >= 3) out.push({ code: 'many_prompts', value: args.promptCount, total: args.promptsAsked })
  if (args.avgPosition !== null && args.avgPosition <= 3) out.push({ code: 'top_position', value: Math.round(args.avgPosition * 10) / 10 })
  if (args.titleMatch.matched >= 1) out.push({ code: 'title_match', value: args.titleMatch.matched, total: args.titleMatch.considered })
  let typeTotal = 0
  args.pageTypes.forEach((n) => { typeTotal += n })
  if (typeTotal > 0) {
    const top = topKeys(args.pageTypes, 1)[0]
    const share = (args.pageTypes.get(top) || 0) / typeTotal
    if (top && top !== 'other' && share >= 0.6) out.push({ code: 'page_type', value: Math.round(share * 100), detail: top })
  }
  return out
}

export function computeDomains(input: AnalysisInput, runs: AnalysisRun[]): AnalysisDomainRow[] {
  const { ds } = input
  const totalAnswers = ds.responses.length
  if (totalAnswers === 0) return []
  const respById = new Map(ds.responses.map((r) => [r.id, r]))
  const promptText = promptTextOf(ds.prompts)
  const asked = new Map<string, number>()
  for (const r of ds.responses) bump(asked, r.promptId)
  const runAnswers = new Map<string, number>()
  for (const r of ds.responses) bump(runAnswers, r.runId)
  const providersTotal = new Set(ds.responses.map((r) => r.provider)).size

  const byDomain = new Map<string, CitationRow[]>()
  for (const c of ds.citations) if (c.domain) pushTo(byDomain, c.domain, c)

  // previous period: answers citing each domain
  const prevAnswers = new Map<string, Set<string>>()
  if (input.prev) for (const c of input.prev.citations) if (c.domain) addTo(prevAnswers, c.domain, c.responseId)
  const prevTotal = input.prev ? input.prev.responses.length : 0

  const ranked = Array.from(byDomain.entries()).map(([domain, rows]) => ({
    domain, rows, answers: new Set(rows.map((r) => r.responseId)).size,
  }))
  ranked.sort((a, b) => b.answers - a.answers || b.rows.length - a.rows.length || a.domain.localeCompare(b.domain))

  return ranked.slice(0, ANALYSIS_LIMITS.domains).map(({ domain, rows, answers }) => {
    const ownerType: CitationOwner = rows.some((r) => r.ownerType === 'own') ? 'own' : rows.some((r) => r.ownerType === 'competitor') ? 'competitor' : 'external'
    const compId = ownerType === 'competitor' ? mostCommon(rows.filter((r) => r.ownerType === 'competitor').map((r) => r.competitorId || '')) : ''
    const competitorName = ownerType === 'competitor' ? (input.competitorNames.get(compId) || '') : ''

    const byRun = new Map<string, Set<string>>()
    const promptAnswers = new Map<string, Set<string>>()
    const providers = new Set<ProviderKey>()
    const positions: number[] = []
    let sample: CitationRow | null = null
    let sampleAt = -1
    let lastAt = -1
    for (const c of rows) {
      addTo(byRun, c.runId, c.responseId)
      addTo(promptAnswers, c.promptId, c.responseId)
      providers.add(c.provider)
      const pos = input.positions.get(`${c.responseId}|${c.normalizedUrl}`)
      if (typeof pos === 'number' && Number.isFinite(pos)) positions.push(pos + 1)
      const at = respById.get(c.responseId)?.collectedAt?.getTime() ?? c.createdAt?.getTime() ?? 0
      if (at > lastAt) lastAt = at
      if (at > sampleAt) { sampleAt = at; sample = c }
    }
    const series = runs.map((run) => {
      const n = runAnswers.get(run.runId) || 0
      return n > 0 ? r4((byRun.get(run.runId)?.size || 0) / n) : 0
    })
    const avgPosition = positions.length > 0 ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 100) / 100 : null

    let previousAnswers: number | null = null
    let change: AnalysisDomainRow['change'] = null
    if (input.prev && prevTotal > 0) {
      previousAnswers = prevAnswers.get(domain)?.size || 0
      if (previousAnswers === 0) change = 'new'
      else {
        const diff = answers / totalAnswers - previousAnswers / prevTotal
        change = diff > ANALYSIS_LIMITS.sameTolerance ? 'up' : diff < -ANALYSIS_LIMITS.sameTolerance ? 'down' : 'same'
      }
    }

    const pageAccs = buildPages(rows)
    const pages: AnalysisPage[] = pageAccs.slice(0, ANALYSIS_LIMITS.pages).map((p) => ({
      url: p.url,
      title: clip(mostCommon(p.titles), ANALYSIS_LIMITS.title),
      pageType: inferPageType(p.url),
      citations: p.citations,
      answers: p.answers.size,
      prompts: p.prompts.size,
      providers: providerList(p.providers),
    }))
    const pageTypes = new Map<string, number>()
    for (const p of pageAccs) bump(pageTypes, inferPageType(p.url), p.citations)

    const promptsList = Array.from(promptAnswers.entries())
      .map(([promptId, s]) => ({ promptId, answers: s.size }))
      .sort((a, b) => b.answers - a.answers || a.promptId.localeCompare(b.promptId))
      .slice(0, ANALYSIS_LIMITS.prompts)
      .map((p) => ({ promptId: p.promptId, text: promptText.get(p.promptId) || '', answers: p.answers, asked: asked.get(p.promptId) || 0 }))

    // title_match: pages whose title or path shares a term with a prompt that led to them
    let matched = 0
    const considered = pageAccs.slice(0, ANALYSIS_LIMITS.pages)
    for (const p of considered) {
      const text = `${mostCommon(p.titles)} ${pathOfUrl(p.url)}`
      const ps = Array.from(p.prompts).slice(0, ANALYSIS_LIMITS.prompts)
      if (ps.some((id) => sharesTerm(promptText.get(id) || '', text))) matched++
    }

    const signals = computeSignals({
      providersCiting: providers.size,
      providersTotal,
      pageCount: pageAccs.length,
      runsPresent: series.filter((s) => s > 0).length,
      runsTotal: runs.length,
      promptCount: promptAnswers.size,
      promptsAsked: asked.size,
      avgPosition,
      titleMatch: { matched, considered: considered.length },
      pageTypes,
    })

    return {
      domain,
      ownerType,
      competitorName,
      siteType: inferSiteType(domain, pageAccs.map((p) => p.url), ownerType),
      citations: rows.length,
      answers,
      answerShare: rate(answers, totalAnswers),
      prompts: promptAnswers.size,
      providers: providerList(providers),
      runsPresent: series.filter((s) => s > 0).length,
      runsTotal: runs.length,
      series,
      avgPosition,
      previousAnswers,
      change,
      lastSeenAt: lastAt > 0 ? new Date(lastAt).toISOString() : null,
      vendor: null,
      isOwnPbn: false,
      pages,
      promptsList,
      signals,
      sample: sample ? { promptId: (sample as CitationRow).promptId, runId: (sample as CitationRow).runId, provider: (sample as CitationRow).provider } : null,
    }
  })
}

/** Attach backlink vendor / own-PBN flags; the customer view never gets them. */
export function applyDomainFlags(rows: AnalysisDomainRow[], flags: FlagSources | null, clientView: boolean): AnalysisDomainRow[] {
  if (clientView || !flags) return rows.map((r) => ({ ...r, vendor: null, isOwnPbn: false }))
  // Same key rule as applyFlags() in queries.ts
  return rows.map((r) => {
    const key = normalizeDomain(r.domain) || r.domain.toLowerCase()
    return { ...r, vendor: flags.vendors.get(key) ?? null, isOwnPbn: flags.pbn.has(key) }
  })
}

// ── Variation ────────────────────────────────────────────────────────────────

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  a.forEach((x) => { if (b.has(x)) inter++ })
  return inter / (a.size + b.size - inter)
}

export function computeVariation(input: AnalysisInput, runs: AnalysisRun[]): AnswerVariationRow[] {
  const { ds } = input
  const promptText = promptTextOf(ds.prompts)
  const byResp = citationsByResponse(ds.citations)
  const own = ownCitedSet(ds.citations)
  const mentionsByResp = new Map<string, MentionRow[]>()
  for (const m of scopeMentions(ds.mentions, input.activeCompetitorIds, input.clientView)) {
    if (m.entityType === 'competitor') pushTo(mentionsByResp, m.responseId, m)
  }
  const runStart = new Map<string, number>(input.runs.map((r) => [r.id, r.startedAt.getTime()]))
  for (const r of ds.responses) {
    if (!runStart.has(r.runId) && r.collectedAt) runStart.set(r.runId, r.collectedAt.getTime())
  }
  const runDate = new Map<string, string>(runs.map((r) => [r.runId, r.date]))

  // (promptId, provider) -> runId -> responses
  const pairs = new Map<string, Map<string, RespRow[]>>()
  for (const r of ds.responses) {
    const key = `${r.promptId}|${r.provider}`
    let m = pairs.get(key)
    if (!m) { m = new Map(); pairs.set(key, m) }
    pushTo(m, r.runId, r)
  }

  const domainsOf = (rs: RespRow[]): Set<string>[] => rs.map((r) => new Set((byResp.get(r.id) || []).map((c) => c.domain).filter((d) => d !== '')))

  const rows: AnswerVariationRow[] = []
  pairs.forEach((runMap, key) => {
    const sorted = Array.from(runMap.keys()).sort((a, b) => (runStart.get(a) || 0) - (runStart.get(b) || 0) || a.localeCompare(b))
    const latestId = sorted[sorted.length - 1]
    const prevId = sorted.length > 1 ? sorted[sorted.length - 2] : null
    const rs = runMap.get(latestId) || []
    if (rs.length === 0) return
    const sepAt = key.lastIndexOf('|')
    const promptId = key.slice(0, sepAt)
    const provider = key.slice(sepAt + 1) as ProviderKey
    if (!isProviderKey(provider)) return

    const sets = domainsOf(rs)
    const freq = new Map<string, number>()
    sets.forEach((s) => s.forEach((d) => bump(freq, d)))
    const asks = rs.length
    const always = asks >= 2 ? Array.from(freq.entries()).filter((e) => e[1] === asks).map((e) => e[0]) : Array.from(freq.keys())
    const alwaysSet = new Set(always)
    const sometimes = Array.from(freq.keys()).filter((d) => !alwaysSet.has(d))
    const byFreq = (list: string[]): string[] => list.sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0) || a.localeCompare(b)).slice(0, ANALYSIS_LIMITS.variationDomains)

    let stability: number | null = null
    if (asks >= 2) {
      let sum = 0
      let pairsN = 0
      for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { sum += jaccard(sets[i], sets[j]); pairsN++ }
      stability = pairsN > 0 ? r4(sum / pairsN) : null
    }

    let newDomains: string[] = []
    let lostDomains: string[] = []
    let mentionChange: number | null = null
    if (prevId) {
      const prs = runMap.get(prevId) || []
      const prevUnion = new Set<string>()
      domainsOf(prs).forEach((s) => s.forEach((d) => prevUnion.add(d)))
      const nowUnion = new Set(Array.from(freq.keys()))
      newDomains = Array.from(nowUnion).filter((d) => !prevUnion.has(d)).sort().slice(0, ANALYSIS_LIMITS.variationDomains)
      lostDomains = Array.from(prevUnion).filter((d) => !nowUnion.has(d)).sort().slice(0, ANALYSIS_LIMITS.variationDomains)
      const nowRate = rate(rs.filter((r) => r.brandMentioned === true).length, rs.length)
      const prevRate = rate(prs.filter((r) => r.brandMentioned === true).length, prs.length)
      mentionChange = nowRate !== null && prevRate !== null ? r4(nowRate - prevRate) : null
    }

    const compAnswers = new Map<string, Set<string>>()
    const compNameOf = new Map<string, string>()
    for (const r of rs) {
      for (const m of mentionsByResp.get(r.id) || []) {
        const id = m.competitorId ?? m.entityKey
        const name = input.competitorNames.get(id) || m.entityName
        if (!name) continue
        addTo(compAnswers, id, r.id)
        compNameOf.set(id, name)
      }
    }
    const competitorsMentioned = Array.from(compAnswers.entries())
      .map(([id, s]) => ({ name: compNameOf.get(id) || '', answers: s.size }))
      .sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name))
      .slice(0, ANALYSIS_LIMITS.variationCompetitors)

    rows.push({
      promptId,
      promptText: promptText.get(promptId) || '',
      provider,
      providerLabel: providerLabelFor(provider, input.clientView),
      runId: latestId,
      runDate: runDate.get(latestId) || new Date(runStart.get(latestId) || 0).toISOString(),
      asks,
      brandMentioned: rs.filter((r) => r.brandMentioned === true).length,
      brandRecommended: rs.filter((r) => r.brandRecommended === true).length,
      ownCited: rs.filter((r) => own.has(r.id)).length,
      distinctDomains: freq.size,
      alwaysCited: byFreq(always),
      sometimesCited: byFreq(sometimes),
      stability,
      previousRunId: prevId,
      newDomains,
      lostDomains,
      mentionChange,
      competitorsMentioned,
    })
  })

  rows.sort((a, b) => {
    if (a.stability === null && b.stability !== null) return 1
    if (b.stability === null && a.stability !== null) return -1
    if (a.stability !== null && b.stability !== null && a.stability !== b.stability) return a.stability - b.stability
    return b.asks - a.asks || a.promptId.localeCompare(b.promptId) || a.provider.localeCompare(b.provider)
  })
  return rows.slice(0, ANALYSIS_LIMITS.variation)
}

// ── Own pages / gaps ─────────────────────────────────────────────────────────

export function computeOwnPages(input: AnalysisInput): OwnPageRow[] {
  const { ds } = input
  const promptText = promptTextOf(ds.prompts)
  const m = new Map<string, { url: string; titles: string[]; citations: number; answers: Set<string>; prompts: Map<string, number>; providers: Set<ProviderKey> }>()
  for (const c of ds.citations) {
    if (c.ownerType !== 'own') continue
    const key = c.normalizedUrl || c.url
    let p = m.get(key)
    if (!p) {
      p = { url: c.url, titles: [], citations: 0, answers: new Set(), prompts: new Map(), providers: new Set() }
      m.set(key, p)
    }
    p.citations++
    p.answers.add(c.responseId)
    bump(p.prompts, c.promptId)
    p.providers.add(c.provider)
    if (c.title) p.titles.push(c.title)
  }
  return Array.from(m.values())
    .sort((a, b) => b.answers.size - a.answers.size || b.citations - a.citations || a.url.localeCompare(b.url))
    .slice(0, ANALYSIS_LIMITS.ownPages)
    .map((p) => ({
      url: p.url,
      title: clip(mostCommon(p.titles), ANALYSIS_LIMITS.title),
      citations: p.citations,
      answers: p.answers.size,
      prompts: topKeys(p.prompts, ANALYSIS_LIMITS.ownPagePrompts).map((id) => ({ promptId: id, text: promptText.get(id) || '' })),
      providers: providerList(p.providers),
    }))
}

export function computeGaps(input: AnalysisInput): { mentionedNotCited: MentionedNotCitedRow[]; competitorCitedNotUs: CompetitorCitedRow[] } {
  const { ds } = input
  const promptText = promptTextOf(ds.prompts)
  const byResp = citationsByResponse(ds.citations)
  const own = ownCitedSet(ds.citations)
  const asked = new Map<string, number>()
  for (const r of ds.responses) bump(asked, r.promptId)

  const mnc = new Map<string, { answers: number; providers: Set<ProviderKey>; domains: Map<string, number> }>()
  const ccn = new Map<string, { answers: number; comps: Map<string, { name: string; domain: string; answers: Set<string> }> }>()
  for (const r of ds.responses) {
    if (own.has(r.id)) continue
    const cites = byResp.get(r.id) || []
    if (r.brandMentioned === true) {
      let g = mnc.get(r.promptId)
      if (!g) { g = { answers: 0, providers: new Set(), domains: new Map() }; mnc.set(r.promptId, g) }
      g.answers++
      g.providers.add(r.provider)
      new Set(cites.map((c) => c.domain).filter((d) => d !== '')).forEach((d) => bump(g!.domains, d))
    }
    const compCites = cites.filter((c) => c.ownerType === 'competitor')
    if (compCites.length > 0) {
      let g = ccn.get(r.promptId)
      if (!g) { g = { answers: 0, comps: new Map() }; ccn.set(r.promptId, g) }
      g.answers++
      for (const c of compCites) {
        const key = `${c.competitorId || ''}|${c.domain}`
        let e = g.comps.get(key)
        if (!e) {
          e = { name: (c.competitorId && input.competitorNames.get(c.competitorId)) || '', domain: c.domain, answers: new Set() }
          g.comps.set(key, e)
        }
        e.answers.add(r.id)
      }
    }
  }

  const mentionedNotCited: MentionedNotCitedRow[] = Array.from(mnc.entries())
    .map(([promptId, g]) => ({
      promptId,
      text: promptText.get(promptId) || '',
      answers: g.answers,
      asked: asked.get(promptId) || 0,
      providers: providerList(g.providers),
      citedInstead: topKeys(g.domains, ANALYSIS_LIMITS.citedInstead),
    }))
    .sort((a, b) => b.answers - a.answers || a.promptId.localeCompare(b.promptId))
    .slice(0, ANALYSIS_LIMITS.gaps)

  const competitorCitedNotUs: CompetitorCitedRow[] = Array.from(ccn.entries())
    .map(([promptId, g]) => ({
      promptId,
      text: promptText.get(promptId) || '',
      answers: g.answers,
      asked: asked.get(promptId) || 0,
      competitors: Array.from(g.comps.values())
        .map((e) => ({ name: e.name, domain: e.domain, answers: e.answers.size }))
        .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain))
        .slice(0, ANALYSIS_LIMITS.gapCompetitors),
    }))
    .filter((r) => r.competitors.length > 0)
    .sort((a, b) => b.answers - a.answers || a.promptId.localeCompare(b.promptId))
    .slice(0, ANALYSIS_LIMITS.gaps)

  return { mentionedNotCited, competitorCitedNotUs }
}

// ── Which page to fix / found but not cited ──────────────────────────────────

const FIX_ORDER: Record<FixAction, number> = { create: 0, make_citable: 1, strengthen: 2, keep: 3 }

/** Own citations win over the rest: ownAnswers * 2 >= asked is "keep" (at least half the answers link to us). */
export function fixActionOf(asked: number, ownAnswers: number, mentionedAnswers: number): FixAction {
  if (ownAnswers > 0) return ownAnswers * 2 >= asked ? 'keep' : 'strengthen'
  return mentionedAnswers > 0 ? 'make_citable' : 'create'
}

interface FixPageAcc { url: string; titles: string[]; answers: Set<string> }

export function computeFixPages(input: AnalysisInput): PromptFixRow[] {
  if (input.clientView) return []
  const { ds } = input
  const promptText = promptTextOf(ds.prompts)
  const byResp = citationsByResponse(ds.citations)
  const own = ownCitedSet(ds.citations)

  const perPrompt = new Map<string, {
    asked: number; ownAnswers: number; mentioned: number
    own: Map<string, FixPageAcc>
    instead: Map<string, FixPageAcc & { domain: string; ownerType: 'competitor' | 'external'; compIds: string[] }>
  }>()
  for (const r of ds.responses) {
    let g = perPrompt.get(r.promptId)
    if (!g) { g = { asked: 0, ownAnswers: 0, mentioned: 0, own: new Map(), instead: new Map() }; perPrompt.set(r.promptId, g) }
    g.asked++
    if (r.brandMentioned === true) g.mentioned++
    const cites = byResp.get(r.id) || []
    const ownCited = own.has(r.id)
    if (ownCited) g.ownAnswers++
    for (const c of cites) {
      const key = c.normalizedUrl || c.url
      if (c.ownerType === 'own') {
        let p = g.own.get(key)
        if (!p) { p = { url: c.url, titles: [], answers: new Set() }; g.own.set(key, p) }
        p.answers.add(r.id)
        if (c.title) p.titles.push(c.title)
      } else if (!ownCited) {
        let p = g.instead.get(key)
        if (!p) {
          p = { url: c.url, titles: [], answers: new Set(), domain: c.domain, ownerType: c.ownerType === 'competitor' ? 'competitor' : 'external', compIds: [] }
          g.instead.set(key, p)
        }
        p.answers.add(r.id)
        if (c.title) p.titles.push(c.title)
        if (c.ownerType === 'competitor' && c.competitorId) p.compIds.push(c.competitorId)
      }
    }
  }

  const rows: PromptFixRow[] = Array.from(perPrompt.entries()).map(([promptId, g]) => ({
    promptId,
    text: promptText.get(promptId) || '',
    asked: g.asked,
    ownAnswers: g.ownAnswers,
    mentionedAnswers: g.mentioned,
    ownPages: Array.from(g.own.values())
      .sort((a, b) => b.answers.size - a.answers.size || a.url.localeCompare(b.url))
      .slice(0, ANALYSIS_LIMITS.fixPagesPerRow)
      .map((p) => ({ url: p.url, title: clip(mostCommon(p.titles), ANALYSIS_LIMITS.title), answers: p.answers.size })),
    insteadPages: Array.from(g.instead.values())
      .sort((a, b) => b.answers.size - a.answers.size || a.url.localeCompare(b.url))
      .slice(0, ANALYSIS_LIMITS.fixPagesPerRow)
      .map((p) => ({
        url: p.url,
        domain: p.domain,
        title: clip(mostCommon(p.titles), ANALYSIS_LIMITS.title),
        ownerType: p.ownerType,
        competitorName: p.ownerType === 'competitor' ? (input.competitorNames.get(mostCommon(p.compIds)) || null) : null,
        answers: p.answers.size,
      })),
    action: fixActionOf(g.asked, g.ownAnswers, g.mentioned),
  }))
  rows.sort((a, b) => FIX_ORDER[a.action] - FIX_ORDER[b.action] || b.asked - a.asked || a.text.localeCompare(b.text) || a.promptId.localeCompare(b.promptId))
  return rows.slice(0, ANALYSIS_LIMITS.fixPages)
}

export function computeFoundFunnel(input: AnalysisInput): FoundFunnel | null {
  if (input.clientView || !input.found) return null
  const { ds } = input
  const promptText = promptTextOf(ds.prompts)
  const byResp = citationsByResponse(ds.citations)
  const own = ownCitedSet(ds.citations)

  let withData = 0
  let found = 0
  let foundAndCited = 0
  let foundAndMentioned = 0
  const providers = new Set<ProviderKey>()
  const pages = new Map<string, { url: string; titles: string[]; found: number; cited: number; prompts: Map<string, number> }>()
  for (const r of ds.responses) {
    const list = input.found.get(r.id)
    if (!list || list.length === 0) continue
    withData++
    providers.add(r.provider)
    const ours = list.filter((f) => f.ownerType === 'own')
    if (ours.length === 0) continue
    found++
    if (own.has(r.id)) foundAndCited++
    if (r.brandMentioned === true) foundAndMentioned++
    // Same URL key the citations were stored with, so a found page matches the citation of that page.
    const citedKeys = new Set((byResp.get(r.id) || []).map((c) => c.normalizedUrl || c.url))
    const seen = new Set<string>()
    for (const f of ours) {
      const key = normalizeUrl(f.url) || f.url
      if (seen.has(key)) continue
      seen.add(key)
      let p = pages.get(key)
      if (!p) { p = { url: f.url, titles: [], found: 0, cited: 0, prompts: new Map() }; pages.set(key, p) }
      p.found++
      if (f.title) p.titles.push(f.title)
      if (citedKeys.has(key)) p.cited++
      else bump(p.prompts, r.promptId)
    }
  }
  if (withData === 0) return null

  const rows: FoundNotCitedPage[] = Array.from(pages.values())
    .filter((p) => p.cited < p.found)
    .sort((a, b) => (b.found - b.cited) - (a.found - a.cited) || b.found - a.found || a.url.localeCompare(b.url))
    .slice(0, ANALYSIS_LIMITS.foundPages)
    .map((p) => ({
      url: p.url,
      title: clip(mostCommon(p.titles), ANALYSIS_LIMITS.title),
      found: p.found,
      cited: p.cited,
      prompts: topKeys(p.prompts, ANALYSIS_LIMITS.foundPagePrompts).map((id) => ({ promptId: id, text: promptText.get(id) || '' })),
    }))
  return { withData, found, foundAndCited, foundAndMentioned, providers: providerList(providers), pages: rows }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function emptyCitationAnalysis(range: AnalysisRange, brandName: string, configured: boolean): CitationAnalysisDTO {
  return {
    configured,
    hasData: false,
    brandName,
    range,
    totals: computeTotals({ brandName, responses: [], mentions: [], citations: [], prompts: [], competitors: [] }, 0),
    previous: null,
    runs: [],
    trend: { byDay: [], byRun: [] },
    domains: [],
    variation: [],
    ownPages: [],
    gaps: { mentionedNotCited: [], competitorCitedNotUs: [] },
    fixPages: [],
    foundFunnel: null,
  }
}

/** Pure assembly of every part of the report except vendor flags. */
export function assembleCitationAnalysis(input: AnalysisInput): CitationAnalysisDTO {
  const ds: Dataset = {
    ...input.ds,
    citations: scopeCitations(input.ds.citations, input.activeCompetitorIds, input.clientView),
    mentions: scopeMentions(input.ds.mentions, input.activeCompetitorIds, input.clientView),
  }
  const scoped: AnalysisInput = { ...input, ds }
  if (ds.responses.length === 0) return emptyCitationAnalysis(input.range, ds.brandName, true)
  const allRuns = new Set(ds.responses.map((r) => r.runId)).size
  const runs = computeRuns(ds.responses, input.runs)
  return {
    configured: true,
    hasData: true,
    brandName: ds.brandName,
    range: input.range,
    totals: computeTotals(ds, allRuns),
    previous: computePrevious(input.prev),
    runs,
    trend: computeTrend(ds, runs, input.tones),
    domains: computeDomains(scoped, runs),
    variation: computeVariation(scoped, runs),
    ownPages: computeOwnPages(scoped),
    gaps: computeGaps(scoped),
    fixPages: computeFixPages(scoped),
    foundFunnel: computeFoundFunnel(scoped),
  }
}

// ── Loader ───────────────────────────────────────────────────────────────────

/** Tone of what an answer says about OUR brand (the 'brand' entity of its stored sentiment). */
async function loadBrandTones(base: { organizationId: string; projectId: string }, runIds: string[], respIds: Set<string>): Promise<Map<string, Tone>> {
  const out = new Map<string, Tone>()
  if (runIds.length === 0) return out
  const { prisma } = await import('@/lib/prisma')
  const { isMissingTable } = await import('./server')
  try {
    const rows = await prisma.brandRadarInsight.findMany({
      where: { ...base, runId: { in: runIds } },
      select: { responseId: true, sentiment: true },
    })
    for (const r of rows) {
      if (!respIds.has(r.responseId)) continue
      const s = parseStoredSentiment(r.sentiment)
      const brand = s ? s.entities.find((e) => e.entityType === 'brand') : undefined
      if (brand) out.set(r.responseId, brand.tone)
    }
  } catch (e) {
    if (!isMissingTable(e)) throw e
  }
  return out
}

/** Sources each answer's platform reported finding while searching (only some platforms do). */
async function loadFoundSources(base: { organizationId: string; projectId: string }, runIds: string[], respIds: Set<string>): Promise<Map<string, FoundSource[]>> {
  const out = new Map<string, FoundSource[]>()
  if (runIds.length === 0) return out
  const { prisma } = await import('@/lib/prisma')
  const { isMissingTable } = await import('./server')
  try {
    const rows = await prisma.brandRadarInsight.findMany({
      where: { ...base, runId: { in: runIds } },
      select: { responseId: true, foundSources: true },
    })
    for (const r of rows) {
      if (!respIds.has(r.responseId)) continue
      const list = parseStoredFoundSources(r.foundSources)
      if (list.length > 0) out.set(r.responseId, list)
    }
  } catch (e) {
    if (!isMissingTable(e)) throw e
  }
  return out
}

/** The period of the same length right before the range: answers and the citations needed for the comparison. Two queries. */
async function loadPreviousData(ctx: RadarCtx, filters: RadarFilters, promptIds: ReadonlySet<string>, activeIds: ReadonlySet<string>): Promise<PreviousData | null> {
  if (!filters.from || !filters.to) return null
  const prev = previousRange(filters.from, filters.to)
  if (!prev || promptIds.size === 0) return null
  const { prisma } = await import('@/lib/prisma')
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const range = parseDayRange(prev.from, prev.to)
  const where: Prisma.BrandRadarResponseWhereInput = { ...base, status: 'DONE', promptId: { in: Array.from(promptIds) } }
  if (range.gte || range.lte) where.collectedAt = { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) }
  if (filters.country && filters.country !== 'all') where.country = filters.country
  if (filters.language && filters.language !== 'all') where.language = filters.language
  if (filters.provider !== 'all') where.provider = filters.provider
  const respRaw = await prisma.brandRadarResponse.findMany({
    where,
    select: { id: true, runId: true, promptId: true, brandMentioned: true, brandRecommended: true },
  })
  const resp = respRaw.filter((r) => promptIds.has(r.promptId))
  if (resp.length === 0) return null
  const respIds = new Set(resp.map((r) => r.id))
  const runIds = Array.from(new Set(resp.map((r) => r.runId)))
  const cRaw = await prisma.brandRadarCitation.findMany({
    where: { ...base, runId: { in: runIds }, ...(filters.provider !== 'all' ? { provider: filters.provider } : {}) },
    select: { responseId: true, domain: true, ownerType: true, competitorId: true },
  })
  const citations = cRaw.filter((c) => respIds.has(c.responseId)).map((c) => {
    const type: CitationOwner = c.ownerType === 'own' ? 'own' : c.ownerType === 'competitor' ? 'competitor' : 'external'
    const hidden = !!ctx.clientView && type === 'competitor' && !(c.competitorId && activeIds.has(c.competitorId))
    return { responseId: c.responseId, domain: c.domain, ownerType: hidden ? 'external' as const : type }
  })
  return {
    range: prev,
    responses: resp.map((r) => ({ id: r.id, brandMentioned: r.brandMentioned, brandRecommended: r.brandRecommended })),
    citations,
  }
}

function rangeOf(filters: RadarFilters, responses: RespRow[]): AnalysisRange {
  if (filters.from && filters.to) return { from: filters.from, to: filters.to }
  const days = responses.filter((r) => r.collectedAt).map((r) => bangkokDay(r.collectedAt as Date)).sort()
  return { from: filters.from || days[0] || '', to: filters.to || days[days.length - 1] || '' }
}

export async function buildCitationAnalysis(ctx: RadarCtx, filters: RadarFilters): Promise<CitationAnalysisDTO> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const clientView = !!ctx.clientView
  // Server-only modules are loaded here so the pure functions above stay importable from a plain script.
  const { prisma } = await import('@/lib/prisma')
  const { loadDataset, loadFlagSources } = await import('./queries')
  const loaded = await loadDataset(ctx, filters, {})
  const { ds, runs: runRows, promptRows, configured } = loaded
  const range = rangeOf(filters, ds.responses)
  if (!configured) return emptyCitationAnalysis(range, ds.brandName, false)
  if (ds.responses.length === 0) return emptyCitationAnalysis(range, ds.brandName, true)

  const respIds = new Set(ds.responses.map((r) => r.id))
  const runIds = Array.from(new Set(ds.responses.map((r) => r.runId)))
  const activeComps: CompLite[] = ds.competitors
  const activeIds = new Set(activeComps.map((c) => c.id))

  // Positions come with the citations loadDataset already read: no second pass over the citation table.
  const positions = new Map<string, number>()
  for (const c of ds.citations) if (typeof c.position === 'number') positions.set(`${c.responseId}|${c.normalizedUrl}`, c.position)
  const [compRows, tones, found, prev, flags] = await Promise.all([
    prisma.brandRadarCompetitor.findMany({ where: base, select: { id: true, name: true } }),
    loadBrandTones(base, runIds, respIds),
    loadFoundSources(base, runIds, respIds),
    loadPreviousData(ctx, filters, new Set(promptRows.map((p) => p.id)), activeIds),
    clientView ? Promise.resolve(null) : loadFlagSources(ctx.orgId),
  ])
  const competitorNames = new Map(compRows.map((c) => [c.id, c.name]))
  // The customer view only ever sees the names of ACTIVE competitors.
  if (clientView) competitorNames.forEach((_name, id) => { if (!activeIds.has(id)) competitorNames.delete(id) })

  const dto = assembleCitationAnalysis({
    ds, runs: runRows, positions, tones, found, prev, competitorNames, activeCompetitorIds: activeIds, clientView, range,
  })
  return { ...dto, domains: applyDomainFlags(dto.domains, flags, clientView) }
}
