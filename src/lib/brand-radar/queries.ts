/**
 * Brand Radar — server-side queries and DTO builders (overview, prompts, citations, opportunities...).
 * Server only. EVERY query filters by ctx.orgId AND ctx.project.id.
 * The maths lives in the pure engines (metrics.ts, opportunities.ts); this file loads rows and shapes DTOs.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PBN_PREFS_MARK, readPbnSites } from '@/lib/upload-article/pbn'
import {
  citationGapDomains, citedDomains, competitorByTopic, competitorDomains, competitorTrend, computeKpis,
  byIntent, byProvider, entityShares, headToHead, promptEntityTrend, promptStatsMap,
  topicProviderHeat, citedPages, diffPeriods, mentionSplit, promptRunChanges, promptRunChangeDetails, scanProgress,
  type CitationRow, type Dataset, type MentionRow, type PromptLite, type RespRow, type RunLite,
} from './metrics'
import {
  INSIGHT_LIMITS, aggregateInsight, answerLead, bangkokDay, dailyTrend, emptyInsight, factorPassage, fallbackQuote, mentionStyleOf, parseStoredFoundSources, parseStoredQueries, parseStoredSentiment,
  type BrandMentionLite, type InsightRow,
  type FoundSource,
} from './insight'
import { buildOpportunities } from './opportunities'
import { buildScorecard } from './scorecard-load'
import { computeUntrackedBrands } from './untracked-brands'
import type { UntrackedBrandsDTO } from './untracked-types'
import { brandTermsOf } from './highlight'
import { toRunDTO } from './runner'
import { domainMatches, hostOf, normalizeDomain } from './normalize'
import { parseDayRange, previousRange } from './schedule'
import { brandLogoVersions } from './brand-logo'
import { brandLogoPath } from './logo'
import { faviconUrl } from '@/lib/backlink-management/project-logos'
import { isMissingTable, parseObject, parseStrings, userNames, type RadarCtx } from './server'
import {
  ANSWER_MENTION_FILTERS, answerZone, JOURNEY_STAGES, OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABEL, PRIORITIES, PROMPT_INTENTS, PROMPT_SOURCES, PROMPT_STATUSES,
  PROVIDERS, PROVIDER_KEYS, answerKind, isManualProjectId, isProviderKey, normalizeSchedule,
  type AnswerInsightDTO, type AnswerSentiment, type FactorPolarity, type InsightQuote, type BrandStatus, type BrandSummaryDTO,
  type AnswerFeedDTO, type AnswerFeedItem, type AnswerKind, type AnswerKindCounts, type AnswerMentionFilter, type CitationComparison, type CitationOwner, type CitationsDTO, type CitationView, type CitedDomainRow, type CollectionMethod, type CompetitorDTO,
  type CompetitorInsightsDTO, type Confidence, type JourneyStage, type OpportunityDTO, type OpportunityListRes,
  type OpportunityStatus, type OpportunityType, type OtherEntity, type OverviewDTO, type Priority, type ProfileDTO, type ProjectOptDTO,
  type PromptDTO, type PromptDetailDTO, type PromptIntent, type PromptListDTO, type PromptRowDTO, type PromptSource,
  type PromptStats, type PromptStatus, type ProviderKey, type RadarFilters, type ResponseDTO, type ResponseViewerDTO, type RunDTO, type RunStatus,
  type Schedule, type TaskStatus,
} from './types'

// ── Filters ──────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Query params -> filters. Unknown / malformed values fall back to "all" (never an error). */
export function parseFilters(sp: URLSearchParams): RadarFilters {
  const day = (k: string): string => {
    const v = (sp.get(k) ?? '').trim()
    return DAY_RE.test(v) ? v : ''
  }
  const text = (k: string, max: number): string => {
    const v = (sp.get(k) ?? '').trim().slice(0, max)
    return v === '' || v.toLowerCase() === 'all' ? 'all' : v
  }
  const prov = (sp.get('provider') ?? '').trim()
  return {
    from: day('from'),
    to: day('to'),
    country: text('country', 8) === 'all' ? 'all' : text('country', 8).toUpperCase(),
    language: text('language', 8).toLowerCase(),
    provider: isProviderKey(prov) ? prov : 'all',
  }
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback
}

export interface ProfileRow {
  id: string; projectId: string; brandName: string; aliases: string; ambiguousAliases: string; contextTerms: string
  primaryDomain: string; ownedDomains: string; country: string; language: string; industry: string; products: string
  providers: string; promptSources: string; schedule: string; nextRunAt: Date | null; lastRunAt: Date | null
  monthlyBudgetUsd: number | null; maxPromptsPerRun: number; samplesPerPrompt: number; updatedAt: Date
}

export function toProfileDTO(r: ProfileRow): ProfileDTO {
  return {
    id: r.id,
    projectId: r.projectId,
    brandName: r.brandName,
    aliases: parseStrings(r.aliases),
    ambiguousAliases: parseStrings(r.ambiguousAliases),
    contextTerms: parseStrings(r.contextTerms),
    primaryDomain: r.primaryDomain,
    ownedDomains: parseStrings(r.ownedDomains),
    country: r.country,
    language: r.language,
    industry: r.industry,
    products: parseStrings(r.products),
    providers: parseStrings(r.providers).filter(isProviderKey),
    promptSources: parseStrings(r.promptSources).filter((s): s is PromptSource => (PROMPT_SOURCES as readonly string[]).includes(s)),
    schedule: normalizeSchedule(r.schedule, 'manual'),
    nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
    lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
    monthlyBudgetUsd: r.monthlyBudgetUsd,
    maxPromptsPerRun: r.maxPromptsPerRun,
    samplesPerPrompt: r.samplesPerPrompt,
    updatedAt: r.updatedAt.toISOString(),
  }
}

/** The profile a customer login receives: brand facts only, no scan settings, budget or matching rules. */
export function toClientProfileDTO(r: ProfileRow): ProfileDTO {
  return {
    ...toProfileDTO(r),
    ambiguousAliases: [],
    contextTerms: [],
    promptSources: [],
    schedule: normalizeSchedule('manual', 'manual'),
    nextRunAt: null,
    monthlyBudgetUsd: null,
    maxPromptsPerRun: 0,
  }
}

export interface CompetitorRow {
  id: string; projectId: string; name: string; aliases: string; domains: string; status: string; createdAt: Date
}

export function toCompetitorDTO(r: CompetitorRow): CompetitorDTO {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    aliases: parseStrings(r.aliases),
    domains: parseStrings(r.domains),
    status: r.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    createdAt: r.createdAt.toISOString(),
  }
}

export interface PromptRow {
  id: string; projectId: string; text: string; topic: string; intent: string; journeyStage: string; country: string
  language: string; source: string; keyword: string; searchVolume: number | null; priority: string; status: string
  note: string; createdAt: Date; updatedAt: Date
}

export function toPromptDTO(r: PromptRow): PromptDTO {
  return {
    id: r.id,
    projectId: r.projectId,
    text: r.text,
    topic: r.topic,
    intent: oneOf<PromptIntent>(PROMPT_INTENTS, r.intent, 'informational'),
    journeyStage: oneOf<JourneyStage>(JOURNEY_STAGES, r.journeyStage, 'awareness'),
    country: r.country,
    language: r.language,
    source: oneOf<PromptSource>(PROMPT_SOURCES, r.source, 'manual'),
    keyword: r.keyword,
    searchVolume: r.searchVolume,
    priority: oneOf<Priority>(PRIORITIES, r.priority, 'medium'),
    status: oneOf<PromptStatus>(PROMPT_STATUSES, r.status, 'CANDIDATE'),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

// ── Dataset loading ──────────────────────────────────────────────────────────

export interface LoadedDataset {
  ds: Dataset
  runs: RunLite[]
  promptRows: PromptRow[]
  /** false when the project has no profile */
  configured: boolean
}

interface LoadOpts { promptId?: string }

/**
 * Load the metrics dataset for one org+project inside the filters.
 * Only DONE responses count as measured answers. Mentions and citations are fetched per run and then
 * restricted to those responses, so the IN lists stay small.
 */
// ── Customer view ────────────────────────────────────────────────────────────
// A customer login (ctx.clientView) reads the same report as staff minus internal working data:
// draft and rejected prompts, staff notes and keyword research, costs, model ids, error text,
// failed attempts, the vendor library and the PBN list. The stripping happens here, on the server.

/** Prompts a customer may see: the ones staff put into monitoring (now or earlier). */
function promptScope(ctx: RadarCtx): { status?: { in: string[] } } {
  return ctx.clientView ? { status: { in: ['ACTIVE', 'INACTIVE'] } } : {}
}

/** Provider name without the collection-method wording, e.g. "ChatGPT" */
function cleanProviderLabel(key: ProviderKey): string {
  return PROVIDERS[key].label.replace(/\s*\(.*\)\s*$/, '')
}

function providerLabelOf(ctx: RadarCtx, key: ProviderKey): string {
  return ctx.clientView ? cleanProviderLabel(key) : PROVIDERS[key].label
}

/** Prompt without staff-only fields (note, source keyword, search volume, where it came from) */
function clientPrompt<T extends PromptDTO>(p: T): T {
  return { ...p, note: '', keyword: '', searchVolume: null, source: 'manual' }
}

function promptFor<T extends PromptDTO>(ctx: RadarCtx, p: T): T {
  return ctx.clientView ? clientPrompt(p) : p
}

/** Scan run without cost, error text or the name of the staff member who started it */
function clientRun(run: RunDTO): RunDTO {
  return { ...run, costUsd: 0, estimatedCostUsd: null, error: '', trigger: 'manual' }
}

function groupRows<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}

export async function loadDataset(ctx: RadarCtx, filters: RadarFilters, opts: LoadOpts = {}): Promise<LoadedDataset> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const range = parseDayRange(filters.from, filters.to)
  const where: Prisma.BrandRadarResponseWhereInput = { ...base, status: 'DONE' }
  if (range.gte || range.lte) where.collectedAt = { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) }
  if (filters.country && filters.country !== 'all') where.country = filters.country
  if (filters.language && filters.language !== 'all') where.language = filters.language
  if (filters.provider !== 'all') where.provider = filters.provider
  if (opts.promptId) where.promptId = opts.promptId

  const [profile, promptRows, comps, respRaw] = await Promise.all([
    prisma.brandRadarProfile.findFirst({ where: base, select: { brandName: true } }),
    prisma.brandRadarPrompt.findMany({ where: { ...base, ...promptScope(ctx) }, orderBy: { createdAt: 'desc' } }),
    prisma.brandRadarCompetitor.findMany({ where: { ...base, status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
    prisma.brandRadarResponse.findMany({
      where,
      select: {
        id: true, runId: true, promptId: true, provider: true, collectedAt: true, brandMentioned: true,
        brandOccurrences: true, brandRecommended: true, ownedCited: true, citationCount: true,
      },
    }),
  ])
  const promptIds = new Set(promptRows.map((p) => p.id))
  // Responses of a deleted prompt are not measurable by prompt; ignore them everywhere.
  const responses: RespRow[] = respRaw
    .filter((r) => promptIds.has(r.promptId) && isProviderKey(r.provider))
    .map((r) => ({ ...r, provider: r.provider as ProviderKey }))
  const respIds = new Set(responses.map((r) => r.id))
  const runIds = Array.from(new Set(responses.map((r) => r.runId)))

  let mentions: MentionRow[] = []
  let citations: CitationRow[] = []
  let runs: RunLite[] = []
  if (runIds.length > 0) {
    const sub = { ...base, runId: { in: runIds }, ...(opts.promptId ? { promptId: opts.promptId } : {}), ...(filters.provider !== 'all' ? { provider: filters.provider } : {}) }
    const [mRaw, cRaw, runRaw] = await Promise.all([
      prisma.brandRadarMention.findMany({
        where: sub,
        select: { responseId: true, runId: true, promptId: true, provider: true, entityType: true, entityKey: true, competitorId: true, entityName: true, occurrences: true, recommended: true, compared: true, position: true, positionPct: true },
      }),
      prisma.brandRadarCitation.findMany({
        where: sub,
        select: { responseId: true, runId: true, promptId: true, provider: true, url: true, normalizedUrl: true, domain: true, title: true, ownerType: true, competitorId: true, createdAt: true, position: true },
      }),
      prisma.brandRadarRun.findMany({ where: { ...base, id: { in: runIds } }, select: { id: true, startedAt: true, promptSetHash: true, providers: true } }),
    ])
    mentions = mRaw
      .filter((m) => respIds.has(m.responseId))
      .map((m) => ({ ...m, provider: m.provider as ProviderKey, entityType: m.entityType === 'competitor' ? 'competitor' as const : 'brand' as const }))
    citations = cRaw
      .filter((c) => respIds.has(c.responseId))
      .map((c) => ({ ...c, provider: c.provider as ProviderKey, ownerType: oneOf<CitationOwner>(['own', 'competitor', 'external'], c.ownerType, 'external') }))
    runs = runRaw
  }

  const prompts: PromptLite[] = promptRows.map((p) => ({
    id: p.id,
    text: p.text,
    topic: p.topic,
    intent: oneOf<PromptIntent>(PROMPT_INTENTS, p.intent, 'informational'),
    searchVolume: p.searchVolume,
    priority: oneOf<Priority>(PRIORITIES, p.priority, 'medium'),
  }))
  return {
    ds: { brandName: profile?.brandName ?? '', responses, mentions, citations, prompts, competitors: comps },
    runs,
    promptRows,
    configured: !!profile,
  }
}

// ── Vendor / own PBN flags ───────────────────────────────────────────────────

type VendorInfo = NonNullable<CitedDomainRow['vendor']>

export interface FlagSources { vendors: Map<string, VendorInfo>; pbn: Set<string> }

/** Flags for one request: a customer login never gets the org-wide vendor library or the PBN list. */
function flagsFor(ctx: RadarCtx): Promise<FlagSources> {
  if (ctx.clientView) return Promise.resolve({ vendors: new Map(), pbn: new Set() })
  return loadFlagSources(ctx.orgId)
}

/** Vendor library + own PBN host set for this org. Missing optional tables count as empty. */
export async function loadFlagSources(orgId: string): Promise<FlagSources> {
  const vendors = new Map<string, VendorInfo>()
  type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }
  const settle = <T,>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
  // Run all three together; errors are handled in the same order as the old sequential code.
  const [sitesR, detailsR, clientsR] = await Promise.all([
    settle(prisma.blmVendorSite.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      select: { id: true, domain: true, price: true, currency: true, domainRating: true, traffic: true, linkType: true, category: true },
    })),
    settle(prisma.blmVendorDetail.findMany({
      where: { organizationId: orgId },
      select: { vendorSiteId: true, priceBacklink: true },
    })),
    settle(prisma.uploadClient.findMany({
      where: { organizationId: orgId, pushPrefs: { contains: PBN_PREFS_MARK } },
      select: { pushPrefs: true },
    })),
  ])
  if (sitesR.ok) {
    let details: Array<{ vendorSiteId: string; priceBacklink: number | null }> = []
    if (detailsR.ok) details = detailsR.value
    else if (!isMissingTable(detailsR.error)) throw detailsR.error
    const detailBy = new Map(details.map((d) => [d.vendorSiteId, d]))
    for (const s of sitesR.value) {
      const key = normalizeDomain(s.domain) || s.domain.toLowerCase()
      if (vendors.has(key)) continue
      const d = detailBy.get(s.id)
      const price = s.price > 0 ? s.price : d?.priceBacklink != null && d.priceBacklink > 0 ? d.priceBacklink : null
      vendors.set(key, {
        price, currency: s.currency, domainRating: s.domainRating, traffic: s.traffic, linkType: s.linkType, category: s.category,
      })
    }
  } else if (!isMissingTable(sitesR.error)) {
    throw sitesR.error
  }

  const pbn = new Set<string>()
  if (!clientsR.ok) throw clientsR.error
  const clients = clientsR.value
  for (const c of clients) {
    let prefs: Record<string, unknown> = {}
    try { prefs = JSON.parse(c.pushPrefs || '{}') as Record<string, unknown> } catch { /* ignore broken JSON */ }
    for (const site of readPbnSites(prefs)) {
      const d = normalizeDomain(site.siteUrl || '') || hostOf(site.siteUrl || '')
      if (d) pbn.add(d)
    }
  }
  return { vendors, pbn }
}

export function applyFlags(rows: CitedDomainRow[], src: FlagSources): CitedDomainRow[] {
  return rows.map((r) => {
    const key = normalizeDomain(r.domain) || r.domain.toLowerCase()
    return { ...r, vendor: src.vendors.get(key) ?? null, isOwnPbn: src.pbn.has(key) }
  })
}

// ── Prompt rows (stats + sorting) ────────────────────────────────────────────

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

export const PROMPT_SORTS = ['recent', 'mention_rate_asc', 'mention_rate_desc', 'volume_desc', 'priority'] as const
export type PromptSort = (typeof PROMPT_SORTS)[number]

/** Compare numbers where null always sorts last, in both directions. */
function cmpNullLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * dir
}

/** Stable sort of prompt rows. A null mention rate (no responses) is never treated as 0. */
export function sortPromptRows(rows: PromptRowDTO[], sort: PromptSort): PromptRowDTO[] {
  const recent = (a: PromptRowDTO, b: PromptRowDTO) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
  const out = [...rows]
  out.sort((a, b) => {
    switch (sort) {
      case 'mention_rate_asc': return cmpNullLast(a.stats.mentionRate, b.stats.mentionRate, 1) || recent(a, b)
      case 'mention_rate_desc': return cmpNullLast(a.stats.mentionRate, b.stats.mentionRate, -1) || recent(a, b)
      case 'volume_desc': return cmpNullLast(a.searchVolume, b.searchVolume, -1) || recent(a, b)
      case 'priority': return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || recent(a, b)
      default: return recent(a, b)
    }
  })
  return out
}

const EMPTY_STATS: PromptStats = {
  responses: 0, brandMentions: 0, mentionRate: null, brandRecommended: 0, ownedCited: 0, citationRate: null, topCompetitor: null, lastCollectedAt: null,
}

function toRows(promptRows: PromptRow[], ds: Dataset, runs: RunLite[] = []): PromptRowDTO[] {
  const stats = promptStatsMap(ds)
  const changes = promptRunChangeDetails(ds, runs)
  return promptRows.map((p) => {
    const c = changes.get(p.id)
    return { ...toPromptDTO(p), stats: stats.get(p.id) ?? { ...EMPTY_STATS }, runChange: c?.change ?? null, ...(c ? { runChangeProviders: { gained: c.gained, lost: c.lost } } : {}) }
  })
}

export interface PromptListParams {
  status?: string; source?: string; intent?: string; topic?: string; q?: string; sort?: string; page?: number; pageSize?: number
}

function promptWhere(ctx: RadarCtx, p: PromptListParams, withStatus: boolean): Prisma.BrandRadarPromptWhereInput {
  const where: Prisma.BrandRadarPromptWhereInput = { organizationId: ctx.orgId, projectId: ctx.project.id }
  if (withStatus && p.status && (PROMPT_STATUSES as readonly string[]).includes(p.status)) where.status = p.status
  if (p.source && (PROMPT_SOURCES as readonly string[]).includes(p.source)) where.source = p.source
  if (p.intent && (PROMPT_INTENTS as readonly string[]).includes(p.intent)) where.intent = p.intent
  if (p.topic) where.topic = p.topic
  const q = (p.q ?? '').trim()
  if (q) where.OR = [{ text: { contains: q, mode: 'insensitive' } }, { keyword: { contains: q, mode: 'insensitive' } }]
  return where
}

/** All prompts matching the params with stats, sorted, not paged. Used by the list and the CSV export. */
export async function buildPromptRows(ctx: RadarCtx, filters: RadarFilters, p: PromptListParams): Promise<PromptRowDTO[]> {
  const [loaded, matching] = await Promise.all([
    loadDataset(ctx, filters),
    prisma.brandRadarPrompt.findMany({ where: promptWhere(ctx, p, true), select: { id: true } }),
  ])
  return assemblePromptRows(loaded, matching, p)
}

function assemblePromptRows(loaded: LoadedDataset, matching: Array<{ id: string }>, p: PromptListParams): PromptRowDTO[] {
  const ids = new Set(matching.map((m) => m.id))
  const rows = toRows(loaded.promptRows.filter((r) => ids.has(r.id)), loaded.ds, loaded.runs)
  return sortPromptRows(rows, oneOf<PromptSort>(PROMPT_SORTS, p.sort, 'recent'))
}

export async function buildPromptList(ctx: RadarCtx, filters: RadarFilters, p: PromptListParams): Promise<PromptListDTO> {
  const pageSize = Math.min(200, Math.max(1, Math.floor(p.pageSize ?? 25) || 25))
  const page = Math.max(1, Math.floor(p.page ?? 1) || 1)
  const [loaded, matching, grouped, topicRows] = await Promise.all([
    loadDataset(ctx, filters),
    prisma.brandRadarPrompt.findMany({ where: promptWhere(ctx, p, true), select: { id: true } }),
    prisma.brandRadarPrompt.groupBy({ by: ['status'], where: promptWhere(ctx, p, false), _count: { _all: true } }),
    prisma.brandRadarPrompt.findMany({
      where: { organizationId: ctx.orgId, projectId: ctx.project.id, NOT: { topic: '' } },
      select: { topic: true }, distinct: ['topic'], orderBy: { topic: 'asc' },
    }),
  ])
  const all = assemblePromptRows(loaded, matching, p)
  const counts: Record<PromptStatus, number> = { CANDIDATE: 0, ACTIVE: 0, INACTIVE: 0, REJECTED: 0 }
  for (const g of grouped) if ((PROMPT_STATUSES as readonly string[]).includes(g.status)) counts[g.status as PromptStatus] = g._count._all
  return {
    rows: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
    counts,
    topics: topicRows.map((t) => t.topic),
  }
}

// ── Response rows -> DTO (shared by prompt detail and the answer viewer) ──────

type ResponseRecord = Awaited<ReturnType<typeof prisma.brandRadarResponse.findMany>>[number]

function parseAliases(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
  } catch {
    return []
  }
}

// ── Insight rows (the AI's own search queries + sentiment) ───────────────────

type Base = { organizationId: string; projectId: string }

interface StoredInsight { responseId: string; searchQueries: string[]; foundSources: FoundSource[]; sentiment: AnswerSentiment | null }

/**
 * Insight rows by answer id or by scan. The tables come from a later SQL file, so a database that does not
 * have them yet answers "not available" and the rest of the report keeps working.
 */
async function loadInsights(base: Base, by: { responseIds: string[] } | { runIds: string[] }): Promise<{ available: boolean; rows: StoredInsight[] }> {
  const ids = 'responseIds' in by ? by.responseIds : by.runIds
  if (ids.length === 0) return { available: true, rows: [] }
  try {
    const rows = await prisma.brandRadarInsight.findMany({
      where: { ...base, ...('responseIds' in by ? { responseId: { in: ids } } : { runId: { in: ids } }) },
      select: { responseId: true, searchQueries: true, foundSources: true, sentiment: true },
    })
    return {
      available: true,
      rows: rows.map((r) => ({ responseId: r.responseId, searchQueries: parseStoredQueries(r.searchQueries), foundSources: parseStoredFoundSources(r.foundSources), sentiment: parseStoredSentiment(r.sentiment) })),
    }
  } catch (e) {
    if (isMissingTable(e)) return { available: false, rows: [] }
    throw e
  }
}

const EXTRA_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** Re-validate stored answer-extra JSON: bad JSON or bad entries never reach the UI. */
function parseStoredOtherEntities(raw: string): OtherEntity[] {
  try {
    const v: unknown = JSON.parse(raw || '[]')
    if (!Array.isArray(v)) return []
    const out: OtherEntity[] = []
    for (const e of v) {
      if (out.length >= 60) break
      if (!e || typeof e !== 'object') continue
      const o = e as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
      if (!name) continue
      const category = typeof o.category === 'string' ? o.category.trim().slice(0, 60) : ''
      const domain = typeof o.domain === 'string' && EXTRA_DOMAIN_RE.test(o.domain) ? o.domain : ''
      out.push({ name, category, domain })
    }
    return out
  } catch {
    return []
  }
}

/** Names the AI platform tagged per answer. Comes from a later SQL file: a missing table answers "nothing". */
async function loadAnswerExtras(base: Base, responseIds: string[]): Promise<Map<string, OtherEntity[]>> {
  const out = new Map<string, OtherEntity[]>()
  if (responseIds.length === 0) return out
  try {
    const rows = await prisma.brandRadarAnswerExtra.findMany({
      where: { ...base, responseId: { in: responseIds } },
      select: { responseId: true, entities: true },
    })
    for (const r of rows) out.set(r.responseId, parseStoredOtherEntities(r.entities))
    return out
  } catch (e) {
    if (isMissingTable(e)) return new Map()
    throw e
  }
}

/** normalized query -> group name */
async function loadQueryGroups(base: Base): Promise<Map<string, string>> {
  try {
    const rows = await prisma.brandRadarQueryGroup.findMany({ where: base, select: { queryKey: true, groupName: true } })
    return new Map(rows.map((r) => [r.queryKey, r.groupName]))
  } catch (e) {
    if (isMissingTable(e)) return new Map()
    throw e
  }
}

/** Search Query Groups + brand sentiment over every answer inside the filters */
async function buildInsight(base: Base, ds: Dataset): Promise<AnswerInsightDTO> {
  if (ds.responses.length === 0) return emptyInsight(true)
  const byId = new Map(ds.responses.map((r) => [r.id, r]))
  const [stored, groups] = await Promise.all([
    loadInsights(base, { runIds: Array.from(new Set(ds.responses.map((r) => r.runId))) }),
    loadQueryGroups(base),
  ])
  const rows: InsightRow[] = []
  for (const s of stored.rows) {
    const r = byId.get(s.responseId)
    if (!r) continue
    rows.push({
      responseId: r.id, promptId: r.promptId, runId: r.runId, provider: r.provider, at: r.collectedAt ? r.collectedAt.getTime() : 0,
      searchQueries: s.searchQueries, sentiment: s.sentiment,
    })
  }
  const entityNames = new Map<string, string>(ds.competitors.map((c) => [c.id, c.name]))
  if (ds.brandName) entityNames.set('brand', ds.brandName)
  const insight = aggregateInsight({
    available: stored.available, rows, groups,
    promptText: new Map(ds.prompts.map((p) => [p.id, p.text])),
    entityNames,
  })
  await Promise.all([fillFallbackQuotes(base, insight, rows, ds), fillFactorPassages(base, insight)])
  return insight
}

/**
 * "What the AI weighs" lists the newest answers counted under each factor. An answer listed there with no
 * passage from the analysis gets a line of its stored text that talks about the factor, else the opening of the answer.
 * One extra query, only for the answers the report lists.
 */
async function fillFactorPassages(base: Base, insight: AnswerInsightDTO): Promise<void> {
  const shown = insight.factors.slice(0, INSIGHT_LIMITS.factorsShown)
  const ids = new Set<string>()
  for (const f of shown) for (const x of f.examples ?? []) if (!x.quote) ids.add(x.responseId)
  if (ids.size === 0) return

  let texts: Map<string, string>
  try {
    const found = await prisma.brandRadarResponse.findMany({
      where: { ...base, id: { in: Array.from(ids) } },
      select: { id: true, responseText: true },
    })
    texts = new Map(found.map((x) => [x.id, x.responseText]))
  } catch {
    return
  }
  for (const f of shown) {
    for (const x of f.examples ?? []) {
      if (x.quote) continue
      const answer = texts.get(x.responseId) || ''
      const passage = factorPassage(answer, f.code)
      const text = passage ?? answerLead(answer)
      if (!text) continue
      x.quote = text
      x.quoteFrom = passage ? 'keyword' : 'lead'
    }
  }
}

/**
 * Old analyses stored no example passage. For the labels the brand card shows, take a passage from the stored
 * answer text instead (marked approximate unless the label itself appears in it). At most one extra query,
 * only for the few answers that are needed.
 */
async function fillFallbackQuotes(base: Base, insight: AnswerInsightDTO, rows: InsightRow[], ds: Dataset): Promise<void> {
  const brand = insight.entities.find((e) => e.entityType === 'brand')
  if (!brand) return
  const factors = brand.factors.slice(0, INSIGHT_LIMITS.factorsShown).filter((f) => !f.quotes?.length)
  const descriptors = brand.descriptors.filter((d) => !d.quotes?.length)
  if (factors.length === 0 && descriptors.length === 0) return

  const newestFirst = [...rows].filter((r) => r.sentiment).sort((a, b) => b.at - a.at)
  const brandOf = (r: InsightRow) => r.sentiment?.entities.find((e) => e.entityType === 'brand')
  const pick = (has: (e: NonNullable<ReturnType<typeof brandOf>>) => boolean): InsightRow[] => {
    const out: InsightRow[] = []
    for (const r of newestFirst) {
      const e = brandOf(r)
      if (e && has(e)) out.push(r)
      if (out.length >= 2) break
    }
    return out
  }
  const wanted = new Map<string, InsightRow>()
  const plan: Array<{ target: { quotes?: InsightQuote[] }; label?: string; rows: InsightRow[]; polarity?: (r: InsightRow) => FactorPolarity | undefined }> = []
  for (const f of factors) {
    const picked = pick((e) => e.factors.some((x) => x.code === f.code))
    plan.push({ target: f, rows: picked, polarity: (r) => brandOf(r)?.factors.find((x) => x.code === f.code)?.polarity })
  }
  for (const d of descriptors) plan.push({ target: d, label: d.text, rows: pick((e) => e.descriptors.includes(d.text)) })
  // Distinct answers, capped; plan order is the display order, so the top rows are served first.
  for (const p of plan) {
    p.rows = p.rows.filter((r) => wanted.has(r.responseId) || wanted.size < 30)
    for (const r of p.rows) wanted.set(r.responseId, r)
  }
  if (wanted.size === 0) return

  let texts: Map<string, string>
  try {
    const found = await prisma.brandRadarResponse.findMany({
      where: { ...base, id: { in: Array.from(wanted.keys()) } },
      select: { id: true, responseText: true },
    })
    texts = new Map(found.map((x) => [x.id, x.responseText]))
  } catch {
    return
  }
  const brandTerms = brandTermsOf(ds.brandName)
  for (const p of plan) {
    const quotes: InsightQuote[] = []
    for (const r of p.rows) {
      const q = fallbackQuote(texts.get(r.responseId) || '', { label: p.label, brandTerms })
      if (!q || quotes.some((x) => x.text === q.text)) continue
      quotes.push({ text: q.text, approx: q.approx, responseId: r.responseId, promptId: r.promptId, runId: r.runId, provider: r.provider, polarity: p.polarity?.(r) })
    }
    if (quotes.length) p.target.quotes = quotes
  }
}

/** Client view: drop sentiment entries about competitors that staff do not keep ACTIVE. Staff view (null set) is untouched. */
function maskSentiment(s: AnswerSentiment | null, activeComps: ReadonlySet<string> | null): AnswerSentiment | null {
  if (!s || activeComps === null) return s
  return { ...s, entities: (s.entities ?? []).filter((e) => e.entityType !== 'competitor' || activeComps.has(e.key)) }
}

async function toResponseDTOs(
  base: Base,
  rows: ResponseRecord[],
  flags: FlagSources,
  clientView = false,
  activeCompetitorIds?: ReadonlySet<string>,
): Promise<ResponseDTO[]> {
  const ids = rows.map((h) => h.id)
  // Customers only see competitors that staff keep ACTIVE for this project.
  // The domains are needed too: stored found sources carry an owner type but no competitor id.
  const compsPromise = clientView
    ? prisma.brandRadarCompetitor.findMany({ where: { ...base, status: 'ACTIVE' }, select: { id: true, domains: true } })
    : Promise.resolve(null)
  // Customers must never see a hidden competitor's name through "other names": exclude every project competitor, whatever its status.
  const knownNamesPromise = clientView
    ? Promise.all([
        prisma.brandRadarCompetitor.findMany({ where: base, select: { name: true, aliases: true } }),
        prisma.brandRadarProfile.findFirst({ where: base, select: { brandName: true, aliases: true } }),
      ])
    : Promise.resolve(null)
  const [[hm, hc, insights, extras], comps, knownNames] = await Promise.all([
    ids.length
      ? Promise.all([
          prisma.brandRadarMention.findMany({ where: { ...base, responseId: { in: ids } } }),
          prisma.brandRadarCitation.findMany({ where: { ...base, responseId: { in: ids } }, orderBy: { position: 'asc' } }),
          loadInsights(base, { responseIds: ids }),
          loadAnswerExtras(base, ids),
        ])
      : Promise.resolve<[Awaited<ReturnType<typeof prisma.brandRadarMention.findMany>>, Awaited<ReturnType<typeof prisma.brandRadarCitation.findMany>>, { available: boolean; rows: StoredInsight[] }, Map<string, OtherEntity[]>]>([[], [], { available: true, rows: [] }, new Map()]),
    compsPromise,
    knownNamesPromise,
  ])
  const insightOf = new Map(insights.rows.map((i) => [i.responseId, i]))
  const citesOf = groupRows(hc, (c) => c.responseId)
  let activeComps: ReadonlySet<string> | null = null
  if (clientView) activeComps = activeCompetitorIds ?? new Set((comps ?? []).map((c) => c.id))
  const activeCompDomains: string[] = []
  if (activeComps) for (const c of comps ?? []) if (activeComps.has(c.id)) activeCompDomains.push(...parseAliases(c.domains))
  const visible = activeComps
    ? hm.filter((m: (typeof hm)[number]) => m.entityType !== 'competitor' || activeComps!.has(m.competitorId || m.entityKey))
    : hm
  const mentionsOf = groupRows(visible, (m) => m.responseId)
  const allMentionsOf = groupRows(hm, (m) => m.responseId)
  const projectNames = new Set<string>()
  if (knownNames) {
    const [allComps, prof] = knownNames
    for (const c of allComps) {
      projectNames.add(c.name.trim().toLowerCase())
      for (const al of parseAliases(c.aliases)) projectNames.add(al.trim().toLowerCase())
    }
    if (prof) {
      projectNames.add(prof.brandName.trim().toLowerCase())
      for (const al of parseAliases(prof.aliases)) projectNames.add(al.trim().toLowerCase())
    }
  }
  return rows.map((h) => {
    const provider = (isProviderKey(h.provider) ? h.provider : 'openai') as ProviderKey
    const cites = citesOf.get(h.id) ?? []
    const rowMentions = allMentionsOf.get(h.id) ?? []
    // names we already track (brand, competitors, matched aliases) are not "other" names; hidden competitors count too
    const tracked = new Set<string>(projectNames)
    for (const m of rowMentions) {
      tracked.add(m.entityName.trim().toLowerCase())
      for (const al of parseAliases(m.matchedAliases)) tracked.add(al.trim().toLowerCase())
    }
    const otherEntities = (extras.get(h.id) ?? []).filter((e) => !tracked.has(e.name.trim().toLowerCase()))
    return {
      id: h.id, runId: h.runId, promptId: h.promptId, provider, providerLabel: clientView ? cleanProviderLabel(provider) : PROVIDERS[provider].label,
      model: clientView ? '' : h.model,
      collectionMethod: oneOf<CollectionMethod>(['api_simulated', 'observed_chat', 'observed_serp', 'imported'], h.collectionMethod, 'api_simulated'),
      status: oneOf<TaskStatus>(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED'], h.status, 'FAILED'),
      error: clientView ? '' : h.error, country: h.country, language: h.language, responseText: h.responseText,
      collectedAt: h.collectedAt ? h.collectedAt.toISOString() : null, costUsd: clientView ? null : h.costUsd,
      brandMentioned: h.brandMentioned, brandOccurrences: h.brandOccurrences, brandRecommended: h.brandRecommended, ownedCited: h.ownedCited,
      sampleIndex: h.sampleIndex,
      mentions: (mentionsOf.get(h.id) ?? []).map((m) => {
        const isComp = m.entityType === 'competitor'
        return {
          entityType: isComp ? 'competitor' as const : 'brand' as const,
          key: m.entityKey, name: m.entityName, occurrences: m.occurrences, recommended: m.recommended, compared: m.compared,
          position: m.position, positionPct: m.positionPct ?? null, snippet: m.snippet,
          aliases: parseAliases(m.matchedAliases),
          linked: isComp
            ? cites.some((c) => c.ownerType === 'competitor' && !!c.competitorId && c.competitorId === (m.competitorId || m.entityKey))
            : cites.some((c) => c.ownerType === 'own'),
        }
      }),
      citations: cites.map((c) => {
        const key = normalizeDomain(c.domain) || c.domain.toLowerCase()
        const owner = oneOf<CitationOwner>(['own', 'competitor', 'external'], c.ownerType, 'external')
        // Customers must not learn that a hidden competitor's site is tracked: show it as any other site.
        const hiddenComp = owner === 'competitor' && activeComps !== null && !activeComps.has(c.competitorId || '')
        return {
          url: c.url, domain: c.domain, title: c.title,
          ownerType: hiddenComp ? 'external' as const : owner, position: c.position,
          vendor: flags.vendors.get(key) ?? null, isOwnPbn: flags.pbn.has(key),
        }
      }),
      // Customers must not learn that a hidden competitor is tracked: its pages read as any other site,
      // and what the AI said about it is left out.
      foundSources: (insightOf.get(h.id)?.foundSources ?? []).map((f) =>
        activeComps !== null && f.ownerType === 'competitor' && !activeCompDomains.some((d) => domainMatches(f.domain, d))
          ? { ...f, ownerType: 'external' as const }
          : f),
      searchQueries: insightOf.get(h.id)?.searchQueries ?? [],
      sentiment: maskSentiment(insightOf.get(h.id)?.sentiment ?? null, activeComps),
      otherEntities,
    }
  })
}

// ── Prompt detail ────────────────────────────────────────────────────────────

const HISTORY_CAP = 50

export async function buildPromptDetail(ctx: RadarCtx, filters: RadarFilters, promptId: string, vendorOnly: boolean): Promise<PromptDetailDTO | null> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const row = await prisma.brandRadarPrompt.findFirst({ where: { ...base, id: promptId, ...promptScope(ctx) } })
  if (!row) return null
  // History: collected answers plus failed / skipped attempts for this prompt, newest first.
  const range = parseDayRange(filters.from, filters.to)
  const dateWhere = range.gte || range.lte ? { gte: range.gte, lte: range.lte } : undefined
  const hw: Prisma.BrandRadarResponseWhereInput = {
    ...base, promptId, status: ctx.clientView ? 'DONE' : { in: ['DONE', 'FAILED', 'SKIPPED'] },
    ...(dateWhere ? { createdAt: dateWhere } : {}),
    ...(filters.country !== 'all' ? { country: filters.country } : {}),
    ...(filters.language !== 'all' ? { language: filters.language } : {}),
    ...(filters.provider !== 'all' ? { provider: filters.provider } : {}),
  }
  const [loaded, flags, hist] = await Promise.all([
    loadDataset(ctx, filters, { promptId }),
    flagsFor(ctx),
    prisma.brandRadarResponse.findMany({ where: hw, orderBy: { createdAt: 'desc' }, take: HISTORY_CAP }),
  ])
  const { ds, runs } = loaded

  const byProv: PromptDetailDTO['byProvider'] = []
  for (const key of PROVIDER_KEYS) {
    const rs = ds.responses.filter((r) => r.provider === key)
    if (rs.length === 0) continue
    const brand = rs.filter((r) => r.brandMentioned === true).length
    byProv.push({
      provider: key, label: providerLabelOf(ctx, key), responses: rs.length, brandMentions: brand,
      mentionRate: rs.length > 0 ? brand / rs.length : null,
      brandRecommended: rs.filter((r) => r.brandRecommended === true).length,
      ownedCited: rs.filter((r) => r.ownedCited === true).length,
    })
  }

  let cited = applyFlags(citedDomains(ds), flags)
  if (vendorOnly && !ctx.clientView) cited = cited.filter((d) => d.vendor !== null || d.isOwnPbn)

  const history = await toResponseDTOs(base, hist, flags, !!ctx.clientView, new Set(ds.competitors.map((c) => c.id)))

  return {
    prompt: promptFor(ctx, toPromptDTO(row)),
    responses: ds.responses.length,
    entities: entityShares(ds),
    byProvider: byProv,
    trend: promptEntityTrend(ds, runs),
    citedDomains: cited,
    history,
  }
}

// ── Answer feed (result-first report) ────────────────────────────────────────

export interface AnswerFeedOpts { mention?: AnswerMentionFilter; q?: string; page?: number; pageSize?: number }

const FEED_PAGE_DEFAULT = 10
const FEED_PAGE_MAX = 50

/**
 * Every question x AI platform inside the filters: how often the brand and the tracked competitors were named,
 * split by kind (name + link, name only, link only, neither), plus one real answer per group.
 * Totals use the same dataset as the Overview, so the numbers agree. Only the answers on the page are loaded in full.
 */
/** A stored website value as a bare hostname; '' when it is not a plain hostname. */
function cleanDomain(raw: string): string {
  const d = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/:\d+$/, '')
  return EXTRA_DOMAIN_RE.test(d) ? d : ''
}

/**
 * Entity key -> website domain for the logos of the Overview competitor table:
 * 'brand' = the profile's main site, competitor id = its first domain. Logos are decoration, so any failure gives no logos.
 */
async function feedEntityDomains(base: { organizationId: string; projectId: string }, competitorIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const [profile, comps] = await Promise.all([
      prisma.brandRadarProfile.findFirst({ where: base, select: { primaryDomain: true } }),
      competitorIds.length > 0
        ? prisma.brandRadarCompetitor.findMany({ where: { ...base, id: { in: competitorIds } }, select: { id: true, domains: true } })
        : Promise.resolve([]),
    ])
    const own = cleanDomain(profile?.primaryDomain ?? '')
    if (own) out.brand = own
    for (const c of comps) {
      const d = cleanDomain(parseStrings(c.domains)[0] ?? '')
      if (d) out[c.id] = d
    }
  } catch {
    return {}
  }
  return out
}

export async function buildAnswerFeed(ctx: RadarCtx, filters: RadarFilters, opts: AnswerFeedOpts = {}): Promise<AnswerFeedDTO> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const { ds, runs, configured } = await loadDataset(ctx, filters)
  const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null)
  const isTrue = (v: boolean | null): boolean => v === true

  const kindOf = (r: RespRow): AnswerKind => answerKind(r.brandMentioned, r.ownedCited)
  const countKinds = (rs: RespRow[]): AnswerKindCounts => {
    const out: AnswerKindCounts = { both: 0, mention_only: 0, citation_only: 0, none: 0 }
    for (const r of rs) out[kindOf(r)]++
    return out
  }
  const KIND_RANK: Record<AnswerKind, number> = { both: 0, mention_only: 1, citation_only: 2, none: 3 }

  const asked = ds.responses.length
  const mentioned = ds.responses.filter((r) => isTrue(r.brandMentioned)).length
  const cited = ds.responses.filter((r) => isTrue(r.ownedCited)).length
  const totalKinds = countKinds(ds.responses)
  const byProv: AnswerFeedDTO['byProvider'] = []
  for (const key of PROVIDER_KEYS) {
    const rs = ds.responses.filter((r) => r.provider === key)
    if (rs.length === 0) continue
    const m = rs.filter((r) => isTrue(r.brandMentioned)).length
    byProv.push({
      provider: key, label: providerLabelOf(ctx, key), asked: rs.length, mentioned: m, mentionRate: rate(m, rs.length),
      ownedCited: rs.filter((r) => isTrue(r.ownedCited)).length, kinds: countKinds(rs),
    })
  }

  // Tracked competitors named per answer.
  const compName = new Map(ds.competitors.map((c) => [c.id, c.name]))
  const compsByResp = new Map<string, Map<string, string>>()
  for (const m of ds.mentions) {
    if (m.entityType !== 'competitor') continue
    const key = m.competitorId || m.entityKey
    // A customer login only sees competitors that are still tracked; the stored name of a removed one stays hidden.
    if (ctx.clientView && !compName.has(key)) continue
    let set = compsByResp.get(m.responseId)
    if (!set) { set = new Map(); compsByResp.set(m.responseId, set) }
    set.set(key, compName.get(key) ?? m.entityName)
  }

  // How the brand is brought up: one brand row per answer that names it.
  const brandRows: BrandMentionLite[] = ds.mentions
    .filter((m) => m.entityType === 'brand')
    .map((m) => ({ responseId: m.responseId, recommended: m.recommended, compared: m.compared, position: m.position, positionPct: m.positionPct }))
  const brandByResp = new Map(brandRows.map((m) => [m.responseId, m]))
  const styleOf = (rs: RespRow[]) => mentionStyleOf(rs.flatMap((r) => brandByResp.get(r.id) ?? []))
  const occurrencesOf = (rs: RespRow[]): number => rs.reduce((sum, r) => sum + (r.brandOccurrences || 0), 0)

  const promptById = new Map(ds.prompts.map((p) => [p.id, p]))
  const time = (r: RespRow): number => (r.collectedAt ? r.collectedAt.getTime() : 0)
  const groupMap = new Map<string, RespRow[]>()
  for (const r of ds.responses) {
    const k = `${r.promptId}|${r.provider}`
    const list = groupMap.get(k)
    if (list) list.push(r)
    else groupMap.set(k, [r])
  }

  const mention: AnswerMentionFilter = opts.mention ?? 'all'
  interface Group { item: Omit<AnswerFeedItem, 'answer'>; repId: string; last: number; best: number }
  let groups: Group[] = []
  groupMap.forEach((rows) => {
    const first = rows[0]
    const prompt = promptById.get(first.promptId)
    if (!prompt) return
    const sorted = [...rows].sort((a, b) => time(b) - time(a))
    // Filtering on a kind shows an answer of that kind; otherwise the best kind present, newest first.
    const wanted = mention === 'both' || mention === 'mention_only' || mention === 'citation_only' ? mention : null
    const byRank = [...sorted].sort((a, b) => KIND_RANK[kindOf(a)] - KIND_RANK[kindOf(b)])
    const rep = (wanted ? sorted.find((r) => kindOf(r) === wanted) : undefined) ?? byRank[0]
    const m = rows.filter((r) => isTrue(r.brandMentioned)).length
    const comps = new Map<string, { key: string; name: string; answers: number }>()
    let competitorAnswers = 0
    for (const r of rows) {
      const named = compsByResp.get(r.id)
      if (!named || named.size === 0) continue
      competitorAnswers++
      named.forEach((name, key) => {
        const cur = comps.get(key)
        if (cur) cur.answers++
        else comps.set(key, { key, name, answers: 1 })
      })
    }
    const last = time(sorted[0])
    groups.push({
      repId: rep.id,
      last,
      best: KIND_RANK[kindOf(byRank[0])],
      item: {
        promptId: first.promptId, promptText: prompt.text, topic: prompt.topic,
        provider: first.provider, providerLabel: providerLabelOf(ctx, first.provider),
        asked: rows.length, mentioned: m, mentionRate: rate(m, rows.length),
        recommended: rows.filter((r) => isTrue(r.brandRecommended)).length,
        ownedCited: rows.filter((r) => isTrue(r.ownedCited)).length,
        kinds: countKinds(rows),
        occurrences: occurrencesOf(rows),
        mentionStyle: styleOf(rows),
        competitorAnswers,
        competitors: Array.from(comps.values()).sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name)),
        lastCollectedAt: last > 0 ? new Date(last).toISOString() : null,
      },
    })
  })

  const q = (opts.q ?? '').trim().toLowerCase()
  if (q) groups = groups.filter((g) => g.item.promptText.toLowerCase().includes(q))
  const absent = (g: Group): boolean => g.item.kinds.none === g.item.asked
  const match: Record<AnswerMentionFilter, (g: Group) => boolean> = {
    all: () => true,
    both: (g) => g.item.kinds.both > 0,
    mention_only: (g) => g.item.kinds.mention_only > 0,
    citation_only: (g) => g.item.kinds.citation_only > 0,
    none: absent,
    competitor_only: (g) => absent(g) && g.item.competitorAnswers > 0,
  }
  const counts = Object.fromEntries(
    ANSWER_MENTION_FILTERS.map((f) => [f, groups.filter(match[f]).length]),
  ) as AnswerFeedDTO['counts']
  const shown = groups
    .filter(match[mention])
    .sort((a, b) => a.best - b.best || b.last - a.last || a.item.promptText.localeCompare(b.item.promptText))

  const pageSize = Math.min(FEED_PAGE_MAX, Math.max(1, Math.floor(opts.pageSize ?? FEED_PAGE_DEFAULT) || FEED_PAGE_DEFAULT))
  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const page = Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1) || 1))
  const slice = shown.slice((page - 1) * pageSize, page * pageSize)

  // Insight reads only the dataset, so it loads while the page of answers does
  const insightJob = buildInsight(base, ds)
  // Observed here so a failure in the answer load below cannot leave this rejection unhandled; awaited further down
  insightJob.catch(() => {})
  // Never rejects; runs beside the answer load
  const domainsJob = feedEntityDomains(base, ds.competitors.map((c) => c.id))

  let answers = new Map<string, ResponseDTO>()
  if (slice.length > 0) {
    const [rows, flags] = await Promise.all([
      prisma.brandRadarResponse.findMany({ where: { ...base, id: { in: slice.map((g) => g.repId) } } }),
      flagsFor(ctx),
    ])
    answers = new Map((await toResponseDTOs(base, rows, flags, !!ctx.clientView, new Set(ds.competitors.map((c) => c.id)))).map((a) => [a.id, a]))
  }

  const promptsAsked = new Set(ds.responses.map((r) => r.promptId))
  const promptsMentioned = new Set(ds.responses.filter((r) => isTrue(r.brandMentioned)).map((r) => r.promptId))
  const entities = entityShares(ds)
  const daily = dailyTrend(ds, entities)
  // Grades + month comparison. A failure here must not take the whole report down: the section is simply left out.
  const scorecardJob = buildScorecard(base, entities, ds.responses.length, !!ctx.clientView).catch(() => undefined)
  const insight = await insightJob
  const entityDomains = await domainsJob
  const scorecard = await scorecardJob
  return {
    configured,
    hasData: asked > 0,
    brandName: ds.brandName,
    totals: {
      asked, mentioned, mentionRate: rate(mentioned, asked),
      recommended: ds.responses.filter((r) => isTrue(r.brandRecommended)).length,
      ownedCited: cited, citationRate: rate(cited, asked),
      appeared: asked - totalKinds.none, appearRate: rate(asked - totalKinds.none, asked),
      kinds: totalKinds,
      occurrences: occurrencesOf(ds.responses),
      mentionStyle: mentionStyleOf(brandRows),
      avgPosition: entities.find((e) => e.entityType === 'brand')?.avgPosition ?? null,
      avgPositionPct: entities.find((e) => e.entityType === 'brand')?.avgPositionPct ?? null,
      change: daily.change,
      prompts: promptsAsked.size, promptsMentioned: promptsMentioned.size,
    },
    entities,
    entityChange: daily.entityChange,
    byProvider: byProv,
    trend: daily.trend,
    sources: citedDomains(ds).slice(0, INSIGHT_LIMITS.sources).map((d) => ({
      domain: d.domain, ownerType: d.ownerType, competitorName: d.competitorName,
      answers: d.responses, rate: rate(d.responses, asked),
    })),
    entityDomains,
    insight,
    scans: scanProgress(ds, runs),
    scorecard,
    counts,
    items: slice.map((g) => ({ ...g.item, answer: answers.get(g.repId) ?? null })),
    page, pageSize, total: shown.length,
  }
}

// ── Full-answer viewer ───────────────────────────────────────────────────────

const VIEWER_RUN_CAP = 30

/**
 * One prompt, one run, one AI platform: every repeat ask with its full text, highlighted names and cited pages.
 * runId / provider default to the newest run and the first platform with answers (the provider filter wins when set).
 * Country, language and date filters apply; the provider filter only picks the default platform.
 */
export async function buildResponseViewer(
  ctx: RadarCtx,
  filters: RadarFilters,
  promptId: string,
  wantRunId: string | null,
  wantProvider: string | null,
): Promise<ResponseViewerDTO | null> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const [row, profile] = await Promise.all([
    prisma.brandRadarPrompt.findFirst({ where: { ...base, id: promptId, ...promptScope(ctx) } }),
    prisma.brandRadarProfile.findFirst({ where: base, select: { brandName: true, primaryDomain: true } }),
  ])
  if (!row) return null

  const range = parseDayRange(filters.from, filters.to)
  const dateWhere = range.gte || range.lte ? { gte: range.gte, lte: range.lte } : undefined
  const where: Prisma.BrandRadarResponseWhereInput = {
    ...base, promptId, status: ctx.clientView ? 'DONE' : { in: ['DONE', 'FAILED', 'SKIPPED'] },
    ...(dateWhere ? { createdAt: dateWhere } : {}),
    ...(filters.country !== 'all' ? { country: filters.country } : {}),
    ...(filters.language !== 'all' ? { language: filters.language } : {}),
  }

  const groups = await prisma.brandRadarResponse.groupBy({
    by: ['runId', 'provider'], where, _count: { _all: true }, _max: { createdAt: true },
  })
  const runMap = new Map<string, { runId: string; last: number; providers: Set<ProviderKey>; responses: number }>()
  for (const g of groups) {
    if (!isProviderKey(g.provider)) continue
    const cur = runMap.get(g.runId) ?? { runId: g.runId, last: 0, providers: new Set<ProviderKey>(), responses: 0 }
    cur.providers.add(g.provider)
    cur.responses += g._count._all
    cur.last = Math.max(cur.last, g._max.createdAt ? g._max.createdAt.getTime() : 0)
    runMap.set(g.runId, cur)
  }
  const runIdsAll = Array.from(runMap.keys())
  const runRows = runIdsAll.length
    ? await prisma.brandRadarRun.findMany({ where: { ...base, id: { in: runIdsAll } }, select: { id: true, startedAt: true } })
    : []
  const startedBy = new Map(runRows.map((r) => [r.id, r.startedAt.getTime()]))
  const runs = Array.from(runMap.values())
    .map((r) => ({ ...r, at: startedBy.get(r.runId) ?? r.last }))
    .sort((a, b) => b.at - a.at)
    .slice(0, VIEWER_RUN_CAP)

  const shell: ResponseViewerDTO = {
    prompt: { id: row.id, text: row.text, country: row.country, language: row.language, topic: row.topic },
    brandName: profile?.brandName ?? '',
    runs: runs.map((r) => ({
      runId: r.runId, date: new Date(r.at).toISOString(),
      providers: PROVIDER_KEYS.filter((k) => r.providers.has(k)), responses: r.responses,
    })),
    runId: null, providers: [], provider: null, samples: [],
    summary: { asked: 0, brandMentioned: 0, brandRecommended: 0, ownedCited: 0, entities: [], domains: [] },
  }
  if (runs.length === 0) return shell

  const run = (wantRunId && runs.find((r) => r.runId === wantRunId)) || runs[0]
  const [doneByProv, flags] = await Promise.all([
    prisma.brandRadarResponse.groupBy({
      by: ['provider', 'brandMentioned'], where: { ...where, runId: run.runId, status: 'DONE' }, _count: { _all: true },
    }),
    flagsFor(ctx),
  ])
  const providers: ResponseViewerDTO['providers'] = []
  for (const key of PROVIDER_KEYS) {
    if (!run.providers.has(key)) continue
    const gs = doneByProv.filter((g) => g.provider === key)
    providers.push({
      provider: key, label: providerLabelOf(ctx, key), method: PROVIDERS[key].method,
      responses: gs.reduce((n, g) => n + g._count._all, 0),
      brandMentions: gs.filter((g) => g.brandMentioned === true).reduce((n, g) => n + g._count._all, 0),
    })
  }
  const pick = (k: string | null) => (k ? providers.find((p) => p.provider === k) : undefined)
  const filterProv = filters.provider !== 'all' ? filters.provider : null
  const chosen = pick(wantProvider) || pick(filterProv) || providers.find((p) => p.responses > 0) || providers[0]
  if (!chosen) return { ...shell, runId: run.runId }

  const rows = await prisma.brandRadarResponse.findMany({
    where: { ...where, runId: run.runId, provider: chosen.provider },
    orderBy: [{ sampleIndex: 'asc' }, { createdAt: 'asc' }],
  })
  const samples = await toResponseDTOs(base, rows, flags, !!ctx.clientView)
  const done = samples.filter((r) => r.status === 'DONE')

  const ent = new Map<string, ResponseViewerDTO['summary']['entities'][number] & { posSum: number; posN: number; pctSum: number; pctN: number }>()
  const dom = new Map<string, ResponseViewerDTO['summary']['domains'][number]>()
  for (const r of done) {
    for (const m of r.mentions) {
      const cur = ent.get(m.key) ?? { key: m.key, name: m.name, entityType: m.entityType, answers: 0, recommended: 0, avgPosition: null, avgPositionPct: null, zones: { early: 0, middle: 0, late: 0 }, posSum: 0, posN: 0, pctSum: 0, pctN: 0 }
      cur.answers += 1
      if (m.recommended) cur.recommended += 1
      if (m.position !== null) { cur.posSum += m.position; cur.posN += 1 }
      if (m.positionPct !== null && m.positionPct !== undefined && Number.isFinite(m.positionPct)) {
        cur.pctSum += m.positionPct; cur.pctN += 1
        const zone = answerZone(m.positionPct)
        if (zone) cur.zones![zone] += 1
      }
      ent.set(m.key, cur)
    }
    const seen = new Set<string>()
    for (const c of r.citations) {
      const key = normalizeDomain(c.domain) || c.domain.toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      const cur = dom.get(key) ?? { domain: key, ownerType: c.ownerType, answers: 0, vendor: c.vendor, isOwnPbn: c.isOwnPbn }
      cur.answers += 1
      dom.set(key, cur)
    }
  }
  // mention key -> website domain (logos): brand = profile domain, competitor = its first domain
  const entityDomains: Record<string, string> = {}
  const compKeys = Array.from(ent.values()).filter((e) => e.entityType === 'competitor').map((e) => e.key)
  if (ent.has('brand') && profile?.primaryDomain) {
    const d = cleanDomain(profile.primaryDomain)
    if (d) entityDomains.brand = d
  }
  if (compKeys.length > 0) {
    const comps = await prisma.brandRadarCompetitor.findMany({ where: { ...base, id: { in: compKeys } }, select: { id: true, domains: true } })
    for (const c of comps) {
      const d = cleanDomain(parseStrings(c.domains)[0] ?? '')
      if (d) entityDomains[c.id] = d
    }
  }
  const entities = Array.from(ent.values())
    .map(({ posSum, posN, pctSum, pctN, ...e }) => ({ ...e, avgPosition: posN > 0 ? posSum / posN : null, avgPositionPct: pctN > 0 ? pctSum / pctN : null }))
    .sort((a, b) => (a.entityType === 'brand' ? -1 : b.entityType === 'brand' ? 1 : b.answers - a.answers))
  const domains = Array.from(dom.values()).sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain))

  return {
    ...shell,
    runId: run.runId,
    providers,
    provider: chosen.provider,
    samples,
    entityDomains,
    summary: {
      asked: done.length,
      brandMentioned: done.filter((r) => r.brandMentioned === true).length,
      brandRecommended: done.filter((r) => r.brandRecommended === true).length,
      ownedCited: done.filter((r) => r.ownedCited === true).length,
      entities,
      domains,
    },
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────

function emptyOverview(configured: boolean, ds: Dataset, monitoring: number): OverviewDTO {
  return {
    configured, hasData: false, kpis: computeKpis(ds, monitoring),
    byProvider: [], byIntent: [], heat: { rows: [], columns: [], values: [] },
    topPrompts: [], weakPrompts: [], activeRun: null, lastRun: null,
  }
}

export async function buildOverview(ctx: RadarCtx, filters: RadarFilters): Promise<OverviewDTO> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const client = !!ctx.clientView
  // None of these depends on another, so they load together
  const activeP = prisma.brandRadarRun.findFirst({ where: { ...base, status: 'RUNNING' }, orderBy: { startedAt: 'desc' } })
  const lastP = prisma.brandRadarRun.findFirst({ where: base, orderBy: { startedAt: 'desc' } })
  // Starter names resolve as soon as both run rows are in; a failure is only raised where the names are used.
  const namesP: Promise<{ names: Map<string, string> } | { error: unknown }> = client
    ? Promise.resolve({ names: new Map<string, string>() })
    : Promise.all([activeP, lastP]).then(
        ([a, l]) => userNames([a?.createdById, l?.createdById]).then((names) => ({ names }), (error: unknown) => ({ error })),
        (error: unknown) => ({ error }),
      )
  const [loaded, activeRaw, lastRaw, namesR] = await Promise.all([
    loadDataset(ctx, filters),
    activeP,
    lastP,
    namesP,
  ])
  const { ds, promptRows } = loaded
  const monitoring = promptRows.filter((p) => p.status === 'ACTIVE').length
  if (!loaded.configured) return emptyOverview(false, ds, monitoring)

  if ('error' in namesR) throw namesR.error
  const names = namesR.names
  const runDTO = (run: NonNullable<typeof lastRaw>): RunDTO => {
    const dto = toRunDTO(run, names.get(run.createdById) ?? '')
    return client ? clientRun(dto) : dto
  }
  const activeRun = activeRaw ? runDTO(activeRaw) : null
  const lastRun = lastRaw ? runDTO(lastRaw) : null

  const kpis = computeKpis(ds, monitoring)
  const rows = toRows(promptRows, ds).filter((r) => r.stats.responses >= 1 && r.stats.mentionRate !== null)
  // Sorted on the full rows first, staff-only fields removed after
  const best = sortPromptRows(rows, 'mention_rate_desc').slice(0, 5).map((r) => promptFor(ctx, r))
  const worst = sortPromptRows(rows, 'mention_rate_asc').slice(0, 5).map((r) => promptFor(ctx, r))

  return {
    configured: true,
    hasData: ds.responses.length > 0,
    kpis,
    byProvider: client ? byProvider(ds).map((r) => ({ ...r, label: cleanProviderLabel(r.provider) })) : byProvider(ds),
    byIntent: byIntent(ds),
    heat: topicProviderHeat(ds),
    topPrompts: best,
    weakPrompts: worst,
    activeRun,
    lastRun,
  }
}

// ── Competitor insights ──────────────────────────────────────────────────────

const EXTRAS_CHUNK = 5000

/**
 * Brands the AI platforms tagged in these answers that the project does not track.
 * Staff only. Every project competitor counts as tracked whatever its status, so a paused one is not suggested again.
 */
async function loadUntrackedBrands(base: Base, ds: Dataset): Promise<UntrackedBrandsDTO> {
  const ids = ds.responses.map((r) => r.id)
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += EXTRAS_CHUNK) chunks.push(ids.slice(i, i + EXTRAS_CHUNK))
  const [parts, profile, comps] = await Promise.all([
    Promise.all(chunks.map((c) => loadAnswerExtras(base, c))),
    prisma.brandRadarProfile.findFirst({ where: base, select: { brandName: true, aliases: true, primaryDomain: true, ownedDomains: true } }),
    prisma.brandRadarCompetitor.findMany({ where: base, select: { name: true, aliases: true, domains: true } }),
  ])
  const extras = new Map<string, OtherEntity[]>()
  for (const part of parts) part.forEach((v, k) => extras.set(k, v))
  const trackedNames = [ds.brandName, profile?.brandName ?? '', ...parseAliases(profile?.aliases ?? '[]')]
  const trackedDomains = [profile?.primaryDomain ?? '', ...parseStrings(profile?.ownedDomains)]
  for (const c of comps) {
    trackedNames.push(c.name, ...parseAliases(c.aliases))
    trackedDomains.push(...parseStrings(c.domains))
  }
  return computeUntrackedBrands({
    extras,
    responses: ds.responses.map((r) => ({ id: r.id, promptId: r.promptId, provider: r.provider })),
    prompts: ds.prompts.map((p) => ({ id: p.id, text: p.text })),
    trackedNames,
    trackedDomains,
  })
}

export async function buildCompetitorInsights(ctx: RadarCtx, filters: RadarFilters): Promise<CompetitorInsightsDTO> {
  const { ds, runs } = await loadDataset(ctx, filters)
  // Never sent to a client login. A failure leaves the section out instead of failing the tab.
  const untracked = ctx.clientView
    ? undefined
    : await loadUntrackedBrands({ organizationId: ctx.orgId, projectId: ctx.project.id }, ds).catch(() => undefined)
  return {
    untracked,
    responses: ds.responses.length,
    entities: entityShares(ds),
    trend: competitorTrend(ds, runs),
    headToHead: headToHead(ds),
    byTopic: competitorByTopic(ds),
    domains: competitorDomains(ds),
    mentionSplit: mentionSplit(ds),
  }
}

// ── Citations ────────────────────────────────────────────────────────────────

/**
 * Citations of the previous period of equal length (same country / language / platform filters and same prompt scope).
 * null when the filter has no bounded date range. Two queries (answers, then their citations), both scoped to org + project.
 */
async function loadPreviousCitations(ctx: RadarCtx, filters: RadarFilters, promptIds: ReadonlySet<string>): Promise<{ range: { from: string; to: string }; citations: CitationRow[] } | null> {
  if (!filters.from || !filters.to) return null
  const prev = previousRange(filters.from, filters.to)
  if (!prev) return null
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  if (promptIds.size === 0) return { range: prev, citations: [] }
  const range = parseDayRange(prev.from, prev.to)
  const where: Prisma.BrandRadarResponseWhereInput = { ...base, status: 'DONE', promptId: { in: Array.from(promptIds) } }
  if (range.gte || range.lte) where.collectedAt = { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) }
  if (filters.country && filters.country !== 'all') where.country = filters.country
  if (filters.language && filters.language !== 'all') where.language = filters.language
  if (filters.provider !== 'all') where.provider = filters.provider
  const respRaw = await prisma.brandRadarResponse.findMany({ where, select: { id: true, runId: true, promptId: true } })
  const resp = respRaw.filter((r) => promptIds.has(r.promptId))
  if (resp.length === 0) return { range: prev, citations: [] }
  const respIds = new Set(resp.map((r) => r.id))
  const runIds = Array.from(new Set(resp.map((r) => r.runId)))
  const cRaw = await prisma.brandRadarCitation.findMany({
    where: { ...base, runId: { in: runIds }, ...(filters.provider !== 'all' ? { provider: filters.provider } : {}) },
    select: { responseId: true, runId: true, promptId: true, provider: true, url: true, normalizedUrl: true, domain: true, title: true, ownerType: true, competitorId: true, createdAt: true },
  })
  const citations: CitationRow[] = cRaw
    .filter((c) => respIds.has(c.responseId))
    .map((c) => ({ ...c, provider: c.provider as ProviderKey, ownerType: oneOf<CitationOwner>(['own', 'competitor', 'external'], c.ownerType, 'external') }))
  return { range: prev, citations }
}

export interface CitationParams { view?: string; q?: string; competitorId?: string; page?: number; pageSize?: number; vendorOnly?: boolean }

export async function buildCitations(ctx: RadarCtx, filters: RadarFilters, p: CitationParams): Promise<CitationsDTO> {
  const view = oneOf<CitationView>(['own', 'competitor', 'external', 'gap'], p.view, 'external')
  const pageSize = Math.min(1000, Math.max(1, Math.floor(p.pageSize ?? 50) || 50))
  const page = Math.max(1, Math.floor(p.page ?? 1) || 1)
  const [{ ds, promptRows }, flags] = await Promise.all([loadDataset(ctx, filters), flagsFor(ctx)])
  const prev = await loadPreviousCitations(ctx, filters, new Set(promptRows.map((r) => r.id)))

  const all = applyFlags(citedDomains(ds), flags)
  const gap = applyFlags(citationGapDomains(ds), flags)
  const q = (p.q ?? '').trim().toLowerCase()
  const refine = (rows: CitedDomainRow[]): CitedDomainRow[] => rows.filter((r) => {
    if (p.competitorId && r.competitorId !== p.competitorId) return false
    if (p.vendorOnly && !ctx.clientView && r.vendor === null && !r.isOwnPbn) return false
    if (q && !r.domain.toLowerCase().includes(q) && !r.urls.some((u) => u.url.toLowerCase().includes(q) || u.title.toLowerCase().includes(q))) return false
    return true
  })
  const source = view === 'gap' ? gap : all.filter((r) => r.ownerType === view)
  const rows = refine(source)

  const withCitations = new Set(ds.citations.map((c) => c.responseId))

  // New / lost versus the previous period; nothing is claimed when there is no previous data to compare with.
  const domainDiff = diffPeriods(all.map((r) => r.domain), prev ? prev.citations.map((c) => c.domain) : null)
  const pageDiff = diffPeriods(ds.citations.map((c) => c.normalizedUrl || c.url), prev ? prev.citations.map((c) => c.normalizedUrl || c.url) : null)
  const keyOfUrl = new Map(ds.citations.map((c) => [c.url, c.normalizedUrl || c.url]))
  const pages = citedPages(ds, 50, new Set(rows.map((r) => r.domain))).map((pg) => ({ ...pg, isNew: pageDiff.available && pageDiff.added.has(keyOfUrl.get(pg.url) ?? pg.url) }))
  const lostSet = new Set(domainDiff.lost)
  // Lost list follows the table's owner-type view, competitor and search filters (the vendor filter is not applicable here).
  const lostDomains = prev && domainDiff.available
    ? citedDomains({ ...ds, citations: prev.citations.filter((c) => lostSet.has(c.domain)) })
        .filter((r) => (view === 'gap' || r.ownerType === view)
          && (!p.competitorId || r.competitorId === p.competitorId)
          && (!q || r.domain.toLowerCase().includes(q) || r.urls.some((u) => u.url.toLowerCase().includes(q) || u.title.toLowerCase().includes(q))))
        .slice(0, 20)
        .map((r) => ({ domain: r.domain, ownerType: r.ownerType, competitorName: r.competitorName, answers: r.responses }))
    : []
  const comparison: CitationComparison = {
    available: domainDiff.available,
    previousFrom: prev?.range.from ?? '',
    previousTo: prev?.range.to ?? '',
    newDomainCount: domainDiff.added.size,
    newDomains: Array.from(domainDiff.added).slice(0, 1000),
    lostDomains,
  }
  return {
    pages,
    comparison,
    view,
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    totals: {
      own: all.filter((r) => r.ownerType === 'own').length,
      competitor: all.filter((r) => r.ownerType === 'competitor').length,
      external: all.filter((r) => r.ownerType === 'external').length,
      gap: gap.length,
      citations: ds.citations.length,
      responsesWithCitations: withCitations.size,
      responses: ds.responses.length,
    },
  }
}

// ── Opportunities ────────────────────────────────────────────────────────────

interface OppRow {
  id: string; type: string; title: string; detail: string; evidence: string; priority: string; confidence: string
  score: number; suggestedAction: string; status: string; promptId: string | null; domain: string | null
  competitorId: string | null; updatedAt: Date
}

export function toOpportunityDTO(o: OppRow): OpportunityDTO {
  const type = oneOf<OpportunityType>(OPPORTUNITY_TYPES, o.type, 'missing_brand_mention')
  const rawEv = parseObject(o.evidence)
  const evidence: Record<string, string | number | null> = {}
  for (const k of Object.keys(rawEv)) {
    const v = rawEv[k]
    evidence[k] = typeof v === 'string' || typeof v === 'number' || v === null ? v : v === undefined ? null : String(v)
  }
  return {
    id: o.id, type, typeLabel: OPPORTUNITY_TYPE_LABEL[type], title: o.title, detail: o.detail, evidence,
    priority: oneOf<Priority>(PRIORITIES, o.priority, 'medium'),
    confidence: oneOf<Confidence>(PRIORITIES, o.confidence, 'low'),
    score: o.score, suggestedAction: o.suggestedAction,
    status: oneOf<OpportunityStatus>(['OPEN', 'DISMISSED', 'DONE'], o.status, 'OPEN'),
    promptId: o.promptId, domain: o.domain, competitorId: o.competitorId, updatedAt: o.updatedAt.toISOString(),
  }
}

export async function buildOpportunityList(
  ctx: RadarCtx, p: { type?: string; status?: string; page?: number; pageSize?: number },
): Promise<OpportunityListRes> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const pageSize = Math.min(200, Math.max(1, Math.floor(p.pageSize ?? 25) || 25))
  const page = Math.max(1, Math.floor(p.page ?? 1) || 1)
  const where: Prisma.BrandRadarOpportunityWhereInput = { ...base }
  if (p.type && (OPPORTUNITY_TYPES as readonly string[]).includes(p.type)) where.type = p.type
  if (p.status && ['OPEN', 'DISMISSED', 'DONE'].includes(p.status)) where.status = p.status
  const [rows, total, grouped] = await Promise.all([
    prisma.brandRadarOpportunity.findMany({ where, orderBy: [{ score: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.brandRadarOpportunity.count({ where }),
    prisma.brandRadarOpportunity.groupBy({ by: ['type'], where: { ...base, status: 'OPEN' }, _count: { _all: true } }),
  ])
  const counts = {} as Record<OpportunityType, number>
  for (const t of OPPORTUNITY_TYPES) counts[t] = 0
  for (const g of grouped) if ((OPPORTUNITY_TYPES as readonly string[]).includes(g.type)) counts[g.type as OpportunityType] = g._count._all
  return { rows: rows.map(toOpportunityDTO), total, page, pageSize, counts }
}

/**
 * Recompute opportunities from the full dataset (no date filter) and upsert by [projectId, type, key].
 * DISMISSED / DONE rows keep their status; OPEN rows that are no longer produced are deleted.
 * Returns the number of opportunities now stored for the project.
 */
export async function refreshOpportunities(ctx: RadarCtx): Promise<number> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const { ds, runs } = await loadDataset(ctx, { from: '', to: '', country: 'all', language: 'all', provider: 'all' })
  const drafts = ds.responses.length > 0 ? buildOpportunities(ds) : []
  const newest = runs.reduce<RunLite | null>((a, r) => (!a || r.startedAt.getTime() > a.startedAt.getTime() ? r : a), null)
  const existing = await prisma.brandRadarOpportunity.findMany({ where: base, select: { id: true, type: true, key: true, status: true } })
  const seen = new Set<string>()

  for (const d of drafts) {
    seen.add(`${d.type}\u0000${d.key}`)
    const data = {
      title: d.title, detail: d.detail, evidence: JSON.stringify(d.evidence), priority: d.priority, confidence: d.confidence,
      score: d.score, suggestedAction: d.suggestedAction, promptId: d.promptId, domain: d.domain, competitorId: d.competitorId,
      lastSeenRunId: newest ? newest.id : '',
    }
    await prisma.brandRadarOpportunity.upsert({
      where: { projectId_type_key: { projectId: ctx.project.id, type: d.type, key: d.key } },
      create: { ...base, type: d.type, key: d.key, status: 'OPEN', ...data },
      update: data, // status untouched: a dismissed / done opportunity stays that way
    })
  }
  const stale = existing.filter((e) => e.status === 'OPEN' && !seen.has(`${e.type}\u0000${e.key}`)).map((e) => e.id)
  if (stale.length > 0) await prisma.brandRadarOpportunity.deleteMany({ where: { ...base, id: { in: stale } } })
  return prisma.brandRadarOpportunity.count({ where: base })
}

// ── Projects (client picker) ─────────────────────────────────────────────────

/**
 * The project list exactly as GET /api/brand-radar/projects returns it (shared with the page's server render).
 * A customer login never sees the scan schedule.
 */
export async function buildProjectOptionsFor(orgId: string, allowedIds: string[] | null, clientView: boolean): Promise<ProjectOptDTO[]> {
  const options = await buildProjectOptions(orgId, allowedIds)
  return clientView
    ? options.map((o) => ({ ...o, schedule: o.schedule ? normalizeSchedule('manual', 'manual') : null, nextRunAt: null }))
    : options
}

export async function buildProjectOptions(orgId: string, onlyIds?: string[] | null): Promise<ProjectOptDTO[]> {
  if (onlyIds && onlyIds.length === 0) return []
  // onlyIds = the projects a customer login is assigned; staff pass nothing and get the whole organization
  const idScope = onlyIds ? { id: { in: onlyIds } } : {}
  const projectScope = onlyIds ? { projectId: { in: onlyIds } } : {}
  const [projects, profiles, active] = await Promise.all([
    prisma.project.findMany({ where: { organizationId: orgId, ...idScope }, select: { id: true, name: true, clientName: true, website: true }, orderBy: { name: 'asc' } }),
    prisma.brandRadarProfile.findMany({
      where: { organizationId: orgId, ...projectScope },
      select: { projectId: true, brandName: true, primaryDomain: true, schedule: true, lastRunAt: true, nextRunAt: true },
    }),
    prisma.brandRadarPrompt.groupBy({ by: ['projectId'], where: { organizationId: orgId, status: 'ACTIVE', ...projectScope }, _count: { _all: true } }),
  ])
  const prof = new Map(profiles.map((p) => [p.projectId, p]))
  const act = new Map(active.map((a) => [a.projectId, a._count._all]))
  const logoAt = await brandLogoVersions(orgId, profiles.filter((p) => isManualProjectId(p.projectId)).map((p) => p.projectId), idScope)
  type Prof = (typeof profiles)[number]
  const row = (id: string, name: string, clientName: string, website: string, manual: boolean, pr: Prof | undefined): ProjectOptDTO => ({
    id,
    name,
    clientName,
    website,
    manual,
    hasProfile: !!pr,
    activePrompts: act.get(id) ?? 0,
    schedule: pr ? normalizeSchedule(pr.schedule, 'manual') : null,
    lastRunAt: pr?.lastRunAt ? pr.lastRunAt.toISOString() : null,
    nextRunAt: pr?.nextRunAt ? pr.nextRunAt.toISOString() : null,
    logo: logoAt.has(id) ? brandLogoPath(id, logoAt.get(id)!) : null,
    favicon: faviconUrl(website),
  })
  // Projects created inside Brand Radar have no Project row: their profile is the project.
  const manual = profiles
    .filter((p) => isManualProjectId(p.projectId))
    .sort((a, b) => a.brandName.localeCompare(b.brandName))
    .map((p) => row(p.projectId, p.brandName, p.brandName, p.primaryDomain, true, p))
  return [
    ...projects.map((p) => row(p.id, p.name, p.clientName ?? '', p.website ?? '', false, prof.get(p.id))),
    ...manual,
  ]
}

// ── Brands (landing list) ────────────────────────────────────────────────────

/** Days of answers the landing list covers */
export const BRAND_WINDOW_DAYS = 30

const DB_SCHEMA = 'plans_seo_pipeline'

interface BrandDayRow { projectId: string; day: string; asked: bigint | number; mentioned: bigint | number; appeared: bigint | number; cited: bigint | number }

/**
 * One row per brand that already has a monitor (= a saved profile), with the numbers of the last 30 days.
 * Answers are summed in the database per project and Asia/Bangkok day, so the cost does not grow with the number
 * of answers a brand has.
 */
export async function buildBrandSummaries(orgId: string, now: Date = new Date(), onlyIds?: string[] | null): Promise<BrandSummaryDTO[]> {
  if (onlyIds && onlyIds.length === 0) return []
  // onlyIds = the projects a customer login is assigned; staff pass nothing and get the whole organization
  const scope = onlyIds ? { projectId: { in: onlyIds } } : {}
  const sqlScope = onlyIds ? Prisma.sql`AND r."projectId" IN (${Prisma.join(onlyIds)})` : Prisma.empty
  const DAY = 86_400_000
  const since = new Date(now.getTime() - BRAND_WINDOW_DAYS * DAY)
  const newerFrom = bangkokDay(new Date(now.getTime() - (BRAND_WINDOW_DAYS / 2) * DAY))
  const table = Prisma.raw(`"${DB_SCHEMA}"."BrandRadarResponse"`)

  const profiles = await prisma.brandRadarProfile.findMany({
    where: { organizationId: orgId, ...scope },
    select: { projectId: true, brandName: true, primaryDomain: true, providers: true, schedule: true, lastRunAt: true, nextRunAt: true },
  })
  if (profiles.length === 0) return []
  const ids = profiles.map((p) => p.projectId)

  const [projects, active, comps, running, days, compAnswers] = await Promise.all([
    prisma.project.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, name: true, clientName: true } }),
    prisma.brandRadarPrompt.groupBy({ by: ['projectId'], where: { organizationId: orgId, status: 'ACTIVE', ...scope }, _count: { _all: true } }),
    prisma.brandRadarCompetitor.findMany({ where: { organizationId: orgId, status: 'ACTIVE', ...scope }, select: { id: true, projectId: true, name: true } }),
    prisma.brandRadarRun.findMany({ where: { organizationId: orgId, status: 'RUNNING', ...scope }, select: { projectId: true } }),
    // collectedAt is stored as UTC without a zone, so +7 hours gives the Bangkok day
    prisma.$queryRaw<BrandDayRow[]>`
      SELECT r."projectId" AS "projectId",
             to_char(r."collectedAt" + interval '7 hours', 'YYYY-MM-DD') AS "day",
             count(*) AS "asked",
             count(*) FILTER (WHERE r."brandMentioned" IS TRUE) AS "mentioned",
             count(*) FILTER (WHERE r."brandMentioned" IS TRUE OR r."ownedCited" IS TRUE) AS "appeared",
             count(*) FILTER (WHERE r."ownedCited" IS TRUE) AS "cited"
      FROM ${table} AS r
      WHERE r."organizationId" = ${orgId} AND r."status" = 'DONE'
        AND r."collectedAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        ${sqlScope}
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    prisma.brandRadarMention.groupBy({
      by: ['projectId', 'entityKey'],
      where: { organizationId: orgId, entityType: 'competitor', createdAt: { gte: since }, ...scope },
      _count: { _all: true },
    }),
  ])

  const projectOf = new Map(projects.map((p) => [p.id, p]))
  const activeOf = new Map(active.map((a) => [a.projectId, a._count._all]))
  const compName = new Map(comps.map((c) => [c.id, c.name]))
  const compCount = new Map<string, number>()
  for (const c of comps) compCount.set(c.projectId, (compCount.get(c.projectId) || 0) + 1)
  const runningSet = new Set(running.map((r) => r.projectId))
  const daysOf = new Map<string, BrandDayRow[]>()
  for (const d of days) {
    const list = daysOf.get(d.projectId)
    if (list) list.push(d)
    else daysOf.set(d.projectId, [d])
  }
  // Only competitors that are still monitored can be the "top competitor".
  const topOf = new Map<string, { name: string; answers: number }>()
  for (const c of compAnswers) {
    const name = compName.get(c.entityKey)
    if (!name) continue
    const cur = topOf.get(c.projectId)
    if (!cur || c._count._all > cur.answers) topOf.set(c.projectId, { name, answers: c._count._all })
  }
  const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null)

  const rows = profiles.map((p): BrandSummaryDTO => {
    const manual = isManualProjectId(p.projectId)
    const project = projectOf.get(p.projectId)
    const list = daysOf.get(p.projectId) ?? []
    let asked = 0
    let mentioned = 0
    let appeared = 0
    let cited = 0
    const half = { newer: { asked: 0, appeared: 0 }, older: { asked: 0, appeared: 0 } }
    const spark = list.map((d) => {
      const a = Number(d.asked)
      const m = Number(d.mentioned)
      const v = Number(d.appeared)
      asked += a
      mentioned += m
      appeared += v
      cited += Number(d.cited)
      const side = d.day >= newerFrom ? half.newer : half.older
      side.asked += a
      side.appeared += v
      return { date: d.day, asked: a, rate: ratio(v, a) }
    })
    const newer = ratio(half.newer.appeared, half.newer.asked)
    const older = ratio(half.older.appeared, half.older.asked)
    const top = topOf.get(p.projectId)
    const activePrompts = activeOf.get(p.projectId) ?? 0
    const status: BrandStatus = activePrompts === 0 ? 'needs_setup'
      : runningSet.has(p.projectId) ? 'scanning'
      : asked === 0 ? 'no_data'
      : 'active'
    return {
      id: p.projectId,
      name: p.brandName || project?.name || '',
      clientName: manual ? '' : (project?.clientName || project?.name || ''),
      website: p.primaryDomain,
      manual,
      providers: parseStrings(p.providers).filter(isProviderKey),
      competitors: compCount.get(p.projectId) ?? 0,
      topCompetitor: top ? { name: top.name, answers: top.answers, mentionRate: ratio(top.answers, asked) } : null,
      activePrompts,
      asked,
      mentioned,
      mentionRate: ratio(mentioned, asked),
      appeared,
      visibilityRate: ratio(appeared, asked),
      change: newer !== null && older !== null ? newer - older : null,
      ownedCited: cited,
      citationRate: ratio(cited, asked),
      spark,
      schedule: normalizeSchedule(p.schedule, 'manual'),
      lastRunAt: p.lastRunAt ? p.lastRunAt.toISOString() : null,
      nextRunAt: p.nextRunAt ? p.nextRunAt.toISOString() : null,
      status,
    }
  })
  // A profile whose MarsOS project is gone belongs to nobody: hide it, like every other route does.
  return rows
    .filter((r) => r.manual || projectOf.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}
