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
 * observed_chat = the answer was read from the real chat product (ChatGPT, Gemini) by a licensed scraper
 *                 (DataForSEO LLM Scraper). It is what the web app showed a logged-out visitor in that country;
 *                 answers differ between asks, so the provider is asked several times like an API provider.
 * observed_serp = the AI answer was read from a live search results page by a licensed SERP provider.
 * imported      = rows brought in from a file.
 */
export type CollectionMethod = 'api_simulated' | 'observed_chat' | 'observed_serp' | 'imported'

export interface ProviderInfo {
  key: ProviderKey
  /** Honest label: says how the answer is collected (API call, or read from the real product by a scraper) */
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
    key: 'openai', label: 'ChatGPT (real answer, DataForSEO)', vendor: 'OpenAI', method: 'observed_chat', via: 'dataforseo',
    note: 'Answer read from the ChatGPT web app by DataForSEO LLM Scraper, with web search on. It is what a logged-out visitor sees; a logged-in user with memory or a paid plan can get a different answer.',
  },
  gemini: {
    key: 'gemini', label: 'Google Gemini (real answer, DataForSEO)', vendor: 'Google', method: 'observed_chat', via: 'dataforseo',
    note: 'Answer read from the Gemini web app by DataForSEO LLM Scraper. It is what a logged-out visitor sees. Gemini does not return the pages it found but did not cite, nor its search queries.',
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
  { label: 'ChatGPT / Gemini for a logged-in user (memory, paid plan)', reason: 'Answers are read as a logged-out visitor. No authorized source returns what a specific logged-in account sees.' },
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
  /** model slug that will be called ('' for dataforseo: the product picks its own model) */
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

/** The fixed schedules. `every:N` and `days:…` (below) are stored in the same text column. */
export const SCHEDULES = ['manual', 'daily', 'weekly', 'monthly'] as const
export type SchedulePreset = (typeof SCHEDULES)[number]
/**
 * A stored schedule value:
 *   manual | daily | weekly | monthly
 *   every:N      scan every N days (N = 2..SCHEDULE_LIMITS.intervalMax)
 *   days:1,3     scan on those weekdays (ISO numbers: 1 = Monday … 7 = Sunday, ascending)
 */
export type Schedule = SchedulePreset | `every:${number}` | `days:${string}`

export const SCHEDULE_LIMITS = { intervalMin: 2, intervalMax: 90 } as const

export type ScheduleSpec =
  | { kind: SchedulePreset }
  | { kind: 'interval'; days: number }
  | { kind: 'weekdays'; days: number[] }
export type ScheduleKind = ScheduleSpec['kind']

/** Stored value -> spec. Null when the value is not a schedule this version understands. */
export function parseSchedule(value: unknown): ScheduleSpec | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if ((SCHEDULES as readonly string[]).includes(v)) return { kind: v as SchedulePreset }
  const every = /^every:(\d{1,3})$/.exec(v)
  if (every) {
    const n = Number(every[1])
    if (n === 1) return { kind: 'daily' }
    return n >= SCHEDULE_LIMITS.intervalMin && n <= SCHEDULE_LIMITS.intervalMax ? { kind: 'interval', days: n } : null
  }
  const days = /^days:([1-7](?:,[1-7]){0,6})$/.exec(v)
  if (days) {
    const list = Array.from(new Set(days[1].split(',').map(Number))).sort((a, b) => a - b)
    return list.length === 7 ? { kind: 'daily' } : { kind: 'weekdays', days: list }
  }
  return null
}

/** Spec -> the one canonical stored value (every 1 day and all 7 weekdays are both `daily`) */
export function formatSchedule(spec: ScheduleSpec): Schedule {
  if (spec.kind === 'interval') return spec.days === 1 ? 'daily' : `every:${spec.days}`
  if (spec.kind === 'weekdays') return spec.days.length === 7 ? 'daily' : `days:${[...spec.days].sort((a, b) => a - b).join(',')}`
  return spec.kind
}

/** Any stored value -> canonical schedule, or the fallback when it cannot be read */
export function normalizeSchedule(value: unknown, fallback: Schedule): Schedule {
  const spec = parseSchedule(value)
  return spec ? formatSchedule(spec) : fallback
}

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
  /** repeat asks per prompt per LLM provider; a whole number from SAMPLES_MIN to SAMPLES_MAX */
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

/**
 * A project created inside Brand Radar ("manual project"). It has no row in the Project table: its
 * BrandRadarProfile is the project (name = brandName, website = primaryDomain), and its id carries this prefix.
 * Project ids from the Project table are cuids and never start with it.
 */
export const MANUAL_PROJECT_PREFIX = 'brm_'

export function isManualProjectId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(MANUAL_PROJECT_PREFIX)
}

/**
 * The project id to store on an AIJob row. AIJob.projectId is a foreign key to the Project table, so a manual
 * project is logged with null (the cost is still recorded, without a project).
 */
export function aiJobProjectId(projectId: string): string | null {
  return isManualProjectId(projectId) ? null : projectId
}

/** Client picker row: an existing Project of the organization, or a manual project created in Brand Radar */
export interface ProjectOptDTO {
  id: string
  name: string
  clientName: string
  website: string
  /** true = created inside Brand Radar; exists only in this module */
  manual: boolean
  hasProfile: boolean
  activePrompts: number
  schedule: Schedule | null
  lastRunAt: string | null
  nextRunAt: string | null
  /** Same-origin path of the uploaded brand logo (served by /api/brand-radar/logo), null when none */
  logo: string | null
  /** Icon of the brand's website, used when no logo was uploaded; null when the site is unknown */
  favicon: string | null
}

/**
 * State of one monitored brand on the landing list:
 *  needs_setup = the profile exists but no prompt is active, so nothing can be scanned yet
 *  scanning    = a scan is running now
 *  no_data     = prompts are ready but no answer was collected inside the window
 *  active      = answers exist inside the window
 */
export const BRAND_STATUSES = ['active', 'scanning', 'no_data', 'needs_setup'] as const
export type BrandStatus = (typeof BRAND_STATUSES)[number]

export const BRAND_STATUS_LABEL: Record<BrandStatus, string> = {
  active: 'กำลังติดตาม',
  scanning: 'กำลังสแกน',
  no_data: 'ยังไม่มีผล',
  needs_setup: 'ตั้งค่าไม่ครบ',
}

/** One row of the Brand Radar landing list: a brand that already has a monitor (= a saved profile) */
export interface BrandSummaryDTO {
  id: string
  /** Brand name of the profile */
  name: string
  /** Client / project name in MarsOS; '' for a project created inside Brand Radar */
  clientName: string
  website: string
  manual: boolean
  providers: ProviderKey[]
  /** Active competitors monitored next to the brand */
  competitors: number
  /** The competitor named in the most answers of the window; null when no competitor was named */
  topCompetitor: { name: string; answers: number; mentionRate: number | null } | null
  activePrompts: number
  /** Answers collected inside the window */
  asked: number
  /** Answers that name the brand */
  mentioned: number
  mentionRate: number | null
  /** Answers that name the brand or cite our site */
  appeared: number
  /** appeared / asked: the Visibility figure */
  visibilityRate: number | null
  /** Visibility of the newer half of the window minus the older half; null when either half has no answer */
  change: number | null
  /** Answers that cite a website of the brand */
  ownedCited: number
  citationRate: number | null
  /** Visibility per day that has answers, oldest first (Asia/Bangkok days) */
  spark: Array<{ date: string; asked: number; rate: number | null }>
  schedule: Schedule | null
  lastRunAt: string | null
  nextRunAt: string | null
  status: BrandStatus
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

/** gained = brand absent in the earlier run, present in the latest; lost = the opposite (two latest runs that asked the prompt) */
export type PromptRunChange = 'gained' | 'lost'

export interface PromptRowDTO extends PromptDTO { stats: PromptStats; runChange?: PromptRunChange | null; runChangeProviders?: { gained: ProviderKey[]; lost: ProviderKey[] } }

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
  /** Answers that name the entity or cite a site it owns: the Visibility numerator. */
  visible: number
  /** visible / all answers: the Visibility figure. */
  visibilityRate: number | null
  /** responses where the entity is recommended (heuristic, see METRIC_DEFINITIONS) */
  recommended: number
  /** responses that cite a domain owned by the entity */
  cited: number
  /** total raw occurrences across responses */
  occurrences: number
  /** mean order of first appearance among tracked entities, null when never mentioned */
  avgPosition: number | null
  /** mean share of the answer where the first mention starts (0 = start, 1 = end), null when unknown */
  avgPositionPct: number | null
  /** answers by the part of the answer where the entity first appears; rows with unknown position are not counted */
  zones: { early: number; middle: number; late: number }
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

/** A brand / product the AI platform itself tagged in one answer (DataForSEO scraper brand_entities). Not our tracked list. */
export interface OtherEntity { name: string; category: string; domain: string }

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
  /** repeat-ask number inside the run (0-based) */
  sampleIndex: number
  mentions: Array<{
    entityType: 'brand' | 'competitor'; key: string; name: string; occurrences: number; recommended: boolean; compared: boolean; position: number | null; positionPct: number | null; snippet: string
    /** the exact names / aliases found in the text (lowercase), used to highlight them */
    aliases: string[]
    /** true when the answer also links to this entity's own website */
    linked: boolean
  }>
  citations: Array<{
    url: string; domain: string; title: string; ownerType: CitationOwner; position: number
    /** set when the cited domain is in the Backlink Management vendor library */
    vendor: CitedDomainRow['vendor']
    /** true when the cited domain is one of the organization's own PBN sites */
    isOwnPbn: boolean
  }>
  /**
   * What the AI typed into its own web search before answering. Empty when the platform does not expose it
   * (see SEARCH_QUERY_SUPPORT) or the answer was collected before this was recorded.
   */
  /** Pages the AI found while searching but did not cite; empty for platforms that do not expose them */
  foundSources: Array<{ url: string; domain: string; title: string; ownerType: CitationOwner }>
  searchQueries: string[]
  /** How the AI talks about the brand and the competitors in this answer; null when not analysed */
  sentiment: AnswerSentiment | null
  /** Other names the AI platform tagged in this answer, beyond the tracked brand and competitors; absent when not captured */
  otherEntities?: OtherEntity[]
}

/** Full-answer viewer: one prompt, one run, one AI platform, every repeat ask */
export interface ResponseViewerDTO {
  prompt: { id: string; text: string; country: string; language: string; topic: string }
  brandName: string
  /** runs that hold answers for this prompt, newest first (capped) */
  runs: Array<{ runId: string; date: string; providers: ProviderKey[]; responses: number }>
  runId: string | null
  /** platforms answered in the selected run */
  providers: Array<{ provider: ProviderKey; label: string; method: CollectionMethod; responses: number; brandMentions: number }>
  provider: ProviderKey | null
  /** every attempt for the selected run + platform, by sampleIndex */
  samples: ResponseDTO[]
  /** mention key (ResponseDTO.mentions[].key) -> website domain, used for logos */
  entityDomains?: Record<string, string>
  /** counts over the DONE samples above */
  summary: {
    asked: number
    brandMentioned: number
    brandRecommended: number
    ownedCited: number
    /** brand first, then competitors by answers mentioning them */
    entities: Array<{ key: string; name: string; entityType: 'brand' | 'competitor'; answers: number; recommended: number; avgPosition: number | null; avgPositionPct: number | null; zones?: { early: number; middle: number; late: number } }>
    /** domains cited across samples, most answers first */
    domains: Array<{ domain: string; ownerType: CitationOwner; answers: number; vendor: CitedDomainRow['vendor']; isOwnPbn: boolean }>
  }
}

// ── AI search queries + brand sentiment (one BrandRadarInsight row per answer) ──

/** Whether a platform tells us the search queries it ran */
export type SearchQuerySupport = 'exposed' | 'prompt' | 'hidden'

/**
 * exposed = the platform returns the queries it searched with;
 * prompt  = Google answers the question itself, so the search query is the question;
 * hidden  = the platform searches but does not return its queries.
 */
export const SEARCH_QUERY_SUPPORT: Record<ProviderKey, SearchQuerySupport> = {
  openai: 'exposed',
  claude: 'exposed',
  gemini: 'hidden',
  perplexity: 'hidden',
  grok: 'hidden',
  deepseek: 'hidden',
  google_ai_mode: 'prompt',
  google_ai_overview: 'prompt',
}

export type SentimentTone = 'positive' | 'neutral' | 'negative' | 'mixed'

export const SENTIMENT_TONES: readonly SentimentTone[] = ['positive', 'neutral', 'mixed', 'negative']

export const SENTIMENT_TONE_LABEL: Record<SentimentTone, string> = {
  positive: 'เชิงบวก',
  neutral: 'เป็นกลาง',
  mixed: 'มีทั้งบวกและลบ',
  negative: 'เชิงลบ',
}

/** What kind of brand the AI presents an entity as. Fixed list so it can be counted. */
export const BRAND_POSITIONINGS = [
  'leader', 'premium', 'value', 'specialist', 'trusted', 'innovative', 'convenient', 'popular', 'alternative', 'niche', 'general',
] as const

export type BrandPositioning = (typeof BRAND_POSITIONINGS)[number]

export const BRAND_POSITIONING_LABEL: Record<BrandPositioning, string> = {
  leader: 'ผู้นำตลาด',
  premium: 'พรีเมียม',
  value: 'คุ้มค่า / ราคาประหยัด',
  specialist: 'เชี่ยวชาญเฉพาะทาง',
  trusted: 'น่าเชื่อถือ / มีชื่อเสียงมานาน',
  innovative: 'ทันสมัย / มีนวัตกรรม',
  convenient: 'สะดวก ใช้งานง่าย',
  popular: 'เป็นที่นิยม',
  alternative: 'ทางเลือกรอง',
  niche: 'เฉพาะกลุ่ม',
  general: 'ทั่วไป ไม่มีจุดเด่นชัด',
}

/** What the AI weighs when it answers. Fixed list so it can be counted. */
export const SENTIMENT_FACTORS = [
  'price', 'quality', 'service', 'trust', 'expertise', 'reviews', 'convenience', 'variety',
  'innovation', 'safety', 'speed', 'after_sales', 'promotion', 'location', 'other',
] as const

export type SentimentFactor = (typeof SENTIMENT_FACTORS)[number]

export const SENTIMENT_FACTOR_LABEL: Record<SentimentFactor, string> = {
  price: 'ราคา / ความคุ้มค่า',
  quality: 'คุณภาพ',
  service: 'การบริการ',
  trust: 'ความน่าเชื่อถือ',
  expertise: 'ความเชี่ยวชาญ',
  reviews: 'รีวิว / เสียงผู้ใช้',
  convenience: 'ความสะดวก',
  variety: 'ความหลากหลาย',
  innovation: 'นวัตกรรม / เทคโนโลยี',
  safety: 'ความปลอดภัย / มาตรฐาน',
  speed: 'ความรวดเร็ว',
  after_sales: 'บริการหลังการขาย',
  promotion: 'โปรโมชัน',
  location: 'ทำเล / สาขา',
  other: 'อื่น ๆ',
}

/** What an answer has to talk about to be counted under a factor, in one short line for the report */
export const SENTIMENT_FACTOR_HINT: Record<SentimentFactor, string> = {
  price: 'ราคา ค่าใช้จ่าย หรือความคุ้มค่า',
  quality: 'คุณภาพของสินค้า บริการ หรือผลงาน',
  service: 'การดูแลลูกค้าและการให้บริการ',
  trust: 'ชื่อเสียง ประสบการณ์ ความโปร่งใส หรือความน่าไว้วางใจ',
  expertise: 'ความรู้ ความชำนาญ หรือความเชี่ยวชาญเฉพาะด้าน',
  reviews: 'รีวิว คะแนน หรือเสียงจากผู้ใช้จริง',
  convenience: 'ความสะดวก ใช้ง่าย เข้าถึงง่าย',
  variety: 'ตัวเลือกหรือบริการที่หลากหลาย',
  innovation: 'เทคโนโลยี เครื่องมือ หรือสิ่งใหม่',
  safety: 'ความปลอดภัย ใบรับรอง หรือมาตรฐาน',
  speed: 'ความเร็วในการทำงานหรือการส่งมอบ',
  after_sales: 'การดูแลหลังซื้อ การรับประกัน หรือการซัพพอร์ต',
  promotion: 'ส่วนลด โปรโมชัน หรือข้อเสนอพิเศษ',
  location: 'ที่ตั้ง สาขา หรือพื้นที่ให้บริการ',
  other: 'เรื่องอื่นที่ไม่เข้ากลุ่มข้างต้น',
}

export type FactorPolarity = 'positive' | 'negative' | 'neutral'

/** How one answer talks about one tracked entity */
export interface AnswerSentimentEntity {
  entityType: 'brand' | 'competitor'
  /** 'brand' or competitor id */
  key: string
  name: string
  tone: SentimentTone
  positioning: BrandPositioning[]
  /** factors the answer ties to this entity, each as a plus, a minus or a plain statement */
  factors: Array<{ code: SentimentFactor; polarity: FactorPolarity; /** words copied from the answer that show the factor (brand only) */ quote?: string }>
  /** one short sentence, in the answer's language, on how the AI describes the entity */
  summary: string
  /** up to 3 short labels (2-4 words) the answer gives the entity, e.g. "performance agency"; free text, lowercase */
  descriptors: string[]
  /** descriptor text (as in `descriptors`) -> words copied from the answer that show it (brand only) */
  descriptorQuotes?: Record<string, string>
}

export interface AnswerSentiment {
  /** what the answer as a whole weighs, most important first */
  factors: SentimentFactor[]
  /** tracked entities the answer talks about */
  entities: AnswerSentimentEntity[]
}

/** An example passage from one AI answer that shows why a factor or a label was assigned. Untrusted text. */
export interface InsightQuote {
  text: string
  responseId: string
  promptId: string
  runId?: string
  provider?: ProviderKey
  /** true = taken from the text around the brand name (old answers), not a passage the analysis chose */
  approx?: boolean
  /** factor quotes: the polarity of the answer the quote came from */
  polarity?: FactorPolarity
}

/** One answer counted under a factor of "what the AI weighs". `prompt` is untrusted text (user input). */
export interface FactorExample {
  responseId: string
  promptId: string
  runId?: string
  provider?: ProviderKey
  /** when the answer was collected (ms since epoch); 0 = unknown */
  at: number
  /** the question that was asked */
  prompt: string
  /** a passage of the answer; untrusted text (AI output) */
  quote?: string
  /**
   * Where `quote` comes from: 'analysis' = the passage the analysis copied for our brand under this factor,
   * 'keyword' = the line holding a word typical of the factor, 'lead' = the opening of the answer (no such line).
   */
  quoteFrom?: 'analysis' | 'keyword' | 'lead'
}

/** One analysed answer behind a tone count. Every string is untrusted text (AI output / user input). */
export interface ToneExample {
  responseId: string
  promptId: string
  runId?: string
  provider?: ProviderKey
  /** when the answer was collected (ms since epoch); 0 = unknown */
  at: number
  /** the question that was asked */
  prompt: string
  /** one sentence from the analysis on how the answer talks about the entity */
  summary: string
  /** what the answer counts for / against the entity, with the words copied from the answer when stored */
  points: Array<{ code: SentimentFactor; label: string; polarity: FactorPolarity; quote?: string }>
}

export interface InsightEntityDTO {
  entityType: 'brand' | 'competitor'
  key: string
  name: string
  /** analysed answers that talk about this entity */
  answers: number
  /** answers per tone; adds up to `answers` */
  tones: Record<SentimentTone, number>
  /** how the AI presents the entity, most answers first */
  positioning: Array<{ code: BrandPositioning; label: string; answers: number; rate: number | null }>
  /** what the AI ties to the entity, most answers first; positive + negative + neutral = answers */
  factors: Array<{ code: SentimentFactor; label: string; answers: number; positive: number; negative: number; neutral: number; quotes?: InsightQuote[] }>
  /** up to 3 recent one-sentence descriptions taken from the analysis */
  summaries: string[]
  /** the short labels the AI gives the entity, most answers first (capped) */
  descriptors: Array<{ text: string; answers: number; quotes?: InsightQuote[] }>
  /** the newest answers behind each tone count (capped); absent for an entity whose details are not shown */
  toneAnswers?: Partial<Record<SentimentTone, ToneExample[]>>
}

/** AI search queries that are about the same thing, counted together */
export interface QueryGroupDTO {
  group: string
  /** times a query of this group was searched (one answer can search several) */
  searches: number
  /** answers that searched at least one query of this group */
  answers: number
  providers: ProviderKey[]
  /** the questions that led to these searches, most searches first (capped) */
  prompts: Array<{ promptId: string; text: string; searches: number }>
  /** the queries inside the group, most searches first (capped) */
  queries: Array<{ query: string; searches: number }>
}

/** Aggregates over the answers inside the filters that have an insight row */
export interface AnswerInsightDTO {
  /** false when the insight table is not there yet (SQL not run) */
  available: boolean
  /** answers with a sentiment analysis */
  analyzed: number
  /** what the AI weighs across all analysed answers, most answers first; rate = answers / analyzed */
  factors: Array<{ code: SentimentFactor; label: string; answers: number; rate: number | null; /** the newest answers counted here (capped) */ examples?: FactorExample[] }>
  /** tone over every entity judgement (brand + competitors) */
  overallTones: Record<SentimentTone, number>
  /** brand first, then competitors by answers */
  entities: InsightEntityDTO[]
  /** answers that carry at least one search query the AI ran itself */
  answersWithQueries: number
  /** total searches counted in `queryGroups` */
  searches: number
  /** the AIs' own search queries sorted into topic groups, most searches first (capped) */
  queryGroups: QueryGroupDTO[]
}

/** How the brand is brought up in the answers that name it. recommended + compared + listed = answers naming the brand. */
export type AnswerZone = 'early' | 'middle' | 'late'

/** Beginning / middle / end of an answer from a 0..1 share; null when unknown. */
export function answerZone(pct: number | null | undefined): AnswerZone | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null
  if (pct < 1 / 3) return 'early'
  if (pct < 2 / 3) return 'middle'
  return 'late'
}

export interface MentionStyleCounts {
  /** the answer recommends the brand */
  recommended: number
  /** the answer compares the brand with others without recommending it */
  compared: number
  /** the answer just names the brand */
  listed: number
  /** the brand is the first tracked name in the answer (can overlap the three above) */
  first: number
  /** answers by where in the answer the brand first appears; rows with unknown position are not counted */
  zones: { early: number; middle: number; late: number }
}

/**
 * How one answer carries the brand:
 *   both          = names the brand AND links to one of our sites
 *   mention_only  = names the brand, no link to our sites
 *   citation_only = links to one of our sites, the text never names the brand
 *   none          = neither
 */
export type AnswerKind = 'both' | 'mention_only' | 'citation_only' | 'none'

export const ANSWER_KINDS: readonly AnswerKind[] = ['both', 'mention_only', 'citation_only', 'none']

export function answerKind(brandMentioned: boolean | null | undefined, ownedCited: boolean | null | undefined): AnswerKind {
  const m = brandMentioned === true
  const c = ownedCited === true
  return m && c ? 'both' : m ? 'mention_only' : c ? 'citation_only' : 'none'
}

export type AnswerKindCounts = Record<AnswerKind, number>

/**
 * Which question x AI groups the answer list shows.
 * A kind keeps the groups with at least one answer of that kind; `none` keeps the groups where no answer
 * names or links the brand; `competitor_only` is `none` plus at least one answer naming a tracked competitor.
 */
export type AnswerMentionFilter = 'all' | AnswerKind | 'competitor_only'

export const ANSWER_MENTION_FILTERS: readonly AnswerMentionFilter[] = ['all', 'both', 'mention_only', 'citation_only', 'none', 'competitor_only']

/** One question on one AI platform: how often the brand came up across the repeat asks, plus one real answer to read */
export interface AnswerFeedItem {
  promptId: string
  promptText: string
  topic: string
  provider: ProviderKey
  providerLabel: string
  /** DONE answers inside the filters */
  asked: number
  /** answers that name the brand */
  mentioned: number
  mentionRate: number | null
  recommended: number
  /** answers that link to one of our sites */
  ownedCited: number
  /** answers per kind; the four numbers add up to `asked` */
  kinds: AnswerKindCounts
  /** times the brand name appears across these answers */
  occurrences: number
  /** how the brand is brought up in the answers that name it */
  mentionStyle: MentionStyleCounts
  /** answers that name at least one tracked competitor */
  competitorAnswers: number
  /** tracked competitors named in these answers, most answers first */
  competitors: Array<{ key: string; name: string; answers: number }>
  lastCollectedAt: string | null
  /** the answer shown: the newest of the best kind present (both, then name only, then link only), or of the kind being filtered */
  answer: ResponseDTO | null
}

/** Result-first report: how often AI answers name the brand and the competitors, with the answers themselves */
export interface AnswerFeedDTO {
  configured: boolean
  hasData: boolean
  brandName: string
  /** counted exactly like the Overview KPIs (DONE answers inside the filters) */
  totals: {
    asked: number
    mentioned: number
    mentionRate: number | null
    recommended: number
    /** answers that link to one of our sites */
    ownedCited: number
    citationRate: number | null
    /** answers that name the brand or link to our sites */
    appeared: number
    appearRate: number | null
    /** answers per kind; the four numbers add up to `asked` */
    kinds: AnswerKindCounts
    /** times the brand name appears across all answers */
    occurrences: number
    /** how the brand is brought up in the answers that name it */
    mentionStyle: MentionStyleCounts
    /** mean order of the brand among tracked names (1 = named first), null when never named */
    avgPosition: number | null
    /** mean share of the answer where the brand's first mention starts (0 = start, 1 = end), null when unknown */
    avgPositionPct: number | null
    /** mention rate of the newest day minus the oldest day inside the filters (a fraction, 0.05 = +5 points); null with fewer than 2 days */
    change: number | null
    /** questions with at least one answer */
    prompts: number
    /** questions where at least one answer names the brand */
    promptsMentioned: number
  }
  /** brand first, then tracked competitors by answers mentioning them */
  entities: EntityShare[]
  /** per entity key: mention rate of the newest day minus the oldest day; null with fewer than 2 days */
  entityChange: Record<string, number | null>
  byProvider: Array<{ provider: ProviderKey; label: string; asked: number; mentioned: number; mentionRate: number | null; ownedCited: number; kinds: AnswerKindCounts }>
  /** share of answers naming each entity per day (Bangkok time), oldest first; values line up with `series` */
  trend: {
    series: Array<{ key: string; name: string; entityType: 'brand' | 'competitor' }>
    points: Array<{ date: string; asked: number; values: Array<number | null> }>
  }
  /** websites the answers cite, most answers first (capped); rate = answers citing the domain / asked */
  sources: Array<{ domain: string; ownerType: CitationOwner; competitorName: string; answers: number; rate: number | null }>
  /** entity key -> website domain, for logos in the competitor table ('brand' = our site, competitor id = its first domain); absent = no logo */
  entityDomains?: Record<string, string>
  /** AI search queries + brand sentiment over the answers inside the filters */
  insight: AnswerInsightDTO
  /** the brand per scan round inside the filters, oldest first (latest rounds only, capped); optional while the backend is updated */
  scans?: ScanProgressPoint[]
  /** a grade per headline number and this month against earlier months; absent when there is no data */
  scorecard?: import('./scorecard-types').ScorecardDTO
  /** question x AI groups per filter value, after the text search */
  counts: Record<AnswerMentionFilter, number>
  items: AnswerFeedItem[]
  page: number
  pageSize: number
  total: number
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
  /** last 6 months, oldest first; `calls` includes the `failed` ones */
  history: Array<{ month: string; costUsd: number; calls: number; failed: number }>
}

/**
 * Average cost of one ask that got an answer: cost divided by the calls that did not fail.
 * null when no call succeeded, so the page shows "no data" instead of a made-up 0.
 */
export function costPerCall(costUsd: number, calls: number, failed = 0): number | null {
  const answered = calls - failed
  if (!Number.isFinite(costUsd) || !Number.isFinite(answered) || answered <= 0) return null
  return costUsd / answered
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

/** One scan round of the brand, for the scan-by-scan comparison on the Overview. Counts are DONE answers of that round. */
export interface ScanProgressPoint {
  runId: string
  /** when the round started, ISO */
  date: string
  /** short Bangkok date + time for a chart axis, e.g. "19/11 11:12" */
  label: string
  /** answers collected in the round */
  asked: number
  /** answers that name the brand at least once */
  mentioned: number
  /** mentioned / asked: the brand mention rate (appearRate is the Visibility figure), null when asked = 0 */
  mentionRate: number | null
  /** answers that link to one of our sites */
  ownedCited: number
  citationRate: number | null
  /** answers that name the brand or link to our sites */
  appeared: number
  appearRate: number | null
  /** mean order of the brand among tracked names (1 = named first), null when never named in the round */
  avgPosition: number | null
  /** mean share of the answer where the brand's first mention starts (0 = start, 1 = end), null when unknown */
  avgPositionPct: number | null
  /** false when the round before it used another prompt set or other AI platforms, so the difference is not like for like; null on the first round */
  sameSetAsPrevious: boolean | null
}

export interface OverviewDTO {
  /** false = no profile yet; the page shows the setup empty state */
  configured: boolean
  /** false = no DONE response inside the filters */
  hasData: boolean
  kpis: Kpis
  byProvider: Array<{ provider: ProviderKey; label: string; method: CollectionMethod; responses: number; mentionRate: number | null; citationRate: number | null; shareOfVoice: number | null }>
  byIntent: Array<{ intent: PromptIntent; label: string; prompts: number; responses: number; mentionRate: number | null }>
  /** rows = topics (max 12), columns = providers present */
  heat: { rows: string[]; columns: string[]; values: Array<Array<number | null>> }
  /** metrics helpers still build these; the Overview response no longer sends them */
  byTopic?: Array<{ topic: string; prompts: number; responses: number; mentionRate: number | null; citationRate: number | null }>
  citationOwners?: Array<{ ownerType: CitationOwner; citations: number }>
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
  /** answers split by who is named in them (our brand / tracked competitors) */
  mentionSplit?: MentionSplit
  /** brands the AI platforms name that are not tracked yet; staff only, never sent in the client view */
  untracked?: import('./untracked-types').UntrackedBrandsDTO
}

export interface MentionSplit {
  total: number
  onlyBrand: number
  brandAndCompetitor: number
  onlyCompetitor: number
  nobody: number
}

export type CitationView = 'own' | 'competitor' | 'external' | 'gap'

export interface CitationsDTO {
  view: CitationView
  rows: CitedDomainRow[]
  total: number
  page: number
  pageSize: number
  totals: { own: number; competitor: number; external: number; gap: number; citations: number; responsesWithCitations: number; responses: number }
  /** top cited pages (same view / search filters as the domain rows) */
  pages?: CitedPageRow[]
  /** comparison with the previous period of equal length; available=false means show no new / lost marks */
  comparison?: CitationComparison
}

export interface CitedPageRow {
  url: string
  title: string
  domain: string
  ownerType: CitationOwner
  competitorName: string
  /** distinct answers citing the page */
  answers: number
  /** distinct AI platforms citing the page */
  platforms: number
  isNew: boolean
}

export interface CitationComparison {
  available: boolean
  previousFrom: string
  previousTo: string
  /** domains cited now but not in the previous period */
  newDomains: string[]
  /** total number of new domains before newDomains is capped at 1000 */
  newDomainCount?: number
  /** domains cited in the previous period but not now (top 20) */
  lostDomains: Array<{ domain: string; ownerType: CitationOwner; competitorName: string; answers: number }>
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
  { key: 'visibilityTrend', name: 'Visibility Trend', formula: 'Visibility (answers that name the brand or cite our site ÷ all answers) per scan, in time order',
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

/** A count typed by hand may be any whole number in this range; SAMPLE_OPTIONS are only the listed shortcuts. */
export const SAMPLES_MIN = 1
export const SAMPLES_MAX = 50

export function isSampleOption(v: unknown): v is number {
  return typeof v === 'number' && (SAMPLE_OPTIONS as readonly number[]).includes(v)
}

export function isValidSamples(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= SAMPLES_MIN && v <= SAMPLES_MAX
}

/** Worst-case 95% margin of a share measured from n asks, in whole percent (10 asks = 31) */
export function sampleMarginPct(n: number): number {
  return n > 0 ? Math.round(98 / Math.sqrt(n)) : 100
}

/** Observed SERP providers (Google AI Mode / AI Overview) return the same page for repeat asks
 *  and are billed per request, so they are always sampled once; LLM providers use the profile setting.
 *  observed_chat providers (ChatGPT / Gemini scraper) answer differently each ask, so they use the profile setting too. */
export function samplesFor(provider: ProviderKey, profileSamples: number): number {
  if (PROVIDERS[provider].method === 'observed_serp') return 1
  return normalizeSamples(profileSamples)
}

/** A stored value outside the allowed range falls back to the default */
export function normalizeSamples(n: number): number {
  return isValidSamples(n) ? n : DEFAULT_SAMPLES
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

// POST   projects {name, website, aliases?, providers?, competitors?: [{name, domain?}]} -> CreateProjectRes (409: the name is taken)
// GET    responses ?projectId&filters&mention&q&page&pageSize             -> AnswerFeedDTO
// GET    brands                                                           -> BrandsRes   (brands that have a monitor; last 30 days)

export interface ProjectsRes { projects: ProjectOptDTO[] }

export interface CreateProjectRes { project: ProjectOptDTO }

export interface BrandsRes {
  /** Length of the window the numbers cover, in days */
  windowDays: number
  brands: BrandSummaryDTO[]
}

export interface ProfileRes {
  /** null = Brand Radar is not set up for this client yet */
  profile: ProfileDTO | null
  competitors: CompetitorDTO[]
  /** existing Project fields, used to pre-fill the first-time setup form */
  project: { id: string; name: string; clientName: string; website: string; industry: string; language: string }
  /** Background scanning switch of this project. Staff only: never sent to a client login. */
  auto?: AutoScanDTO
}

/** Background scanning ("สแกนอัตโนมัติตามรอบ"): the server scans on schedule without anyone opening the page */
export interface AutoScanDTO {
  /** the switch of this project */
  on: boolean
  /** false = the server has no CRON_SECRET, so the scheduled job cannot run yet */
  ready: boolean
  /** last time the scheduled server job ran (ISO), null = it has never run */
  lastTickAt: string | null
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
