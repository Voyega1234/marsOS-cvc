/**
 * Brand Radar — shared contract (domain types + API DTOs).
 * Imported by the pure engines, the server code and the client components.
 * No runtime dependency on server-only modules: safe to import from "use client" files.
 *
 * Rules that every consumer follows:
 *  - A metric that cannot be computed is `null`, never 0. The UI prints "Insufficient Data".
 *  - searchVolume null = unknown.
 *  - Nothing here is a real user query or a real impression count unless its source says so.
 */

// ── Providers ────────────────────────────────────────────────────────────────

export const PROVIDER_KEYS = [
  'openai', 'gemini', 'perplexity', 'claude', 'grok', 'deepseek', 'google_ai_mode', 'google_ai_overview',
] as const
export type ProviderKey = (typeof PROVIDER_KEYS)[number]

/**
 * api_simulated = the model was called through an API with web search on. It approximates,
 *                 and is NOT, what the consumer app (ChatGPT, Gemini app, ...) shows a user.
 * observed_serp = the AI answer was read from a live search results page by a licensed SERP provider.
 * imported      = rows brought in from a file.
 */
export type CollectionMethod = 'api_simulated' | 'observed_serp' | 'imported'

export interface ProviderInfo {
  key: ProviderKey
  /** Honest label: names the API, never the consumer product */
  label: string
  vendor: string
  method: CollectionMethod
  /** via = which integration carries the call */
  via: 'openrouter' | 'dataforseo'
  /** env var that overrides the model slug (openrouter providers only) */
  modelEnv?: string
  note: string
}

export const PROVIDERS: Record<ProviderKey, ProviderInfo> = {
  openai: {
    key: 'openai', label: 'OpenAI GPT (API + web search)', vendor: 'OpenAI', method: 'api_simulated', via: 'openrouter',
    modelEnv: 'BRAND_RADAR_MODEL_OPENAI',
    note: 'API call with web search. Approximates ChatGPT answers; it is not the ChatGPT app.',
  },
  gemini: {
    key: 'gemini', label: 'Google Gemini (API + web search)', vendor: 'Google', method: 'api_simulated', via: 'openrouter',
    modelEnv: 'BRAND_RADAR_MODEL_GEMINI',
    note: 'API call with web search. Approximates Gemini answers; it is not the Gemini app.',
  },
  perplexity: {
    key: 'perplexity', label: 'Perplexity Sonar (API)', vendor: 'Perplexity', method: 'api_simulated', via: 'openrouter',
    modelEnv: 'BRAND_RADAR_MODEL_PERPLEXITY',
    note: 'Perplexity Sonar API: searches the web by itself and returns citations.',
  },
  claude: {
    key: 'claude', label: 'Anthropic Claude (API + web search)', vendor: 'Anthropic', method: 'api_simulated', via: 'openrouter',
    modelEnv: 'BRAND_RADAR_MODEL_CLAUDE',
    note: 'API call with web search. Approximates Claude answers; it is not the Claude app.',
  },
  grok: {
    key: 'grok', label: 'xAI Grok (API + web search)', vendor: 'xAI', method: 'api_simulated', via: 'openrouter',
    modelEnv: 'BRAND_RADAR_MODEL_GROK',
    note: 'API call with web search. Approximates Grok answers; it is not the Grok app or X.',
  },
  deepseek: {
    key: 'deepseek', label: 'DeepSeek (API + web search)', vendor: 'DeepSeek', method: 'api_simulated', via: 'openrouter',
    modelEnv: 'BRAND_RADAR_MODEL_DEEPSEEK',
    note: 'API call with OpenRouter web search (DeepSeek has no search of its own). Approximates DeepSeek answers; it is not the DeepSeek app.',
  },
  google_ai_mode: {
    key: 'google_ai_mode', label: 'Google AI Mode (observed, DataForSEO)', vendor: 'Google', method: 'observed_serp', via: 'dataforseo',
    note: 'AI Mode answer read from Google Search by DataForSEO SERP API. Not available in every country.',
  },
  google_ai_overview: {
    key: 'google_ai_overview', label: 'Google AI Overview (observed, DataForSEO)', vendor: 'Google', method: 'observed_serp', via: 'dataforseo',
    note: 'AI Overview box read from the normal Google results page by DataForSEO SERP API. Google shows it only for some queries.',
  },
}

/** Platforms people ask for that have no authorized API here. Shown as "Unsupported", never faked. */
export const UNSUPPORTED_PLATFORMS: ReadonlyArray<{ label: string; reason: string }> = [
  { label: 'ChatGPT app (logged-in consumer product)', reason: 'No official API returns what the consumer app shows. Use OpenAI GPT (API) as an approximation.' },
  { label: 'Microsoft Copilot', reason: 'No authorized API for Copilot answers.' },
  { label: 'Meta AI', reason: 'No authorized API for Meta AI answers.' },
]

export type ProviderConnection = 'CONNECTED' | 'NOT_CONNECTED' | 'UNTESTED' | 'ERROR'

export interface ProviderStatusDTO {
  key: ProviderKey
  label: string
  vendor: string
  method: CollectionMethod
  via: 'openrouter' | 'dataforseo'
  note: string
  /** model slug that will be called ('' for dataforseo) */
  model: string
  /**
   * NOT_CONNECTED = credentials missing on the server
   * UNTESTED      = credentials present, never tested for this project
   * CONNECTED     = last connectivity test succeeded
   * ERROR         = last connectivity test failed
   */
  connection: ProviderConnection
  /** selected for monitoring in this project's profile */
  enabled: boolean
  testedAt: string | null
  error: string
  /** env vars that must exist for this provider (names only, never values) */
  requiredEnv: string[]
}

// ── Enums ────────────────────────────────────────────────────────────────────

export const PROMPT_SOURCES = ['gsc', 'keyword_database', 'paa_provider', 'ai_generated', 'manual', 'imported'] as const
export type PromptSource = (typeof PROMPT_SOURCES)[number]

export const PROMPT_SOURCE_LABEL: Record<PromptSource, string> = {
  gsc: 'Google Search Console',
  keyword_database: 'Keyword database',
  paa_provider: 'People Also Ask (SERP provider)',
  ai_generated: 'AI generated (not real user queries)',
  manual: 'Manual',
  imported: 'Imported',
}

export const PROMPT_INTENTS = [
  'informational', 'navigational', 'commercial_investigation', 'transactional',
  'brand_comparison', 'recommendation', 'problem_solving',
] as const
export type PromptIntent = (typeof PROMPT_INTENTS)[number]

export const PROMPT_INTENT_LABEL: Record<PromptIntent, string> = {
  informational: 'Informational',
  navigational: 'Navigational',
  commercial_investigation: 'Commercial Investigation',
  transactional: 'Transactional',
  brand_comparison: 'Brand Comparison',
  recommendation: 'Recommendation',
  problem_solving: 'Problem Solving',
}

export const JOURNEY_STAGES = ['awareness', 'consideration', 'decision', 'retention'] as const
export type JourneyStage = (typeof JOURNEY_STAGES)[number]

export const PROMPT_STATUSES = ['CANDIDATE', 'ACTIVE', 'INACTIVE', 'REJECTED'] as const
export type PromptStatus = (typeof PROMPT_STATUSES)[number]

export const PRIORITIES = ['high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]
export type Confidence = Priority

export const SCHEDULES = ['manual', 'daily', 'weekly', 'monthly'] as const
export type Schedule = (typeof SCHEDULES)[number]

export type RunStatus = 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'
export type RunTrigger = 'manual' | 'schedule'
export type TaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'

export type CitationOwner = 'own' | 'competitor' | 'external'

export const OPPORTUNITY_TYPES = [
  'missing_brand_mention',     // prompt answered, competitors named, brand not named
  'citation_gap',              // prompt where a competitor's domain is cited and ours never is
  'recommendation_gap',        // competitor recommended, brand mentioned but not recommended (or absent)
  'unlinked_mention',          // brand mentioned, own domain never cited
  'source_to_pitch',           // external domain cited often: outreach / backlink target
  'weak_platform',             // one provider far below the others
] as const
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number]

export const OPPORTUNITY_TYPE_LABEL: Record<OpportunityType, string> = {
  missing_brand_mention: 'Missing brand mention',
  citation_gap: 'Citation gap',
  recommendation_gap: 'Recommendation gap',
  unlinked_mention: 'Mentioned but not cited',
  source_to_pitch: 'Source to pitch / buy a link',
  weak_platform: 'Weak AI platform',
}

export type OpportunityStatus = 'OPEN' | 'DISMISSED' | 'DONE'

// ── Brand setup ──────────────────────────────────────────────────────────────

export interface ProfileDTO {
  id: string
  projectId: string
  brandName: string
  aliases: string[]
  /** aliases that are generic words: counted only when a context term is in the same response */
  ambiguousAliases: string[]
  contextTerms: string[]
  primaryDomain: string
  ownedDomains: string[]
  country: string
  language: string
  industry: string
  products: string[]
  providers: ProviderKey[]
  promptSources: PromptSource[]
  schedule: Schedule
  nextRunAt: string | null
  lastRunAt: string | null
  monthlyBudgetUsd: number | null
  maxPromptsPerRun: number
  /** repeat asks per prompt per LLM provider; one of SAMPLE_OPTIONS */
  samplesPerPrompt: number
  updatedAt: string
}

export type ProfileInput = Partial<Omit<ProfileDTO, 'id' | 'projectId' | 'nextRunAt' | 'lastRunAt' | 'updatedAt'>>

export interface CompetitorDTO {
  id: string
  projectId: string
  name: string
  aliases: string[]
  domains: string[]
  status: 'ACTIVE' | 'INACTIVE'
  createdAt: string
}

export interface CompetitorInput { name?: string; aliases?: string[]; domains?: string[]; status?: 'ACTIVE' | 'INACTIVE' }

/** Client picker row: an existing Project of the organization */
export interface ProjectOptDTO {
  id: string
  name: string
  clientName: string
  website: string
  hasProfile: boolean
  activePrompts: number
  schedule: Schedule | null
  lastRunAt: string | null
  nextRunAt: string | null
}

// ── Prompts ──────────────────────────────────────────────────────────────────

export interface PromptDTO {
  id: string
  projectId: string
  text: string
  topic: string
  intent: PromptIntent
  journeyStage: JourneyStage
  country: string
  language: string
  source: PromptSource
  keyword: string
  searchVolume: number | null
  priority: Priority
  status: PromptStatus
  note: string
  createdAt: string
  updatedAt: string
}

export interface PromptInput {
  text: string
  topic?: string
  intent?: PromptIntent
  journeyStage?: JourneyStage
  country?: string
  language?: string
  source?: PromptSource
  keyword?: string
  searchVolume?: number | null
  priority?: Priority
  status?: PromptStatus
  note?: string
}

/** A generated / imported prompt before it is saved. Never stored until the user picks it. */
export interface PromptCandidate extends PromptInput {
  source: PromptSource
  /** set when the candidate duplicates or nearly duplicates something */
  duplicateOf?: { kind: 'existing' | 'batch'; text: string; similarity: number }
}

export interface PromptStats {
  /** responses with status DONE inside the filters */
  responses: number
  brandMentions: number
  /** brandMentions / responses, null when responses = 0 */
  mentionRate: number | null
  brandRecommended: number
  ownedCited: number
  citationRate: number | null
  /** best (highest) competitor mention rate on this prompt, null when no responses or no competitor seen */
  topCompetitor: { id: string; name: string; mentionRate: number } | null
  lastCollectedAt: string | null
}

export interface PromptRowDTO extends PromptDTO { stats: PromptStats }

export interface PromptListDTO {
  rows: PromptRowDTO[]
  total: number
  page: number
  pageSize: number
  counts: Record<PromptStatus, number>
  topics: string[]
}

export interface EntityShare {
  entityType: 'brand' | 'competitor'
  /** 'brand' or competitor id */
  key: string
  name: string
  /** responses (DONE) that mention the entity at least once */
  mentions: number
  /** mentions / responses, null when responses = 0 */
  mentionRate: number | null
  /** responses where the entity is recommended (heuristic, see METRIC_DEFINITIONS) */
  recommended: number
  /** responses that cite a domain owned by the entity */
  cited: number
  /** total raw occurrences across responses */
  occurrences: number
  /** mean order of first appearance among tracked entities, null when never mentioned */
  avgPosition: number | null
}

export interface CitedDomainRow {
  domain: string
  ownerType: CitationOwner
  competitorId: string | null
  competitorName: string
  /** citation rows */
  citations: number
  /** distinct responses citing the domain */
  responses: number
  /** distinct prompts citing the domain */
  prompts: number
  /** up to 5 example URLs, most cited first */
  urls: Array<{ url: string; title: string; count: number }>
  providers: ProviderKey[]
  lastSeenAt: string | null
  /** present when the domain is in the Backlink Management vendor library (a site that sells links) */
  vendor: { price: number | null; currency: string; domainRating: number | null; traffic: number | null; linkType: string; category: string } | null
  /** true when the domain is one of the organization's own PBN sites */
  isOwnPbn: boolean
}

export interface ResponseDTO {
  id: string
  runId: string
  promptId: string
  provider: ProviderKey
  providerLabel: string
  model: string
  collectionMethod: CollectionMethod
  status: TaskStatus
  error: string
  country: string
  language: string
  responseText: string
  collectedAt: string | null
  costUsd: number | null
  brandMentioned: boolean | null
  brandOccurrences: number | null
  brandRecommended: boolean | null
  ownedCited: boolean | null
  mentions: Array<{ entityType: 'brand' | 'competitor'; key: string; name: string; occurrences: number; recommended: boolean; compared: boolean; position: number | null; snippet: string }>
  citations: Array<{ url: string; domain: string; title: string; ownerType: CitationOwner; position: number }>
}

/** Per-prompt page: how often we appear, how often each competitor appears, who gets recommended, which sites are cited */
export interface PromptDetailDTO {
  prompt: PromptDTO
  /** DONE responses inside the filters */
  responses: number
  /** brand first, then competitors by mentions desc */
  entities: EntityShare[]
  byProvider: Array<{ provider: ProviderKey; label: string; responses: number; brandMentions: number; mentionRate: number | null; brandRecommended: number; ownedCited: number }>
  /** one point per run, oldest first */
  trend: Array<{ runId: string; date: string; responses: number; brandMentionRate: number | null; topCompetitorRate: number | null }>
  citedDomains: CitedDomainRow[]
  /** newest first, capped */
  history: ResponseDTO[]
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export interface RunDTO {
  id: string
  projectId: string
  trigger: RunTrigger
  status: RunStatus
  providers: ProviderKey[]
  promptCount: number
  /** repeat asks per prompt per LLM provider in this run (1 for runs made before samples existed) */
  samplesPerPrompt: number
  totalTasks: number
  doneTasks: number
  failedTasks: number
  skippedTasks: number
  /** actual spend so far (USD) */
  costUsd: number
  estimatedCostUsd: number | null
  periodKey: string | null
  error: string
  startedAt: string
  finishedAt: string | null
  createdByName: string
}

export interface RunEstimateDTO {
  prompts: number
  providers: ProviderKey[]
  /** repeat asks per prompt per LLM provider (observed SERP providers: 1) */
  samplesPerPrompt: number
  tasks: number
  /** null = no past cost data for at least one provider: cannot estimate honestly */
  estimatedCostUsd: number | null
  perProvider: Array<{ provider: ProviderKey; samples: number; tasks: number; avgCostUsd: number | null; basedOnCalls: number }>
  monthSpendUsd: number
  monthlyBudgetUsd: number | null
  /** true when the run would start; false when blocked (see reason) */
  allowed: boolean
  reason: string
}

export interface UsageDTO {
  month: string // "2026-11"
  monthSpendUsd: number
  monthlyBudgetUsd: number | null
  /** monthSpendUsd / monthlyBudgetUsd, null without a budget */
  budgetUsed: number | null
  calls: number
  byProvider: Array<{ provider: ProviderKey; label: string; calls: number; failed: number; costUsd: number }>
  /** last 6 months, oldest first */
  history: Array<{ month: string; costUsd: number; calls: number }>
}

// ── Analytics ────────────────────────────────────────────────────────────────

/** Global filters, kept in the URL: from/to are YYYY-MM-DD, '' or 'all' = no filter */
export interface RadarFilters {
  from: string
  to: string
  country: string
  language: string
  provider: ProviderKey | 'all'
}

export interface Kpis {
  /** DONE responses inside the filters */
  responses: number
  brandMentions: number
  mentionRate: number | null
  /** total raw occurrences of the brand */
  brandOccurrences: number
  citationCount: number
  citationRate: number | null
  /** competitor mention responses (any competitor) / responses */
  competitorMentionRate: number | null
  /** brand mentions / (brand mentions + sum of each tracked competitor's mentions) */
  shareOfVoice: number | null
  brandRecommended: number
  /** volume-weighted mention rate over prompts with a known search volume; an estimate, not impressions */
  estimatedVisibility: number | null
  /** prompts that fed estimatedVisibility */
  estimatedVisibilityPrompts: number
  monitoringPrompts: number
  lastScanAt: string | null
}

export interface TrendPoint {
  runId: string
  date: string // ISO
  label: string // short date for the axis
  responses: number
  mentionRate: number | null
  citationRate: number | null
  shareOfVoice: number | null
  /** true when the run used the same prompt set + providers as the latest run in the series */
  comparable: boolean
}

export interface OverviewDTO {
  /** false = no profile yet; the page shows the setup empty state */
  configured: boolean
  /** false = no DONE response inside the filters */
  hasData: boolean
  kpis: Kpis
  /** same KPIs for the previous period of equal length; null when there is none */
  previous: Kpis | null
  trend: TrendPoint[]
  /** brand + competitors, for the Share of Voice chart */
  entities: EntityShare[]
  byProvider: Array<{ provider: ProviderKey; label: string; method: CollectionMethod; responses: number; mentionRate: number | null; citationRate: number | null; shareOfVoice: number | null }>
  byIntent: Array<{ intent: PromptIntent; label: string; prompts: number; responses: number; mentionRate: number | null }>
  byTopic: Array<{ topic: string; prompts: number; responses: number; mentionRate: number | null; citationRate: number | null }>
  /** rows = topics (max 12), columns = providers present */
  heat: { rows: string[]; columns: string[]; values: Array<Array<number | null>> }
  citationOwners: Array<{ ownerType: CitationOwner; citations: number }>
  topCitedDomains: CitedDomainRow[]
  /** best and worst prompts by mention rate (min 1 response) */
  topPrompts: PromptRowDTO[]
  weakPrompts: PromptRowDTO[]
  activeRun: RunDTO | null
  lastRun: RunDTO | null
}

export interface CompetitorInsightsDTO {
  responses: number
  entities: EntityShare[]
  /** one series per entity; points share the run axis */
  trend: Array<{ key: string; name: string; points: Array<{ runId: string; label: string; mentionRate: number | null }> }>
  /** prompts where the competitor is mentioned and the brand is not */
  headToHead: Array<{ competitorId: string; name: string; bothMentioned: number; onlyCompetitor: number; onlyBrand: number; neither: number }>
  /** competitor x topic mention rate */
  byTopic: { rows: string[]; columns: string[]; values: Array<Array<number | null>> }
  /** top cited domains per competitor */
  domains: Array<{ competitorId: string; name: string; domains: Array<{ domain: string; citations: number }> }>
}

export type CitationView = 'own' | 'competitor' | 'external' | 'gap'

export interface CitationsDTO {
  view: CitationView
  rows: CitedDomainRow[]
  total: number
  page: number
  pageSize: number
  totals: { own: number; competitor: number; external: number; gap: number; citations: number; responsesWithCitations: number; responses: number }
}

export interface OpportunityDTO {
  id: string
  type: OpportunityType
  typeLabel: string
  title: string
  detail: string
  /** flat facts the score was computed from, shown as-is */
  evidence: Record<string, string | number | null>
  priority: Priority
  confidence: Confidence
  /** 0-100, see OPPORTUNITY_SCORING */
  score: number
  suggestedAction: string
  status: OpportunityStatus
  promptId: string | null
  domain: string | null
  competitorId: string | null
  updatedAt: string
}

// ── Metric definitions (shown in the UI next to every number) ────────────────

export interface MetricDefinition { key: string; name: string; formula: string; note: string }

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: 'responses', name: 'Responses', formula: 'count of collected AI answers (status DONE) inside the filters',
    note: 'One answer = one prompt asked to one AI provider in one scan. Failed and skipped calls are not counted.' },
  { key: 'brandMentions', name: 'Brand Mentions', formula: 'count of responses that name the brand at least once',
    note: 'A response counts once however many times it repeats the brand. Raw repeats are kept separately as occurrences.' },
  { key: 'mentionRate', name: 'AI Mention Rate', formula: 'Brand Mentions ÷ Responses',
    note: 'Insufficient Data when there are no responses.' },
  { key: 'citationCount', name: 'Citation Count', formula: 'count of cited links that point to a domain you own',
    note: 'Only a linked source counts. A mention of the brand without a link is not a citation.' },
  { key: 'citationRate', name: 'Domain Citation Rate', formula: 'responses with at least one link to a domain you own ÷ Responses',
    note: 'Insufficient Data when there are no responses.' },
  { key: 'competitorMentionRate', name: 'Competitor Mention Rate', formula: 'responses naming the competitor ÷ Responses',
    note: 'Per competitor. The overview figure counts responses naming any tracked competitor.' },
  { key: 'shareOfVoice', name: 'Share of Voice', formula: 'Brand Mentions ÷ (Brand Mentions + sum of each tracked competitor\'s mentions)',
    note: 'Denominator = mentions of the brand and of tracked competitors only. Untracked brands are not in it. Insufficient Data when the denominator is 0.' },
  { key: 'visibilityTrend', name: 'Visibility Trend', formula: 'AI Mention Rate per scan, in time order',
    note: 'Scans with a different prompt set or provider list are marked "not comparable".' },
  { key: 'estimatedVisibility', name: 'Estimated Visibility', formula: 'Σ(search volume × prompt mention rate) ÷ Σ(search volume), over prompts with a known volume',
    note: 'An estimate weighted by keyword search volume. It is not impressions and not real AI traffic.' },
  { key: 'citationGap', name: 'Citation Gap', formula: 'domains cited in answers to your prompts that never appear together with a link to your domain',
    note: 'Ranked by number of responses citing the domain.' },
  { key: 'recommendationGap', name: 'Recommendation Gap', formula: 'responses recommending a competitor − responses recommending the brand, per prompt',
    note: '"Recommended" is detected from wording near the name (e.g. recommend, best, แนะนำ). It is a heuristic.' },
]

export const OPPORTUNITY_SCORING =
  'score = 100 × (0.5 × evidence strength + 0.3 × prompt priority + 0.2 × search volume weight). ' +
  'Evidence strength = share of responses showing the gap. Prompt priority: high 1, medium 0.6, low 0.3. ' +
  'Volume weight = known volume scaled against the largest volume in the project, 0.5 when unknown. ' +
  'Confidence follows the number of responses behind it: 10+ high, 4-9 medium, fewer low. Nothing here is a ranking promise.'

// ── Limits ───────────────────────────────────────────────────────────────────

export const LIMITS = {
  promptTextMax: 500,
  promptsPerProjectMax: 2000,
  competitorsMax: 30,
  aliasesMax: 30,
  generateMin: 30,
  generateMax: 100,
  maxPromptsPerRunMax: 300,
  taskMaxAttempts: 3,
  taskStaleMs: 5 * 60_000,
  stepBatch: 8,
  urlMax: 1000,
  responseTextMax: 60_000,
  similarityThreshold: 0.8,
} as const

export const COUNTRIES: ReadonlyArray<{ code: string; label: string; dfsLocationCode: number }> = [
  { code: 'TH', label: 'Thailand', dfsLocationCode: 2764 },
  { code: 'US', label: 'United States', dfsLocationCode: 2840 },
  { code: 'GB', label: 'United Kingdom', dfsLocationCode: 2826 },
  { code: 'SG', label: 'Singapore', dfsLocationCode: 2702 },
  { code: 'MY', label: 'Malaysia', dfsLocationCode: 2458 },
  { code: 'VN', label: 'Vietnam', dfsLocationCode: 2704 },
  { code: 'ID', label: 'Indonesia', dfsLocationCode: 2360 },
  { code: 'JP', label: 'Japan', dfsLocationCode: 2392 },
  { code: 'AU', label: 'Australia', dfsLocationCode: 2036 },
  { code: 'IN', label: 'India', dfsLocationCode: 2356 },
]

export const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'th', label: 'Thai' },
  { code: 'en', label: 'English' },
]

// ── Samples (repeat asks) ────────────────────────────────────────────────────

/** How many times each prompt is asked per LLM provider in one run. Answers vary between asks,
 *  so a single ask is an anecdote: 10 asks gives a ±31% worst-case 95% margin, 30 asks ±18%. */
export const SAMPLE_OPTIONS = [1, 3, 5, 10, 20, 30] as const
export const DEFAULT_SAMPLES = 10
/** Below this many responses a percentage is shown with a "small sample" warning */
export const SMALL_SAMPLE_N = 10

export function isSampleOption(v: unknown): v is number {
  return typeof v === 'number' && (SAMPLE_OPTIONS as readonly number[]).includes(v)
}

/** Observed SERP providers (Google AI Mode / AI Overview) return the same page for repeat asks
 *  and are billed per request, so they are always sampled once; LLM providers use the profile setting. */
export function samplesFor(provider: ProviderKey, profileSamples: number): number {
  if (PROVIDERS[provider].method === 'observed_serp') return 1
  return normalizeSamples(profileSamples)
}

/** A stored value outside SAMPLE_OPTIONS (edited by hand) falls back to the default */
export function normalizeSamples(n: number): number {
  return isSampleOption(n) ? n : DEFAULT_SAMPLES
}

export function isProviderKey(v: unknown): v is ProviderKey {
  return typeof v === 'string' && (PROVIDER_KEYS as readonly string[]).includes(v)
}

// ── API surface (/api/brand-radar/...) ───────────────────────────────────────
//
// Every route: staff only (401 without a session, 403 for role CLIENT), and the projectId must
// belong to the caller's organization (404 otherwise). Errors are always { error: string }.
// "filters" = the query params written by radarQuery(): projectId, from, to (YYYY-MM-DD, days in
// Asia/Bangkok, inclusive), country, language, provider. A missing filter means "all".
//
// GET    projects                          -> ProjectsRes
// GET    profile?projectId                 -> ProfileRes
// PUT    profile            {projectId, ...ProfileInput}                 -> { profile: ProfileDTO }   (creates or updates)
// POST   competitors        {projectId, ...CompetitorInput}              -> { competitor: CompetitorDTO }
// PATCH  competitors/[id]   {projectId, ...CompetitorInput}              -> { competitor: CompetitorDTO }
// DELETE competitors/[id]?projectId                                      -> { ok: true }
// GET    competitors/insights?filters                                    -> CompetitorInsightsDTO
// GET    prompts?filters&status&source&intent&topic&q&sort&page&pageSize -> PromptListDTO
//          sort = recent | mention_rate_asc | mention_rate_desc | volume_desc | priority ; pageSize max 200
// POST   prompts            {projectId, prompts: PromptInput[]}          -> PromptSaveRes   (exact duplicates are skipped, not errors)
// POST   prompts/check      {projectId, prompts: PromptInput[]}          -> { candidates: PromptCandidate[] }   (dry run: duplicate flags only)
// POST   prompts/generate   {projectId, source, count?, seed?}           -> PromptGenerateRes   (nothing is saved)
//          source = ai_generated | gsc | keyword_database | paa_provider ; count 30-100 (ai_generated)
// POST   prompts/bulk       {projectId, ids, action, priority?}          -> { affected: number }
//          action = activate | deactivate | reject | delete | set_priority
// PATCH  prompts/[id]       {projectId, ...Partial<PromptInput>}         -> { prompt: PromptDTO }
// DELETE prompts/[id]?projectId                                          -> { ok: true }
// GET    prompts/export?filters&status                                   -> text/csv
// GET    prompts/[id]/detail?filters                                     -> PromptDetailDTO
// GET    providers?projectId                                             -> ProvidersRes
// POST   providers/test     {projectId, provider}                        -> { provider: ProviderStatusDTO }   (one real, billed call)
// GET    runs?projectId&page&pageSize                                    -> RunListRes
// POST   runs/estimate      {projectId}                                  -> RunEstimateDTO
// POST   runs               {projectId}                                  -> { run: RunDTO }
//          409 { error, run } when a scan is already running; 400 { error } when blocked (no profile,
//          no active prompt, no connected provider, monthly budget reached)
// GET    runs/[id]?projectId                                             -> RunDetailRes
// POST   runs/[id]/step     {projectId}                                  -> RunStepRes   (does a few calls; the page repeats it until done)
// POST   runs/[id]/cancel   {projectId}                                  -> { run: RunDTO }
// POST   runs/due           {projectId}                                  -> RunDueRes    (starts the scheduled scan when it is due; idempotent)
// GET    overview?filters                                                -> OverviewDTO
// GET    citations?filters&view&q&competitorId&page&pageSize             -> CitationsDTO   (pageSize max 1000)
// GET    opportunities?projectId&type&status&page&pageSize               -> OpportunityListRes
// PATCH  opportunities/[id] {projectId, status}                          -> { opportunity: OpportunityDTO }
// POST   opportunities/refresh {projectId}                               -> { total: number }
// GET    usage?projectId                                                 -> UsageDTO
// GET    cron   (Authorization: Bearer CRON_SECRET; no session)          -> { started: number; stepped: number }

export interface ProjectsRes { projects: ProjectOptDTO[] }

export interface ProfileRes {
  /** null = Brand Radar is not set up for this client yet */
  profile: ProfileDTO | null
  competitors: CompetitorDTO[]
  /** existing Project fields, used to pre-fill the first-time setup form */
  project: { id: string; name: string; clientName: string; website: string; industry: string; language: string }
}

export interface PromptSaveRes { created: number; skipped: Array<{ text: string; reason: string }> }

export interface PromptGenerateRes {
  source: PromptSource
  /** false = the source is not connected / has no data; `note` says why */
  connected: boolean
  candidates: PromptCandidate[]
  /** shown above the list, e.g. "AI generated. These are not real user queries." */
  note: string
}

export type PromptBulkAction = 'activate' | 'deactivate' | 'reject' | 'delete' | 'set_priority'

export interface ProvidersRes {
  providers: ProviderStatusDTO[]
  unsupported: Array<{ label: string; reason: string }>
}

export interface RunListRes { runs: RunDTO[]; total: number; page: number; pageSize: number }

export interface RunDetailRes {
  run: RunDTO
  /** calls that failed or were skipped, newest first (max 100) */
  failures: Array<{ promptText: string; provider: ProviderKey; status: TaskStatus; error: string }>
}

export interface RunStepRes { run: RunDTO; processed: number; done: boolean }

export interface RunDueRes { run: RunDTO | null; reason: string }

export interface OpportunityListRes {
  rows: OpportunityDTO[]
  total: number
  page: number
  pageSize: number
  /** OPEN opportunities per type */
  counts: Record<OpportunityType, number>
}
