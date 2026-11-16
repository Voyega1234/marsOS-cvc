/**
 * Brand Radar — provider calls (OpenRouter models + DataForSEO Google AI Mode / AI Overview).
 * One provider is never substituted for another: a missing credential or a failed call is reported as such.
 */
import { orChat } from '@/lib/openrouter'
import { dfsPost, hasDfsCreds } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'
import type { RawCitation } from './citations'
import {
  COUNTRIES, PROVIDERS, PROVIDER_KEYS,
  type ProviderConnection, type ProviderKey, type ProviderStatusDTO,
} from './types'

type OpenRouterKey = 'openai' | 'gemini' | 'perplexity' | 'claude' | 'grok' | 'deepseek'
type DfsKey = 'google_ai_mode' | 'google_ai_overview'

export const DEFAULT_MODELS: Record<OpenRouterKey, string> = {
  openai: 'openai/gpt-5.6-luna',
  gemini: 'google/gemini-3.7-flash',
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

/** Fallback estimate for DataForSEO providers before this org has real cost rows */
export const DFS_LIST_PRICE: Record<DfsKey, number> = {
  google_ai_mode: AI_MODE_LIST_PRICE,
  google_ai_overview: AI_OVERVIEW_LIST_PRICE,
}

const DFS_ENDPOINTS: Record<DfsKey, { path: string; api: string; extra: Record<string, unknown>; label: string }> = {
  google_ai_mode: { path: '/serp/google/ai_mode/live/advanced', api: 'dataforseo_ai_mode', extra: {}, label: 'Google AI Mode' },
  google_ai_overview: {
    path: '/serp/google/organic/live/advanced',
    api: 'dataforseo_ai_overview',
    extra: { load_async_ai_overview: true, depth: 10 },
    label: 'Google AI Overview',
  },
}
const KEYWORD_MAX = 700

function isDfsKey(key: ProviderKey): key is DfsKey {
  return PROVIDERS[key].via === 'dataforseo'
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

// ── Calls ────────────────────────────────────────────────────────────────────

function countryLabel(code: string): string {
  const c = COUNTRIES.find((x) => x.code === code.toUpperCase())
  return c ? c.label : code
}

function languageLabel(code: string): string {
  return code === 'th' ? 'Thai' : code === 'en' ? 'English' : code
}

async function callOpenRouter(key: ProviderKey, input: ProviderCallInput): Promise<ProviderCallResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new ProviderError('NOT_CONNECTED: OPENROUTER_API_KEY is not set on the server')
  const model = modelFor(key)
  const search = key !== 'perplexity' // sonar searches by itself; the web plugin would charge twice
  try {
    const r = await orChat({
      trace: 'brand_radar_scan',
      client: input.clientName || undefined,
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant answering a user located in ${countryLabel(input.country)}. Reply in ${languageLabel(input.language)}.`,
        },
        { role: 'user', content: input.prompt },
      ],
      model,
      maxTokens: 1200,
      webSearch: search,
      ...(search ? { webSearchOptions: { maxResults: SEARCH_RESULTS[key as OpenRouterKey] ?? DEFAULT_SEARCH_RESULTS } } : {}),
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

/** Record one provider call in AIJob. AIJob.projectId references the same Project table the radar project comes from. */
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
    projectId: ctx.projectId,
    jobType,
    modelProvider: dfs ? 'dataforseo' : 'openrouter',
    modelName: dfs ? key : outcome.model,
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
