/**
 * Brand Radar insight: pure helpers (no database, no network).
 *
 *  - what an answer's stored insight row holds (the AI's own search queries + the sentiment analysis)
 *  - the roll-up shown on the report: Search Query Groups, brand sentiment for the brand and competitors
 *  - how the brand is brought up (mention style) and the per-day visibility trend
 *
 * Everything that comes from a model (queries, group names, summaries, descriptors) is untrusted text.
 * It is validated against the fixed vocabularies here, length-capped, and only ever rendered as text.
 */
import type { Dataset } from './metrics'
import {
  BRAND_POSITIONINGS, BRAND_POSITIONING_LABEL, answerZone, SEARCH_QUERY_SUPPORT, SENTIMENT_FACTORS, SENTIMENT_FACTOR_LABEL,
  type AnswerInsightDTO, type AnswerSentiment, type AnswerSentimentEntity, type BrandPositioning, type CitationOwner, type EntityShare, type FactorPolarity,
  type InsightEntityDTO, type MentionStyleCounts, type ProviderKey, type QueryGroupDTO, type SentimentFactor, type SentimentTone,
} from './types'

export const INSIGHT_LIMITS = {
  queryMaxLen: 300,
  queriesPerAnswer: 20,
  groupNameMax: 60,
  summaryMax: 240,
  descriptorMax: 40,
  descriptorsPerEntity: 3,
  positioningPerEntity: 3,
  factorsPerEntity: 6,
  factorsPerAnswer: 6,
  /** report caps */
  queryGroups: 30,
  promptsPerGroup: 5,
  queriesPerGroup: 10,
  descriptorsShown: 12,
  summariesShown: 3,
  trendCompetitors: 5,
  sources: 15,
} as const

const BANGKOK_MS = 7 * 3600_000

/** Calendar day in Asia/Bangkok as YYYY-MM-DD */
export function bangkokDay(d: Date): string {
  return new Date(d.getTime() + BANGKOK_MS).toISOString().slice(0, 10)
}

const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null)

// ── Stored values ────────────────────────────────────────────────────────────

/** Same query typed with different case or spacing is one query */
export function normalizeQueryKey(q: string): string {
  return q.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, INSIGHT_LIMITS.queryMaxLen)
}

export function cleanQueries(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of value) {
    if (typeof v !== 'string') continue
    const q = v.replace(/\s+/g, ' ').trim().slice(0, INSIGHT_LIMITS.queryMaxLen)
    const key = normalizeQueryKey(q)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= INSIGHT_LIMITS.queriesPerAnswer) break
  }
  return out
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function parseStoredQueries(raw: string | null | undefined): string[] {
  return cleanQueries(parseJson(raw))
}

/** A page the AI found while searching but did not cite. Everything here is untrusted web text. */
export interface FoundSource { url: string; domain: string; title: string; ownerType: CitationOwner }

const FOUND_SOURCES_MAX = 30
const FOUND_TITLE_MAX = 300
const OWNER_TYPES: readonly CitationOwner[] = ['own', 'competitor', 'external']

/** Keep only well-formed http(s) pages, one per URL; an unknown owner type falls back to a third party. */
export function cleanFoundSources(v: unknown): FoundSource[] {
  if (!Array.isArray(v)) return []
  const out: FoundSource[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (out.length >= FOUND_SOURCES_MAX) break
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url.trim() : ''
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      domain: oneLine(o.domain, 200),
      title: oneLine(o.title, FOUND_TITLE_MAX),
      ownerType: OWNER_TYPES.includes(o.ownerType as CitationOwner) ? (o.ownerType as CitationOwner) : 'external',
    })
  }
  return out
}

export function parseStoredFoundSources(s: string | null | undefined): FoundSource[] {
  return cleanFoundSources(parseJson(s))
}

const TONES: readonly SentimentTone[] = ['positive', 'neutral', 'negative', 'mixed']
const POLARITIES: readonly FactorPolarity[] = ['positive', 'negative', 'neutral']
const isTone = (v: unknown): v is SentimentTone => TONES.includes(v as SentimentTone)
const isPolarity = (v: unknown): v is FactorPolarity => POLARITIES.includes(v as FactorPolarity)
const isFactor = (v: unknown): v is SentimentFactor => SENTIMENT_FACTORS.includes(v as SentimentFactor)
const isPositioning = (v: unknown): v is BrandPositioning => BRAND_POSITIONINGS.includes(v as BrandPositioning)

const oneLine = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export interface SentimentEntityRef {
  entityType: 'brand' | 'competitor'
  key: string
  name: string
}

/**
 * Validate one sentiment object, whatever wrote it (the model, or our own stored JSON).
 * `resolve` maps the key found in the object to a tracked entity; entities it does not know are dropped,
 * so a model can never add a brand that is not tracked. Unknown tones, factors and positionings are dropped too.
 * Returns null when nothing usable is left.
 */
export function sanitizeSentiment(value: unknown, resolve: (key: string, raw: Record<string, unknown>) => SentimentEntityRef | null): AnswerSentiment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>

  const factors: SentimentFactor[] = []
  for (const f of Array.isArray(o.factors) ? o.factors : []) {
    if (isFactor(f) && !factors.includes(f)) factors.push(f)
    if (factors.length >= INSIGHT_LIMITS.factorsPerAnswer) break
  }

  const entities: AnswerSentimentEntity[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(o.entities) ? o.entities : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const e = raw as Record<string, unknown>
    if (typeof e.key !== 'string' || !isTone(e.tone)) continue
    const ref = resolve(e.key, e)
    if (!ref || seen.has(ref.key)) continue
    seen.add(ref.key)

    const positioning: BrandPositioning[] = []
    for (const p of Array.isArray(e.positioning) ? e.positioning : []) {
      if (isPositioning(p) && !positioning.includes(p)) positioning.push(p)
      if (positioning.length >= INSIGHT_LIMITS.positioningPerEntity) break
    }

    const entityFactors: Array<{ code: SentimentFactor; polarity: FactorPolarity }> = []
    for (const f of Array.isArray(e.factors) ? e.factors : []) {
      if (!f || typeof f !== 'object') continue
      const ff = f as Record<string, unknown>
      if (!isFactor(ff.code) || entityFactors.some((x) => x.code === ff.code)) continue
      entityFactors.push({ code: ff.code, polarity: isPolarity(ff.polarity) ? ff.polarity : 'neutral' })
      if (entityFactors.length >= INSIGHT_LIMITS.factorsPerEntity) break
    }

    const descriptors: string[] = []
    for (const d of Array.isArray(e.descriptors) ? e.descriptors : []) {
      const text = oneLine(d, INSIGHT_LIMITS.descriptorMax).toLowerCase()
      const words = text ? text.split(' ').length : 0
      if (!text || words > 4 || descriptors.includes(text)) continue
      descriptors.push(text)
      if (descriptors.length >= INSIGHT_LIMITS.descriptorsPerEntity) break
    }

    entities.push({
      entityType: ref.entityType, key: ref.key, name: ref.name, tone: e.tone, positioning, factors: entityFactors,
      summary: oneLine(e.summary, INSIGHT_LIMITS.summaryMax), descriptors,
    })
  }

  if (entities.length === 0 && factors.length === 0) return null
  return { factors, entities }
}

/** Read the sentiment JSON kept on an insight row */
export function parseStoredSentiment(raw: string | null | undefined): AnswerSentiment | null {
  return sanitizeSentiment(parseJson(raw), (key, e) => {
    const entityType = e.entityType === 'brand' || key === 'brand' ? 'brand' : 'competitor'
    return { entityType, key: entityType === 'brand' ? 'brand' : key, name: oneLine(e.name, 120) }
  })
}

// ── Search Query Groups + sentiment roll-up ──────────────────────────────────

export interface InsightRow {
  responseId: string
  promptId: string
  provider: ProviderKey
  /** newest first is not required; `at` orders the summaries */
  at: number
  searchQueries: string[]
  sentiment: AnswerSentiment | null
}

export interface InsightInput {
  /** false = the insight table is not there yet */
  available: boolean
  rows: InsightRow[]
  /** normalized query key -> group name; a query without a group is its own group */
  groups: Map<string, string>
  promptText: Map<string, string>
  /** current names of tracked entities ('brand' or competitor id); wins over the name stored with the analysis */
  entityNames: Map<string, string>
}

const emptyTones = (): Record<SentimentTone, number> => ({ positive: 0, neutral: 0, negative: 0, mixed: 0 })

export function emptyInsight(available: boolean): AnswerInsightDTO {
  return { available, analyzed: 0, factors: [], overallTones: emptyTones(), entities: [], answersWithQueries: 0, searches: 0, queryGroups: [] }
}

interface GroupAcc {
  group: string
  searches: number
  answers: Set<string>
  providers: Set<ProviderKey>
  prompts: Map<string, number>
  queries: Map<string, { query: string; searches: number }>
}

interface EntityAcc {
  entityType: 'brand' | 'competitor'
  key: string
  name: string
  answers: number
  tones: Record<SentimentTone, number>
  positioning: Map<BrandPositioning, number>
  factors: Map<SentimentFactor, { answers: number; positive: number; negative: number; neutral: number }>
  summaries: Array<{ at: number; text: string }>
  descriptors: Map<string, number>
}

export function aggregateInsight(input: InsightInput): AnswerInsightDTO {
  if (!input.available) return emptyInsight(false)

  // Search Query Groups. Only platforms that hand back their own queries count: on Google the "query" is the
  // question we asked, and the other platforms do not return theirs.
  const groupAcc = new Map<string, GroupAcc>()
  let answersWithQueries = 0
  let searches = 0
  for (const r of input.rows) {
    if (SEARCH_QUERY_SUPPORT[r.provider] !== 'exposed' || r.searchQueries.length === 0) continue
    answersWithQueries++
    for (const q of r.searchQueries) {
      const key = normalizeQueryKey(q)
      if (!key) continue
      const name = (input.groups.get(key) || '').trim() || q
      const groupKey = normalizeQueryKey(name)
      let g = groupAcc.get(groupKey)
      if (!g) {
        g = { group: name, searches: 0, answers: new Set(), providers: new Set(), prompts: new Map(), queries: new Map() }
        groupAcc.set(groupKey, g)
      }
      g.searches++
      searches++
      g.answers.add(r.responseId)
      g.providers.add(r.provider)
      g.prompts.set(r.promptId, (g.prompts.get(r.promptId) || 0) + 1)
      const qq = g.queries.get(key)
      if (qq) qq.searches++
      else g.queries.set(key, { query: q, searches: 1 })
    }
  }
  const queryGroups: QueryGroupDTO[] = Array.from(groupAcc.values())
    .sort((a, b) => b.searches - a.searches || a.group.localeCompare(b.group))
    .slice(0, INSIGHT_LIMITS.queryGroups)
    .map((g) => ({
      group: g.group,
      searches: g.searches,
      answers: g.answers.size,
      providers: Array.from(g.providers),
      prompts: Array.from(g.prompts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, INSIGHT_LIMITS.promptsPerGroup)
        .map(([promptId, n]) => ({ promptId, text: input.promptText.get(promptId) || '', searches: n })),
      queries: Array.from(g.queries.values())
        .sort((a, b) => b.searches - a.searches || a.query.localeCompare(b.query))
        .slice(0, INSIGHT_LIMITS.queriesPerGroup),
    }))

  // Sentiment
  let analyzed = 0
  const factorAnswers = new Map<SentimentFactor, number>()
  const overallTones = emptyTones()
  const entityAcc = new Map<string, EntityAcc>()
  for (const r of input.rows) {
    const s = r.sentiment
    if (!s) continue
    analyzed++
    for (const f of s.factors) factorAnswers.set(f, (factorAnswers.get(f) || 0) + 1)
    for (const e of s.entities) {
      let acc = entityAcc.get(e.key)
      if (!acc) {
        acc = {
          entityType: e.entityType, key: e.key, name: input.entityNames.get(e.key) || e.name || e.key, answers: 0,
          tones: emptyTones(), positioning: new Map(), factors: new Map(), summaries: [], descriptors: new Map(),
        }
        entityAcc.set(e.key, acc)
      }
      acc.answers++
      acc.tones[e.tone]++
      overallTones[e.tone]++
      for (const p of e.positioning) acc.positioning.set(p, (acc.positioning.get(p) || 0) + 1)
      for (const f of e.factors) {
        const cur = acc.factors.get(f.code) || { answers: 0, positive: 0, negative: 0, neutral: 0 }
        cur.answers++
        cur[f.polarity]++
        acc.factors.set(f.code, cur)
      }
      if (e.summary) acc.summaries.push({ at: r.at, text: e.summary })
      for (const d of e.descriptors) acc.descriptors.set(d, (acc.descriptors.get(d) || 0) + 1)
    }
  }

  const entities: InsightEntityDTO[] = Array.from(entityAcc.values())
    .sort((a, b) => (a.entityType === 'brand' ? -1 : b.entityType === 'brand' ? 1 : b.answers - a.answers || a.name.localeCompare(b.name)))
    .map((a) => {
      const summaries: string[] = []
      for (const s of a.summaries.sort((x, y) => y.at - x.at)) {
        if (!summaries.includes(s.text)) summaries.push(s.text)
        if (summaries.length >= INSIGHT_LIMITS.summariesShown) break
      }
      return {
        entityType: a.entityType, key: a.key, name: a.name, answers: a.answers, tones: a.tones,
        positioning: Array.from(a.positioning.entries())
          .sort((x, y) => y[1] - x[1])
          .map(([code, n]) => ({ code, label: BRAND_POSITIONING_LABEL[code], answers: n, rate: rate(n, a.answers) })),
        factors: Array.from(a.factors.entries())
          .sort((x, y) => y[1].answers - x[1].answers)
          .map(([code, v]) => ({ code, label: SENTIMENT_FACTOR_LABEL[code], ...v })),
        summaries,
        descriptors: Array.from(a.descriptors.entries())
          .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
          .slice(0, INSIGHT_LIMITS.descriptorsShown)
          .map(([text, n]) => ({ text, answers: n })),
      }
    })

  return {
    available: true,
    analyzed,
    factors: Array.from(factorAnswers.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => ({ code, label: SENTIMENT_FACTOR_LABEL[code], answers: n, rate: rate(n, analyzed) })),
    overallTones,
    entities,
    answersWithQueries,
    searches,
    queryGroups,
  }
}

// ── Mention style ────────────────────────────────────────────────────────────

export interface BrandMentionLite {
  responseId: string
  recommended: boolean
  compared: boolean
  position: number | null
  positionPct?: number | null
}

/**
 * How the brand is brought up. One brand row per answer; `responseIds` limits the count to a subset
 * (one question on one AI). recommended + compared + listed = answers naming the brand.
 */
export function mentionStyleOf(brandRows: BrandMentionLite[], responseIds?: Set<string>): MentionStyleCounts {
  const out: MentionStyleCounts = { recommended: 0, compared: 0, listed: 0, first: 0, zones: { early: 0, middle: 0, late: 0 } }
  const seen = new Set<string>()
  for (const m of brandRows) {
    if (responseIds && !responseIds.has(m.responseId)) continue
    if (seen.has(m.responseId)) continue
    seen.add(m.responseId)
    if (m.recommended) out.recommended++
    else if (m.compared) out.compared++
    else out.listed++
    if (m.position === 1) out.first++
    const zone = answerZone(m.positionPct)
    if (zone) out.zones[zone]++
  }
  return out
}

// ── Daily trend ──────────────────────────────────────────────────────────────

export interface DailyTrend {
  trend: {
    series: Array<{ key: string; name: string; entityType: 'brand' | 'competitor' }>
    points: Array<{ date: string; asked: number; values: Array<number | null> }>
  }
  /** brand: mention rate of the newest day minus the oldest day; null with fewer than 2 days */
  change: number | null
  entityChange: Record<string, number | null>
}

/**
 * Share of answers naming each entity per Bangkok day. The chart shows the brand plus the most-mentioned
 * competitors; the change is worked out for every entity of `entities`.
 */
export function dailyTrend(ds: Dataset, entities: EntityShare[]): DailyTrend {
  const dayOf = new Map<string, string>()
  const askedByDay = new Map<string, number>()
  for (const r of ds.responses) {
    if (!r.collectedAt) continue
    const day = bangkokDay(r.collectedAt)
    dayOf.set(r.id, day)
    askedByDay.set(day, (askedByDay.get(day) || 0) + 1)
  }
  const days = Array.from(askedByDay.keys()).sort()

  // entity key -> day -> distinct answers naming it
  const named = new Map<string, Map<string, Set<string>>>()
  const add = (key: string, day: string, responseId: string) => {
    let byDay = named.get(key)
    if (!byDay) named.set(key, (byDay = new Map()))
    let set = byDay.get(day)
    if (!set) byDay.set(day, (set = new Set()))
    set.add(responseId)
  }
  for (const r of ds.responses) {
    const day = dayOf.get(r.id)
    if (day && r.brandMentioned === true) add('brand', day, r.id)
  }
  for (const m of ds.mentions) {
    if (m.entityType !== 'competitor') continue
    const day = dayOf.get(m.responseId)
    if (day) add(m.competitorId ?? m.entityKey, day, m.responseId)
  }

  const rateOn = (key: string, day: string): number | null => rate(named.get(key)?.get(day)?.size || 0, askedByDay.get(day) || 0)
  const changeOf = (key: string): number | null => {
    if (days.length < 2) return null
    const first = rateOn(key, days[0])
    const last = rateOn(key, days[days.length - 1])
    return first === null || last === null ? null : last - first
  }

  const brand = entities.filter((e) => e.entityType === 'brand')
  const competitors = entities.filter((e) => e.entityType === 'competitor' && e.mentions > 0).slice(0, INSIGHT_LIMITS.trendCompetitors)
  const series = [...brand, ...competitors].map((e) => ({ key: e.key, name: e.name, entityType: e.entityType }))

  const entityChange: Record<string, number | null> = {}
  for (const e of entities) entityChange[e.key] = changeOf(e.key)

  return {
    trend: {
      series,
      points: days.map((date) => ({ date, asked: askedByDay.get(date) || 0, values: series.map((s) => rateOn(s.key, date)) })),
    },
    change: changeOf('brand'),
    entityChange,
  }
}
