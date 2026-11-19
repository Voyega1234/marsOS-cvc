/**
 * Brand Radar — provider calls (OpenRouter models + DataForSEO: Google AI Mode / AI Overview and the
 * ChatGPT / Gemini LLM Scrapers, which read the real web apps).
 * One provider is never substituted for another: a missing credential or a failed call is reported as such.
 */
import { orChat, orResponses } from '@/lib/openrouter'
import { dfsPost, hasDfsCreds } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'
import type { RawCitation } from './citations'
import {
  COUNTRIES, PROVIDERS, PROVIDER_KEYS, aiJobProjectId,
  type OtherEntity, type ProviderConnection, type ProviderKey, type ProviderStatusDTO,
} from './types'

type OpenRouterKey = 'perplexity' | 'claude' | 'grok' | 'deepseek'
type DfsKey = 'google_ai_mode' | 'google_ai_overview' | 'openai' | 'gemini'

export const DEFAULT_MODELS: Record<OpenRouterKey, string> = {
  perplexity: 'perplexity/sonar',
  claude: 'anthropic/claude-haiku-5.5',
  grok: 'x-ai/grok-4.3',
  deepseek: 'deepseek/deepseek-v4.1-flash',
}

/**
 * Web results requested per call. DeepSeek has no native search, so OpenRouter falls back to its
 * Exa plugin, which bills per result: keep it small there.
 */
const SEARCH_RESULTS: Partial<Record<OpenRouterKey, number>> = { deepseek: 3 }
const DEFAULT_SEARCH_RESULTS = 8

/** Published list price of one AI Mode live request (USD), used only until real cost data exists */
export const AI_MODE_LIST_PRICE = 0.004
/** Organic live advanced (~$0.002) + load_async_ai_overview surcharge ($0.002) */
export const AI_OVERVIEW_LIST_PRICE = 0.004

/** DataForSEO LLM Scraper live price per answer, seen as `cost: 0.004` on real calls 2026-11-18 */
export const LLM_SCRAPER_LIST_PRICE = 0.004

/** Fallback estimate for DataForSEO providers before this org has real cost rows */
export const DFS_LIST_PRICE: Record<DfsKey, number> = {
  google_ai_mode: AI_MODE_LIST_PRICE,
  google_ai_overview: AI_OVERVIEW_LIST_PRICE,
  openai: LLM_SCRAPER_LIST_PRICE,
  gemini: LLM_SCRAPER_LIST_PRICE,
}

/** List price of one call for DataForSEO providers; null for OpenRouter ones (their cost comes from usage) */
export function dfsListPrice(key: ProviderKey): number | null {
  return isDfsKey(key) ? DFS_LIST_PRICE[key] : null
}

const DFS_ENDPOINTS: Record<DfsKey, { path: string; api: string; extra: Record<string, unknown>; label: string }> = {
  google_ai_mode: { path: '/serp/google/ai_mode/live/advanced', api: 'dataforseo_ai_mode', extra: {}, label: 'Google AI Mode' },
  google_ai_overview: {
    path: '/serp/google/organic/live/advanced',
    api: 'dataforseo_ai_overview',
    extra: { load_async_ai_overview: true, depth: 10 },
    label: 'Google AI Overview',
  },
  openai: {
    path: '/ai_optimization/chat_gpt/llm_scraper/live/advanced',
    api: 'dataforseo_chatgpt_scraper',
    // Without this ChatGPT may answer from memory and cite nothing, which defeats the point of observing it
    extra: { force_web_search: true },
    label: 'ChatGPT',
  },
  // The Gemini scraper has no force_web_search field: sending one would be rejected
  gemini: { path: '/ai_optimization/gemini/llm_scraper/live/advanced', api: 'dataforseo_gemini_scraper', extra: {}, label: 'Google Gemini' },
}
const KEYWORD_MAX = 700
/** DataForSEO keyword limit for the LLM Scrapers, measured on the encoded string */
const SCRAPER_KEYWORD_MAX = 2000
/** DataForSEO: execution takes "up to 120 seconds" (live probes 24-35 s); leave room on top */
const SCRAPER_TIMEOUT_MS = 130_000

function isDfsKey(key: ProviderKey): key is DfsKey {
  return PROVIDERS[key].via === 'dataforseo'
}

function isScraperKey(key: DfsKey): key is 'openai' | 'gemini' {
  return key === 'openai' || key === 'gemini'
}

export function modelFor(key: ProviderKey): string {
  const info = PROVIDERS[key]
  if (info.via !== 'openrouter') return ''
  const fromEnv = info.modelEnv ? (process.env[info.modelEnv] || '').trim() : ''
  return fromEnv || DEFAULT_MODELS[key as keyof typeof DEFAULT_MODELS]
}

export function requiredEnv(key: ProviderKey): string[] {
  return PROVIDERS[key].via === 'dataforseo' ? ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] : ['OPENROUTER_API_KEY']
}

export function hasCredentials(key: ProviderKey): boolean {
  return PROVIDERS[key].via === 'dataforseo' ? hasDfsCreds() : !!process.env.OPENROUTER_API_KEY
}

export interface ProviderCallInput { prompt: string; country: string; language: string; clientName?: string }

export interface ProviderCallResult {
  status: 'DONE' | 'SKIPPED'
  text: string
  citations: RawCitation[]
  costUsd: number
  inputTokens: number
  outputTokens: number
  model: string
  /** explanation when status is SKIPPED */
  error?: string
  /** what the AI typed into its own web search; empty when the platform does not expose it */
  searchQueries?: string[]
  /**
   * Pages the AI found while searching but did not cite in the answer. Only the ChatGPT scraper returns this;
   * absent or empty everywhere else. Never contains a page that is also in citations.
   */
  foundSources?: RawCitation[]
  /** Brands / products the platform itself tagged in the answer (DataForSEO scraper brand_entities); absent elsewhere */
  otherEntities?: OtherEntity[]
  raw?: Record<string, unknown>
}

export type ProviderCaller = (key: ProviderKey, input: ProviderCallInput) => Promise<ProviderCallResult>

export class ProviderError extends Error {
  costUsd: number
  constructor(message: string, costUsd = 0) {
    super(message)
    this.name = 'ProviderError'
    this.costUsd = costUsd
  }
}

// ── Google AI Mode parsing (pure) ────────────────────────────────────────────

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Collect references[] / links[] from an item and every nested item */
function collectRefs(item: Record<string, unknown>, out: RawCitation[], depth: number): void {
  if (depth > 6) return
  for (const r of Array.isArray(item.references) ? item.references : []) {
    const o = asObj(r)
    if (o && str(o.url)) out.push({ url: str(o.url), title: str(o.title) || str(o.source) })
  }
  for (const l of Array.isArray(item.links) ? item.links : []) {
    const o = asObj(l)
    if (o && str(o.url)) out.push({ url: str(o.url), title: str(o.title) })
  }
  for (const sub of Array.isArray(item.items) ? item.items : []) {
    const o = asObj(sub)
    if (o) collectRefs(o, out, depth + 1)
  }
}

function flattenText(item: Record<string, unknown>, parts: string[], depth: number): void {
  if (depth > 6) return
  const t = str(item.markdown) || str(item.text)
  if (t) parts.push(t)
  for (const sub of Array.isArray(item.items) ? item.items : []) {
    const o = asObj(sub)
    if (o) flattenText(o, parts, depth + 1)
  }
}

export interface AiModeParsed {
  status: 'DONE' | 'SKIPPED'
  text: string
  citations: RawCitation[]
  costUsd: number
  error?: string
}

/**
 * Turn a DataForSEO AI Mode or organic SERP response into text + citations, reading only its
 * ai_overview items. Throws when the task itself failed.
 */
export function parseAiModeResponse(json: unknown, sourceLabel = 'Google AI Mode'): AiModeParsed {
  const root = asObj(json)
  const tasks = root && Array.isArray(root.tasks) ? root.tasks : []
  const task = asObj(tasks[0])
  if (!task) throw new ProviderError('DataForSEO returned no task')
  const costUsd = Number(task.cost) || 0
  if (task.status_code !== 20000) {
    throw new ProviderError(`DataForSEO task error ${String(task.status_code)}: ${str(task.status_message)}`.slice(0, 300), costUsd)
  }
  const results = Array.isArray(task.result) ? task.result : []
  const result = asObj(results[0])
  const items = result && Array.isArray(result.items) ? result.items : []
  const overviews = items.map(asObj).filter((i): i is Record<string, unknown> => !!i && i.type === 'ai_overview')
  const noAnswer = `${sourceLabel} returned no answer for this query and location`
  if (!overviews.length) {
    return { status: 'SKIPPED', text: '', citations: [], costUsd, error: noAnswer }
  }
  const parts: string[] = []
  const citations: RawCitation[] = []
  for (const o of overviews) {
    const md = str(o.markdown)
    if (md) parts.push(md)
    else flattenText(o, parts, 0)
    collectRefs(o, citations, 0)
  }
  const text = parts.join('\n\n').trim()
  if (!text) {
    return { status: 'SKIPPED', text: '', citations: [], costUsd, error: noAnswer }
  }
  return { status: 'DONE', text, citations, costUsd }
}

// ── ChatGPT / Gemini LLM Scraper parsing (pure) ──────────────────────────────

/** Fragment Chrome adds to "text fragment" links; it points at a passage, not a different page */
const TEXT_FRAGMENT_RE = /#:~:text=[^\s)>\]"']*/g

/** Drop #:~:text= fragments and utm_source=chatgpt.com (plus the ?/& it leaves dangling) from any text */
function cleanUrlNoise(s: string): string {
  return s
    .replace(TEXT_FRAGMENT_RE, '')
    .replace(/\?utm_source=chatgpt\.com&/g, '?')
    .replace(/[?&]utm_source=chatgpt\.com/g, '')
}

/** URL for storage: http(s) only, noise removed; '' when it is not a usable web URL */
function cleanUrl(raw: string): string {
  const u = cleanUrlNoise(raw.trim())
  return /^https?:\/\//i.test(u) ? u : ''
}

/** Key used to tell whether two URLs are the same page */
function normalizeUrlKey(raw: string): string {
  try {
    const u = new URL(raw)
    for (const k of Array.from(u.searchParams.keys())) if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k)
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search
  } catch {
    return raw.trim().replace(/\/+$/, '')
  }
}

/**
 * The answer is shown to users and scanned for brand names, so strip what is noise there:
 * inline images, text-fragment and tracking URL parts, escaped list numbers, runs of blank lines.
 */
function cleanScraperText(md: string): string {
  return cleanUrlNoise(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^(\s*\d+)\\\./gm, '$1.')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Gemini's web app ends the answer with a clickable follow-up suggestion rendered as "question -> prompt"
 * on its own last line (seen on a real response). It is UI, not answer: it would be read as content.
 */
function stripGeminiSuggestion(text: string): string {
  const lines = text.trimEnd().split('\n')
  const last = lines[lines.length - 1]
  // observed shape: one short "question? -> prompt" line; a normal closing sentence that contains an arrow stays
  const m = /^\s*(.{3,120}?\?)\s+->\s+(.{3,160})$/.exec(last)
  if (lines.length > 1 && m && !/^\s*([-*>#]|\d+\.)/.test(last)) return lines.slice(0, -1).join('\n').trim()
  return text
}

function toCitations(list: unknown, out: RawCitation[], seen: Set<string>, skip?: Set<string>, cap = Infinity): void {
  for (const item of Array.isArray(list) ? list : []) {
    if (out.length >= cap) return
    const o = asObj(item)
    if (!o) continue
    const url = cleanUrl(str(o.url))
    if (!url) continue
    const k = normalizeUrlKey(url)
    if (seen.has(k) || skip?.has(k)) continue
    seen.add(k)
    out.push({ url, title: str(o.title) })
  }
}

const ENTITY_NAME_MAX = 120
const ENTITY_CATEGORY_MAX = 60
const ENTITY_CAP = 60
const ENTITY_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

function entityDomain(urls: unknown): string {
  if (!Array.isArray(urls)) return ''
  const first = asObj(urls[0])
  if (!first) return ''
  let d = typeof first.domain === 'string' ? first.domain.trim() : ''
  if (!d && typeof first.url === 'string' && /^https?:\/\//i.test(first.url.trim())) {
    try { d = new URL(first.url.trim()).hostname } catch { d = '' }
  }
  d = d.toLowerCase().replace(/^www\./, '')
  return ENTITY_DOMAIN_RE.test(d) ? d : ''
}

/** Clean the scraper's brand_entities list. Every field may be missing or of another type; nothing here throws. */
export function cleanOtherEntities(raw: unknown): OtherEntity[] {
  if (!Array.isArray(raw)) return []
  const out: OtherEntity[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (out.length >= ENTITY_CAP) break
    const o = asObj(item)
    if (!o || typeof o.title !== 'string') continue
    const name = o.title.replace(/\s+/g, ' ').trim().slice(0, ENTITY_NAME_MAX).trim()
    if (!name) continue
    const k = name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    const category = typeof o.category === 'string' ? o.category.replace(/\s+/g, ' ').trim().slice(0, ENTITY_CATEGORY_MAX) : ''
    out.push({ name, category, domain: entityDomain(o.urls) })
  }
  return out
}

export interface LlmScraperParsed {
  status: 'DONE' | 'SKIPPED'
  text: string
  citations: RawCitation[]
  foundSources: RawCitation[]
  searchQueries: string[]
  /** brand_entities from the scraper result; empty when absent */
  otherEntities: OtherEntity[]
  model: string
  costUsd: number
  error?: string
}

/**
 * Turn a DataForSEO ChatGPT / Gemini LLM Scraper response into the answer, the pages it cites, and (ChatGPT only)
 * the pages it found but did not cite plus the searches it ran. Throws when the task itself failed.
 */
export function parseLlmScraperResponse(json: unknown, key: 'openai' | 'gemini', sourceLabel: string): LlmScraperParsed {
  const root = asObj(json)
  const tasks = root && Array.isArray(root.tasks) ? root.tasks : []
  const task = asObj(tasks[0])
  if (!task) throw new ProviderError('DataForSEO returned no task')
  const costUsd = Number(task.cost) || 0
  if (task.status_code !== 20000) {
    throw new ProviderError(`DataForSEO task error ${String(task.status_code)}: ${str(task.status_message)}`.slice(0, 300), costUsd)
  }
  const results = Array.isArray(task.result) ? task.result : []
  const result = asObj(results[0])
  const model = result ? str(result.model) : ''
  let text = result ? cleanScraperText(str(result.markdown)) : ''
  if (key === 'gemini') text = stripGeminiSuggestion(text)
  if (!result || !text) {
    return {
      status: 'SKIPPED', text: '', citations: [], foundSources: [], searchQueries: [], otherEntities: [], model, costUsd,
      error: `${sourceLabel} returned an empty answer for this query and location`,
    }
  }
  const citations: RawCitation[] = []
  const citedKeys = new Set<string>()
  toCitations(result.sources, citations, citedKeys)
  const foundSources: RawCitation[] = []
  const searchQueries: string[] = []
  // Gemini returns neither list; ChatGPT does. Nothing is inferred for Gemini.
  if (key === 'openai') {
    toCitations(result.search_results, foundSources, new Set<string>(), citedKeys, 50)
    const seenQ = new Set<string>()
    for (const q of Array.isArray(result.fan_out_queries) ? result.fan_out_queries : []) {
      const t = str(q).trim()
      if (!t || seenQ.has(t) || searchQueries.length >= 20) continue
      seenQ.add(t)
      searchQueries.push(t)
    }
  }
  const otherEntities = cleanOtherEntities(result.brand_entities)
  return { status: 'DONE', text, citations, foundSources, searchQueries, otherEntities, model, costUsd }
}

/**
 * Keyword for the LLM Scrapers. DataForSEO decodes %## sequences and turns + into a space, so a literal % and +
 * are escaped; the 2000-character limit applies to the encoded string, so cut by encoded length and never in
 * the middle of an escape.
 */
export function scraperKeyword(prompt: string): string {
  let out = ''
  for (const ch of prompt) {
    const piece = ch === '%' ? '%25' : ch === '+' ? '%2B' : ch
    if (out.length + piece.length > SCRAPER_KEYWORD_MAX) break
    out += piece
  }
  return out
}

// ── Calls ────────────────────────────────────────────────────────────────────

function countryLabel(code: string): string {
  const c = COUNTRIES.find((x) => x.code === code.toUpperCase())
  return c ? c.label : code
}

function languageLabel(code: string): string {
  return code === 'th' ? 'Thai' : code === 'en' ? 'English' : code
}

/**
 * Output-token cap per answer. Reasoning tokens come out of the same budget (380-680 measured), and at 1200 every
 * test answer stopped mid-text, so a brand named late in the answer was never counted.
 */
const ANSWER_MAX_TOKENS = 2500

/**
 * Platforms whose search queries OpenRouter returns, through the Responses API only (measured 2026-11-18).
 * The others stay on chat completions: Gemini returned no citations on the Responses API, DeepSeek no queries.
 */
const RESPONSES_API_KEYS: ReadonlySet<ProviderKey> = new Set<ProviderKey>(['claude'])

async function callOpenRouter(key: ProviderKey, input: ProviderCallInput): Promise<ProviderCallResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new ProviderError('NOT_CONNECTED: OPENROUTER_API_KEY is not set on the server')
  const model = modelFor(key)
  const search = key !== 'perplexity' // sonar searches by itself; the web plugin would charge twice
  const maxResults = SEARCH_RESULTS[key as OpenRouterKey] ?? DEFAULT_SEARCH_RESULTS
  const messages = [
    {
      role: 'system' as const,
      content: `You are a helpful assistant answering a user located in ${countryLabel(input.country)}. Reply in ${languageLabel(input.language)}.`,
    },
    { role: 'user' as const, content: input.prompt },
  ]
  try {
    if (RESPONSES_API_KEYS.has(key)) {
      const r = await orResponses({
        trace: 'brand_radar_scan',
        client: input.clientName || undefined,
        messages,
        model,
        maxOutputTokens: ANSWER_MAX_TOKENS,
        webMaxResults: maxResults,
        timeoutMs: 120_000,
      })
      return {
        status: 'DONE',
        text: r.text,
        citations: r.citations.map((c) => ({ url: c.url, title: c.title })),
        costUsd: r.usage.costUsd,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        model,
        searchQueries: r.searchQueries,
        raw: { citations: r.citations.length, searchQueries: r.searchQueries.length, truncated: r.truncated },
      }
    }
    const r = await orChat({
      trace: 'brand_radar_scan',
      client: input.clientName || undefined,
      messages,
      model,
      maxTokens: ANSWER_MAX_TOKENS,
      webSearch: search,
      ...(search ? { webSearchOptions: { maxResults } } : {}),
      timeoutMs: 120_000,
    })
    return {
      status: 'DONE',
      text: r.text,
      citations: r.citations.map((c) => ({ url: c.url, title: c.title })),
      costUsd: r.usage.costUsd,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      model,
      searchQueries: [],
      raw: { citations: r.citations.length },
    }
  } catch (e) {
    const usage = (e as { usage?: { costUsd?: number } }).usage
    throw new ProviderError(e instanceof Error ? e.message : String(e), Number(usage?.costUsd) || 0)
  }
}

async function callDataForSeo(key: DfsKey, input: ProviderCallInput): Promise<ProviderCallResult> {
  if (!hasDfsCreds()) throw new ProviderError('NOT_CONNECTED: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set on the server')
  const ep = DFS_ENDPOINTS[key]
  const loc = COUNTRIES.find((c) => c.code === input.country.toUpperCase()) || COUNTRIES[0]
  if (isScraperKey(key)) {
    const json = await dfsPost(ep.path, [{
      keyword: scraperKeyword(input.prompt),
      location_code: loc.dfsLocationCode,
      language_code: input.language,
      ...ep.extra,
    }], SCRAPER_TIMEOUT_MS)
    const s = parseLlmScraperResponse(json, key, ep.label)
    return {
      status: s.status,
      text: s.text,
      citations: s.citations,
      foundSources: s.foundSources,
      otherEntities: s.otherEntities,
      searchQueries: s.searchQueries,
      costUsd: s.costUsd,
      inputTokens: 0,
      outputTokens: 0,
      model: s.model,
      error: s.error,
      raw: { citations: s.citations.length, foundSources: s.foundSources.length, searchQueries: s.searchQueries.length },
    }
  }
  const json = await dfsPost(ep.path, [{
    keyword: input.prompt.slice(0, KEYWORD_MAX),
    location_code: loc.dfsLocationCode,
    language_code: input.language,
    ...ep.extra,
  }])
  const p = parseAiModeResponse(json, ep.label)
  return {
    status: p.status,
    text: p.text,
    citations: p.citations,
    costUsd: p.costUsd,
    inputTokens: 0,
    outputTokens: 0,
    model: '',
    error: p.error,
    // Google answers the question itself: the search query is the question
    searchQueries: p.status === 'DONE' ? [input.prompt.slice(0, KEYWORD_MAX)] : [],
    raw: { citations: p.citations.length },
  }
}

export const callProvider: ProviderCaller = async (key, input) => {
  if (isDfsKey(key)) return callDataForSeo(key, input)
  return callOpenRouter(key, input)
}

// ── Status ───────────────────────────────────────────────────────────────────

interface StoredStatus { ok?: boolean; model?: string; testedAt?: string; error?: string }

function parseStored(json: string | null | undefined): Record<string, StoredStatus> {
  try {
    const v = JSON.parse(json || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, StoredStatus>) : {}
  } catch {
    return {}
  }
}

export function statusEntry(key: ProviderKey, stored: StoredStatus | undefined, enabled: boolean): ProviderStatusDTO {
  const info = PROVIDERS[key]
  let connection: ProviderConnection
  if (!hasCredentials(key)) connection = 'NOT_CONNECTED'
  else if (!stored || typeof stored.ok !== 'boolean') connection = 'UNTESTED'
  else connection = stored.ok ? 'CONNECTED' : 'ERROR'
  return {
    key,
    label: info.label,
    vendor: info.vendor,
    method: info.method,
    via: info.via,
    note: info.note,
    model: modelFor(key),
    connection,
    enabled,
    testedAt: stored?.testedAt ? String(stored.testedAt) : null,
    error: connection === 'ERROR' ? String(stored?.error || '') : '',
    requiredEnv: requiredEnv(key),
  }
}

export function providerStatuses(providerStatusJson: string | null | undefined, enabledProviders: ProviderKey[]): ProviderStatusDTO[] {
  const stored = parseStored(providerStatusJson)
  return PROVIDER_KEYS.map((k) => statusEntry(k, stored[k], enabledProviders.includes(k)))
}

// ── Logging + test ───────────────────────────────────────────────────────────

export interface ScanLogCtx { orgId: string; userId: string; projectId: string }

/**
 * Record one provider call in AIJob. AIJob.projectId references the Project table, so a project created inside
 * Brand Radar (no Project row) is logged without a project id.
 */
export async function logProviderCall(
  ctx: ScanLogCtx,
  key: ProviderKey,
  prompt: string,
  outcome: { ok: boolean; model: string; costUsd: number; tokens: number; error?: string },
  jobType: 'BRAND_RADAR_SCAN' | 'BRAND_RADAR_PROVIDER_TEST' = 'BRAND_RADAR_SCAN',
): Promise<void> {
  const dfs = isDfsKey(key) ? DFS_ENDPOINTS[key] : null
  await logAIJob({
    organizationId: ctx.orgId,
    projectId: aiJobProjectId(ctx.projectId),
    jobType,
    modelProvider: dfs ? 'dataforseo' : 'openrouter',
    // A scraper call is not an OpenAI/Gemini API call: name the API so AI Cost never shows a model called "openai"
    modelName: dfs ? (key === 'openai' || key === 'gemini' ? dfs.api : key) : outcome.model,
    status: outcome.ok ? 'SUCCESS' : 'FAILED',
    tokenUsed: outcome.tokens,
    ...(dfs
      ? { externalCost: outcome.costUsd, externalCalls: 1, externalApi: dfs.api }
      : { estimatedCost: outcome.costUsd }),
    errorMessage: outcome.error,
    createdById: ctx.userId,
    inputSummary: '[brand-radar] ' + prompt,
  })
}

export interface TestCtx { orgId: string; userId: string; projectId: string; country: string; language: string; clientName?: string }

export interface TestOutcome {
  ok: boolean
  model: string
  testedAt: string
  error: string
}

/** One real, billed call. The caller persists the outcome into profile.providerStatus. */
export async function testProvider(key: ProviderKey, ctx: TestCtx, caller?: ProviderCaller): Promise<TestOutcome> {
  const testedAt = new Date().toISOString()
  const viaDfs = isDfsKey(key)
  // AI Overview shows mostly on informational queries; the AI Mode keyword stays as before
  const prompt = key === 'google_ai_overview' ? 'what is coffee' : viaDfs ? 'best coffee shops' : 'Reply with the single word OK'
  let outcome: TestOutcome
  let costUsd = 0
  let tokens = 0
  try {
    let r: ProviderCallResult
    if (caller) r = await caller(key, { prompt, country: ctx.country, language: ctx.language, clientName: ctx.clientName })
    else if (isDfsKey(key)) r = await callDataForSeo(key, { prompt, country: ctx.country, language: ctx.language })
    else {
      if (!process.env.OPENROUTER_API_KEY) throw new ProviderError('NOT_CONNECTED: OPENROUTER_API_KEY is not set on the server')
      const model = modelFor(key)
      try {
        const o = await orChat({
          trace: 'brand_radar_scan',
          client: ctx.clientName || undefined,
          prompt,
          model,
          maxTokens: 10,
          webSearch: false,
          timeoutMs: 60_000,
        })
        r = { status: 'DONE', text: o.text, citations: [], costUsd: o.usage.costUsd, inputTokens: o.usage.inputTokens, outputTokens: o.usage.outputTokens, model }
      } catch (e) {
        const usage = (e as { usage?: { costUsd?: number } }).usage
        throw new ProviderError(e instanceof Error ? e.message : String(e), Number(usage?.costUsd) || 0)
      }
    }
    costUsd = r.costUsd
    tokens = r.inputTokens + r.outputTokens
    // AI Mode / AI Overview may legitimately have no answer for the neutral keyword: the call itself still worked
    outcome = { ok: true, model: r.model || modelFor(key), testedAt, error: '' }
  } catch (e) {
    costUsd = Number((e as { costUsd?: number }).costUsd) || 0
    outcome = { ok: false, model: modelFor(key), testedAt, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
  }
  await logProviderCall(
    { orgId: ctx.orgId, userId: ctx.userId, projectId: ctx.projectId },
    key, prompt,
    { ok: outcome.ok, model: outcome.model, costUsd, tokens, error: outcome.error },
    'BRAND_RADAR_PROVIDER_TEST',
  )
  return outcome
}

/** The JSON stored in profile.providerStatus for one key */
export function storedStatusFor(o: TestOutcome): StoredStatus {
  return { ok: o.ok, model: o.model, testedAt: o.testedAt, error: o.error }
}
