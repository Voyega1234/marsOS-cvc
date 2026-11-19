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
  type FactorExample, type InsightEntityDTO, type InsightQuote, type MentionStyleCounts, type ProviderKey, type QueryGroupDTO, type SentimentFactor, type SentimentTone, type ToneExample,
} from './types'

export const INSIGHT_LIMITS = {
  queryMaxLen: 300,
  queriesPerAnswer: 20,
  groupNameMax: 60,
  summaryMax: 240,
  /** answers listed per tone, per entity (brand / tracked competitor) */
  toneAnswersBrand: 12,
  toneAnswersCompetitor: 4,
  /** answers listed per factor of "what the AI weighs" */
  factorExamples: 5,
  descriptorMax: 40,
  descriptorsPerEntity: 3,
  /** longest stored example passage */
  quoteMax: 200,
  /** example passages kept per factor / label in the report */
  quotesPerLabel: 3,
  positioningPerEntity: 3,
  factorsPerEntity: 6,
  factorsPerAnswer: 6,
  /** report caps */
  queryGroups: 30,
  promptsPerGroup: 5,
  queriesPerGroup: 10,
  descriptorsShown: 12,
  factorsShown: 8,
  summariesShown: 3,
  trendCompetitors: 5,
  sources: 50,
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

/** One-line example passage: control characters removed, whitespace collapsed, capped */
function cleanQuote(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, INSIGHT_LIMITS.quoteMax) : ''
}

const squash = (v: string): string => v.replace(/\s+/g, ' ').trim().toLowerCase()

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
export function sanitizeSentiment(
  value: unknown,
  resolve: (key: string, raw: Record<string, unknown>) => SentimentEntityRef | null,
  opts?: { answer?: string },
): AnswerSentiment | null {
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

    // Quotes belong to our brand only. With a fresh model reply (`opts.answer`) a quote must be a real piece of the answer;
    // stored JSON was verified when it was written, so it is only re-cleaned.
    const answerKey = typeof opts?.answer === 'string' ? squash(opts.answer) : null
    const keepQuote = (q: unknown): string => {
      if (ref.entityType !== 'brand') return ''
      const text = cleanQuote(q)
      if (!text) return ''
      if (answerKey !== null && !answerKey.includes(squash(text))) return ''
      return text
    }

    const entityFactors: Array<{ code: SentimentFactor; polarity: FactorPolarity; quote?: string }> = []
    for (const f of Array.isArray(e.factors) ? e.factors : []) {
      if (!f || typeof f !== 'object') continue
      const ff = f as Record<string, unknown>
      if (!isFactor(ff.code) || entityFactors.some((x) => x.code === ff.code)) continue
      const item: { code: SentimentFactor; polarity: FactorPolarity; quote?: string } = { code: ff.code, polarity: isPolarity(ff.polarity) ? ff.polarity : 'neutral' }
      const quote = keepQuote(ff.quote)
      if (quote) item.quote = quote
      entityFactors.push(item)
      if (entityFactors.length >= INSIGHT_LIMITS.factorsPerEntity) break
    }

    const storedQuotes = e.descriptorQuotes && typeof e.descriptorQuotes === 'object' && !Array.isArray(e.descriptorQuotes) ? (e.descriptorQuotes as Record<string, unknown>) : {}
    const descriptors: string[] = []
    const descriptorQuotes: Record<string, string> = {}
    for (const d of Array.isArray(e.descriptors) ? e.descriptors : []) {
      const isObj = !!d && typeof d === 'object' && !Array.isArray(d)
      const label = isObj ? (d as Record<string, unknown>).label : d
      const text = oneLine(label, INSIGHT_LIMITS.descriptorMax).toLowerCase()
      const words = text ? text.split(' ').length : 0
      if (!text || words > 4 || descriptors.includes(text)) continue
      descriptors.push(text)
      const quote = keepQuote(isObj ? (d as Record<string, unknown>).quote : Object.prototype.hasOwnProperty.call(storedQuotes, text) ? storedQuotes[text] : undefined)
      if (quote) descriptorQuotes[text] = quote
      if (descriptors.length >= INSIGHT_LIMITS.descriptorsPerEntity) break
    }

    const entity: AnswerSentimentEntity = {
      entityType: ref.entityType, key: ref.key, name: ref.name, tone: e.tone, positioning, factors: entityFactors,
      summary: oneLine(e.summary, INSIGHT_LIMITS.summaryMax), descriptors,
    }
    if (Object.keys(descriptorQuotes).length > 0) entity.descriptorQuotes = descriptorQuotes
    entities.push(entity)
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
  runId?: string
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
  /** the rows behind each tone count */
  toneRows: Record<SentimentTone, Array<{ row: InsightRow; entity: AnswerSentimentEntity }>>
  positioning: Map<BrandPositioning, number>
  factors: Map<SentimentFactor, { answers: number; positive: number; negative: number; neutral: number }>
  summaries: Array<{ at: number; text: string }>
  descriptors: Map<string, number>
  factorQuotes: Map<SentimentFactor, Array<{ at: number; quote: InsightQuote }>>
  descriptorQuotes: Map<string, Array<{ at: number; quote: InsightQuote }>>
}

/** Up to `quotesPerLabel` distinct texts, newest answer first */
function topQuotes(list: Array<{ at: number; quote: InsightQuote }> | undefined): InsightQuote[] | undefined {
  if (!list || list.length === 0) return undefined
  const out: InsightQuote[] = []
  const seen = new Set<string>()
  for (const q of [...list].sort((x, y) => y.at - x.at)) {
    const key = squash(q.quote.text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q.quote)
    if (out.length >= INSIGHT_LIMITS.quotesPerLabel) break
  }
  return out
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
  const factorRows = new Map<SentimentFactor, InsightRow[]>()
  const overallTones = emptyTones()
  const entityAcc = new Map<string, EntityAcc>()
  for (const r of input.rows) {
    const s = r.sentiment
    if (!s) continue
    analyzed++
    for (const f of s.factors) {
      factorAnswers.set(f, (factorAnswers.get(f) || 0) + 1)
      const list = factorRows.get(f)
      if (list) list.push(r)
      else factorRows.set(f, [r])
    }
    for (const e of s.entities) {
      let acc = entityAcc.get(e.key)
      if (!acc) {
        acc = {
          entityType: e.entityType, key: e.key, name: input.entityNames.get(e.key) || e.name || e.key, answers: 0,
          tones: emptyTones(), toneRows: { positive: [], neutral: [], negative: [], mixed: [] }, positioning: new Map(), factors: new Map(), summaries: [], descriptors: new Map(),
          factorQuotes: new Map(), descriptorQuotes: new Map(),
        }
        entityAcc.set(e.key, acc)
      }
      acc.answers++
      acc.tones[e.tone]++
      acc.toneRows[e.tone].push({ row: r, entity: e })
      overallTones[e.tone]++
      for (const p of e.positioning) acc.positioning.set(p, (acc.positioning.get(p) || 0) + 1)
      for (const f of e.factors) {
        const cur = acc.factors.get(f.code) || { answers: 0, positive: 0, negative: 0, neutral: 0 }
        cur.answers++
        cur[f.polarity]++
        acc.factors.set(f.code, cur)
        if (f.quote && e.entityType === 'brand') {
          const list = acc.factorQuotes.get(f.code) || []
          list.push({ at: r.at, quote: { text: f.quote, responseId: r.responseId, promptId: r.promptId, runId: r.runId, provider: r.provider, polarity: f.polarity } })
          acc.factorQuotes.set(f.code, list)
        }
      }
      if (e.summary) acc.summaries.push({ at: r.at, text: e.summary })
      for (const d of e.descriptors) {
        acc.descriptors.set(d, (acc.descriptors.get(d) || 0) + 1)
        const dq = e.descriptorQuotes?.[d]
        if (dq && e.entityType === 'brand') {
          const list = acc.descriptorQuotes.get(d) || []
          list.push({ at: r.at, quote: { text: dq, responseId: r.responseId, promptId: r.promptId, runId: r.runId, provider: r.provider } })
          acc.descriptorQuotes.set(d, list)
        }
      }
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
      // Answer lists only for the brand and currently tracked competitors
      let toneAnswers: Partial<Record<SentimentTone, ToneExample[]>> | undefined
      if (a.entityType === 'brand' || input.entityNames.has(a.key)) {
        const cap = a.entityType === 'brand' ? INSIGHT_LIMITS.toneAnswersBrand : INSIGHT_LIMITS.toneAnswersCompetitor
        const order: Record<FactorPolarity, number> = { positive: 0, negative: 1, neutral: 2 }
        const built: Partial<Record<SentimentTone, ToneExample[]>> = {}
        for (const tone of Object.keys(a.toneRows) as SentimentTone[]) {
          const rows = a.toneRows[tone]
          if (rows.length === 0) continue
          built[tone] = [...rows]
            .sort((x, y) => y.row.at - x.row.at || (x.row.responseId < y.row.responseId ? -1 : x.row.responseId > y.row.responseId ? 1 : 0))
            .slice(0, cap)
            .map(({ row, entity }): ToneExample => ({
              responseId: row.responseId, promptId: row.promptId, runId: row.runId, provider: row.provider, at: row.at,
              prompt: input.promptText.get(row.promptId) ?? '',
              summary: oneLine(entity.summary, INSIGHT_LIMITS.summaryMax),
              points: entity.factors
                .map((f, i) => ({ f, i }))
                .sort((x, y) => order[x.f.polarity] - order[y.f.polarity] || x.i - y.i)
                .slice(0, INSIGHT_LIMITS.factorsPerAnswer)
                .map(({ f }) => {
                  const quote = cleanQuote(f.quote)
                  const label = SENTIMENT_FACTOR_LABEL[f.code] ?? f.code
                  return quote ? { code: f.code, label, polarity: f.polarity, quote } : { code: f.code, label, polarity: f.polarity }
                }),
            }))
        }
        if (Object.keys(built).length > 0) toneAnswers = built
      }
      return {
        entityType: a.entityType, key: a.key, name: a.name, answers: a.answers, tones: a.tones,
        ...(toneAnswers ? { toneAnswers } : {}),
        positioning: Array.from(a.positioning.entries())
          .sort((x, y) => y[1] - x[1])
          .map(([code, n]) => ({ code, label: BRAND_POSITIONING_LABEL[code], answers: n, rate: rate(n, a.answers) })),
        factors: Array.from(a.factors.entries())
          .sort((x, y) => y[1].answers - x[1].answers)
          .map(([code, v]) => {
            const quotes = topQuotes(a.factorQuotes.get(code))
            return quotes ? { code, label: SENTIMENT_FACTOR_LABEL[code], ...v, quotes } : { code, label: SENTIMENT_FACTOR_LABEL[code], ...v }
          }),
        summaries,
        descriptors: Array.from(a.descriptors.entries())
          .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
          .slice(0, INSIGHT_LIMITS.descriptorsShown)
          .map(([text, n]) => {
            const quotes = topQuotes(a.descriptorQuotes.get(text))
            return quotes ? { text, answers: n, quotes } : { text, answers: n }
          }),
      }
    })

  return {
    available: true,
    analyzed,
    factors: Array.from(factorAnswers.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => {
        const examples: FactorExample[] = [...(factorRows.get(code) ?? [])]
          .sort((x, y) => y.at - x.at || (x.responseId < y.responseId ? -1 : x.responseId > y.responseId ? 1 : 0))
          .slice(0, INSIGHT_LIMITS.factorExamples)
          .map((row) => ({ responseId: row.responseId, promptId: row.promptId, runId: row.runId, provider: row.provider, at: row.at, prompt: input.promptText.get(row.promptId) ?? '' }))
        return { code, label: SENTIMENT_FACTOR_LABEL[code], answers: n, rate: rate(n, analyzed), examples }
      }),
    overallTones,
    entities,
    answersWithQueries,
    searches,
    queryGroups,
  }
}

// ── Example passage for old answers ──────────────────────────────────────────

const FALLBACK_WINDOW = 200

/** Markdown noise removed from one line: bold marks, heading marks, list markers, table pipes */
function stripMarkdown(line: string): string {
  return line
    .replace(/\*\*|__/g, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * An example passage taken from a stored answer when the analysis kept none (old answers).
 * A line holding `label` wins (exact); else the first line holding a brand term (approx); else null.
 * Lines over 200 characters are cut to a window around the match.
 */
export function fallbackQuote(answerText: string, opts: { label?: string; brandTerms: string[] }): { text: string; approx: boolean } | null {
  if (typeof answerText !== 'string' || !answerText) return null
  const lines = answerText.split('\n').map(stripMarkdown).filter(Boolean)
  const label = (opts.label || '').trim().toLowerCase()
  const terms = opts.brandTerms.map((t) => t.trim().toLowerCase()).filter(Boolean)

  const find = (needles: string[]): { line: string; at: number; len: number } | null => {
    for (const line of lines) {
      const low = line.toLowerCase()
      for (const n of needles) {
        const at = low.indexOf(n)
        if (at >= 0) return { line, at, len: n.length }
      }
    }
    return null
  }
  const cut = (hit: { line: string; at: number; len: number }): string => {
    if (hit.line.length <= FALLBACK_WINDOW) return hit.line
    const centre = hit.at + Math.floor(hit.len / 2)
    let start = Math.max(0, centre - FALLBACK_WINDOW / 2)
    const end = Math.min(hit.line.length, start + FALLBACK_WINDOW)
    start = Math.max(0, end - FALLBACK_WINDOW)
    return `${start > 0 ? '…' : ''}${hit.line.slice(start, end).trim()}${end < hit.line.length ? '…' : ''}`
  }

  if (label) {
    const hit = find([label])
    if (hit) return { text: cut(hit), approx: false }
  }
  const hit = terms.length ? find(terms) : null
  return hit ? { text: cut(hit), approx: true } : null
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
  /** brand: Visibility of the newest day minus the oldest day; null with fewer than 2 days */
  change: number | null
  entityChange: Record<string, number | null>
}

/**
 * Visibility per Bangkok day: the share of answers that name each entity or cite a site it owns. The chart
 * shows the brand plus the most-visible competitors; the change is worked out for every entity of `entities`.
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
    if (day && (r.brandMentioned === true || r.ownedCited === true)) add('brand', day, r.id)
  }
  for (const m of ds.mentions) {
    if (m.entityType !== 'competitor') continue
    const day = dayOf.get(m.responseId)
    if (day) add(m.competitorId ?? m.entityKey, day, m.responseId)
  }
  // A cited competitor site counts as visible even when the answer does not name the competitor
  for (const c of ds.citations) {
    if (!c.competitorId) continue
    const day = dayOf.get(c.responseId)
    if (day) add(c.competitorId, day, c.responseId)
  }

  const rateOn = (key: string, day: string): number | null => rate(named.get(key)?.get(day)?.size || 0, askedByDay.get(day) || 0)
  const changeOf = (key: string): number | null => {
    if (days.length < 2) return null
    const first = rateOn(key, days[0])
    const last = rateOn(key, days[days.length - 1])
    return first === null || last === null ? null : last - first
  }

  const brand = entities.filter((e) => e.entityType === 'brand')
  const competitors = entities.filter((e) => e.entityType === 'competitor' && e.visible > 0).slice(0, INSIGHT_LIMITS.trendCompetitors)
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
