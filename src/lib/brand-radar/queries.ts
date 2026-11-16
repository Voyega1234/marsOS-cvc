/**
 * Brand Radar — server-side queries and DTO builders (overview, prompts, citations, opportunities...).
 * Server only. EVERY query filters by ctx.orgId AND ctx.project.id.
 * The maths lives in the pure engines (metrics.ts, opportunities.ts); this file loads rows and shapes DTOs.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PBN_PREFS_MARK, readPbnSites } from '@/lib/upload-article/pbn'
import {
  citationGapDomains, citationOwners, citedDomains, competitorByTopic, competitorDomains, competitorTrend, computeKpis,
  byIntent, byProvider, byTopic, entityShares, headToHead, promptEntityTrend, promptStatsMap,
  topicProviderHeat, trendByRun,
  type CitationRow, type Dataset, type MentionRow, type PromptLite, type RespRow, type RunLite,
} from './metrics'
import { buildOpportunities } from './opportunities'
import { toRunDTO } from './runner'
import { hostOf, normalizeDomain } from './normalize'
import { parseDayRange, previousRange } from './schedule'
import { parseObject, parseStrings, userNames, type RadarCtx } from './server'
import {
  JOURNEY_STAGES, OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABEL, PRIORITIES, PROMPT_INTENTS, PROMPT_SOURCES, PROMPT_STATUSES,
  PROVIDERS, PROVIDER_KEYS, SCHEDULES, isProviderKey,
  type CitationOwner, type CitationsDTO, type CitationView, type CitedDomainRow, type CollectionMethod, type CompetitorDTO,
  type CompetitorInsightsDTO, type Confidence, type JourneyStage, type OpportunityDTO, type OpportunityListRes,
  type OpportunityStatus, type OpportunityType, type OverviewDTO, type Priority, type ProfileDTO, type ProjectOptDTO,
  type PromptDTO, type PromptDetailDTO, type PromptIntent, type PromptListDTO, type PromptRowDTO, type PromptSource,
  type PromptStats, type PromptStatus, type ProviderKey, type RadarFilters, type ResponseDTO, type RunDTO, type RunStatus,
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
    schedule: oneOf<Schedule>(SCHEDULES, r.schedule, 'manual'),
    nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
    lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
    monthlyBudgetUsd: r.monthlyBudgetUsd,
    maxPromptsPerRun: r.maxPromptsPerRun,
    samplesPerPrompt: r.samplesPerPrompt,
    updatedAt: r.updatedAt.toISOString(),
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
export async function loadDataset(ctx: RadarCtx, filters: RadarFilters, opts: LoadOpts = {}): Promise<LoadedDataset> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const [profile, promptRows, comps] = await Promise.all([
    prisma.brandRadarProfile.findFirst({ where: base, select: { brandName: true } }),
    prisma.brandRadarPrompt.findMany({ where: base, orderBy: { createdAt: 'desc' } }),
    prisma.brandRadarCompetitor.findMany({ where: { ...base, status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
  ])
  const promptIds = new Set(promptRows.map((p) => p.id))

  const range = parseDayRange(filters.from, filters.to)
  const where: Prisma.BrandRadarResponseWhereInput = { ...base, status: 'DONE' }
  if (range.gte || range.lte) where.collectedAt = { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) }
  if (filters.country && filters.country !== 'all') where.country = filters.country
  if (filters.language && filters.language !== 'all') where.language = filters.language
  if (filters.provider !== 'all') where.provider = filters.provider
  if (opts.promptId) where.promptId = opts.promptId

  const respRaw = await prisma.brandRadarResponse.findMany({
    where,
    select: {
      id: true, runId: true, promptId: true, provider: true, collectedAt: true, brandMentioned: true,
      brandOccurrences: true, brandRecommended: true, ownedCited: true, citationCount: true,
    },
  })
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
        select: { responseId: true, runId: true, promptId: true, provider: true, entityType: true, entityKey: true, competitorId: true, entityName: true, occurrences: true, recommended: true, compared: true, position: true },
      }),
      prisma.brandRadarCitation.findMany({
        where: sub,
        select: { responseId: true, runId: true, promptId: true, provider: true, url: true, normalizedUrl: true, domain: true, title: true, ownerType: true, competitorId: true, createdAt: true },
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

function isMissingTable(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2021' || e.code === 'P2022')
}

/** Vendor library + own PBN host set for this org. Missing optional tables count as empty. */
export async function loadFlagSources(orgId: string): Promise<FlagSources> {
  const vendors = new Map<string, VendorInfo>()
  try {
    const sites = await prisma.blmVendorSite.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      select: { id: true, domain: true, price: true, currency: true, domainRating: true, traffic: true, linkType: true, category: true },
    })
    let details: Array<{ vendorSiteId: string; priceBacklink: number | null }> = []
    try {
      details = await prisma.blmVendorDetail.findMany({
        where: { organizationId: orgId },
        select: { vendorSiteId: true, priceBacklink: true },
      })
    } catch (e) {
      if (!isMissingTable(e)) throw e
    }
    const detailBy = new Map(details.map((d) => [d.vendorSiteId, d]))
    for (const s of sites) {
      const key = normalizeDomain(s.domain) || s.domain.toLowerCase()
      if (vendors.has(key)) continue
      const d = detailBy.get(s.id)
      const price = s.price > 0 ? s.price : d?.priceBacklink != null && d.priceBacklink > 0 ? d.priceBacklink : null
      vendors.set(key, {
        price, currency: s.currency, domainRating: s.domainRating, traffic: s.traffic, linkType: s.linkType, category: s.category,
      })
    }
  } catch (e) {
    if (!isMissingTable(e)) throw e
  }

  const pbn = new Set<string>()
  const clients = await prisma.uploadClient.findMany({
    where: { organizationId: orgId, pushPrefs: { contains: PBN_PREFS_MARK } },
    select: { pushPrefs: true },
  })
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

function toRows(promptRows: PromptRow[], ds: Dataset): PromptRowDTO[] {
  const stats = promptStatsMap(ds)
  return promptRows.map((p) => ({ ...toPromptDTO(p), stats: stats.get(p.id) ?? { ...EMPTY_STATS } }))
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
  const loaded = await loadDataset(ctx, filters)
  const matching = await prisma.brandRadarPrompt.findMany({ where: promptWhere(ctx, p, true), select: { id: true } })
  const ids = new Set(matching.map((m) => m.id))
  const rows = toRows(loaded.promptRows.filter((r) => ids.has(r.id)), loaded.ds)
  return sortPromptRows(rows, oneOf<PromptSort>(PROMPT_SORTS, p.sort, 'recent'))
}

export async function buildPromptList(ctx: RadarCtx, filters: RadarFilters, p: PromptListParams): Promise<PromptListDTO> {
  const pageSize = Math.min(200, Math.max(1, Math.floor(p.pageSize ?? 25) || 25))
  const page = Math.max(1, Math.floor(p.page ?? 1) || 1)
  const all = await buildPromptRows(ctx, filters, p)
  const [grouped, topicRows] = await Promise.all([
    prisma.brandRadarPrompt.groupBy({ by: ['status'], where: promptWhere(ctx, p, false), _count: { _all: true } }),
    prisma.brandRadarPrompt.findMany({
      where: { organizationId: ctx.orgId, projectId: ctx.project.id, NOT: { topic: '' } },
      select: { topic: true }, distinct: ['topic'], orderBy: { topic: 'asc' },
    }),
  ])
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

// ── Prompt detail ────────────────────────────────────────────────────────────

const HISTORY_CAP = 50

export async function buildPromptDetail(ctx: RadarCtx, filters: RadarFilters, promptId: string, vendorOnly: boolean): Promise<PromptDetailDTO | null> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const row = await prisma.brandRadarPrompt.findFirst({ where: { ...base, id: promptId } })
  if (!row) return null
  const [loaded, flags] = await Promise.all([loadDataset(ctx, filters, { promptId }), loadFlagSources(ctx.orgId)])
  const { ds, runs } = loaded

  const byProv: PromptDetailDTO['byProvider'] = []
  for (const key of PROVIDER_KEYS) {
    const rs = ds.responses.filter((r) => r.provider === key)
    if (rs.length === 0) continue
    const brand = rs.filter((r) => r.brandMentioned === true).length
    byProv.push({
      provider: key, label: PROVIDERS[key].label, responses: rs.length, brandMentions: brand,
      mentionRate: rs.length > 0 ? brand / rs.length : null,
      brandRecommended: rs.filter((r) => r.brandRecommended === true).length,
      ownedCited: rs.filter((r) => r.ownedCited === true).length,
    })
  }

  let cited = applyFlags(citedDomains(ds), flags)
  if (vendorOnly) cited = cited.filter((d) => d.vendor !== null || d.isOwnPbn)

  // History: collected answers plus failed / skipped attempts for this prompt, newest first.
  const range = parseDayRange(filters.from, filters.to)
  const dateWhere = range.gte || range.lte ? { gte: range.gte, lte: range.lte } : undefined
  const hw: Prisma.BrandRadarResponseWhereInput = {
    ...base, promptId, status: { in: ['DONE', 'FAILED', 'SKIPPED'] },
    ...(dateWhere ? { createdAt: dateWhere } : {}),
    ...(filters.country !== 'all' ? { country: filters.country } : {}),
    ...(filters.language !== 'all' ? { language: filters.language } : {}),
    ...(filters.provider !== 'all' ? { provider: filters.provider } : {}),
  }
  const hist = await prisma.brandRadarResponse.findMany({ where: hw, orderBy: { createdAt: 'desc' }, take: HISTORY_CAP })
  const histIds = hist.map((h) => h.id)
  const [hm, hc] = histIds.length
    ? await Promise.all([
        prisma.brandRadarMention.findMany({ where: { ...base, responseId: { in: histIds } } }),
        prisma.brandRadarCitation.findMany({ where: { ...base, responseId: { in: histIds } }, orderBy: { position: 'asc' } }),
      ])
    : [[], []]
  const history: ResponseDTO[] = hist.map((h) => {
    const provider = (isProviderKey(h.provider) ? h.provider : 'openai') as ProviderKey
    return {
      id: h.id, runId: h.runId, promptId: h.promptId, provider, providerLabel: PROVIDERS[provider].label,
      model: h.model,
      collectionMethod: oneOf<CollectionMethod>(['api_simulated', 'observed_serp', 'imported'], h.collectionMethod, 'api_simulated'),
      status: oneOf<TaskStatus>(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED'], h.status, 'FAILED'),
      error: h.error, country: h.country, language: h.language, responseText: h.responseText,
      collectedAt: h.collectedAt ? h.collectedAt.toISOString() : null, costUsd: h.costUsd,
      brandMentioned: h.brandMentioned, brandOccurrences: h.brandOccurrences, brandRecommended: h.brandRecommended, ownedCited: h.ownedCited,
      mentions: hm.filter((m) => m.responseId === h.id).map((m) => ({
        entityType: m.entityType === 'competitor' ? 'competitor' as const : 'brand' as const,
        key: m.entityKey, name: m.entityName, occurrences: m.occurrences, recommended: m.recommended, compared: m.compared,
        position: m.position, snippet: m.snippet,
      })),
      citations: hc.filter((c) => c.responseId === h.id).map((c) => ({
        url: c.url, domain: c.domain, title: c.title,
        ownerType: oneOf<CitationOwner>(['own', 'competitor', 'external'], c.ownerType, 'external'), position: c.position,
      })),
    }
  })

  return {
    prompt: toPromptDTO(row),
    responses: ds.responses.length,
    entities: entityShares(ds),
    byProvider: byProv,
    trend: promptEntityTrend(ds, runs),
    citedDomains: cited,
    history,
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────

function emptyOverview(configured: boolean, ds: Dataset, monitoring: number): OverviewDTO {
  return {
    configured, hasData: false, kpis: computeKpis(ds, monitoring), previous: null, trend: [], entities: entityShares(ds),
    byProvider: [], byIntent: [], byTopic: [], heat: { rows: [], columns: [], values: [] }, citationOwners: citationOwners(ds),
    topCitedDomains: [], topPrompts: [], weakPrompts: [], activeRun: null, lastRun: null,
  }
}

export async function buildOverview(ctx: RadarCtx, filters: RadarFilters): Promise<OverviewDTO> {
  const base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const loaded = await loadDataset(ctx, filters)
  const { ds, runs, promptRows } = loaded
  const monitoring = promptRows.filter((p) => p.status === 'ACTIVE').length
  if (!loaded.configured) return emptyOverview(false, ds, monitoring)

  const [flags, activeRaw, lastRaw] = await Promise.all([
    loadFlagSources(ctx.orgId),
    prisma.brandRadarRun.findFirst({ where: { ...base, status: 'RUNNING' }, orderBy: { startedAt: 'desc' } }),
    prisma.brandRadarRun.findFirst({ where: base, orderBy: { startedAt: 'desc' } }),
  ])
  const names = await userNames([activeRaw?.createdById, lastRaw?.createdById])
  const activeRun = activeRaw ? toRunDTO(activeRaw, names.get(activeRaw.createdById) ?? '') : null
  const lastRun = lastRaw ? toRunDTO(lastRaw, names.get(lastRaw.createdById) ?? '') : null

  let previous: OverviewDTO['previous'] = null
  const prev = filters.from && filters.to ? previousRange(filters.from, filters.to) : null
  if (prev) {
    const pl = await loadDataset(ctx, { ...filters, from: prev.from, to: prev.to })
    if (pl.ds.responses.length > 0) previous = computeKpis(pl.ds, monitoring)
  }

  const kpis = computeKpis(ds, monitoring)
  const rows = toRows(promptRows, ds).filter((r) => r.stats.responses >= 1 && r.stats.mentionRate !== null)
  const best = sortPromptRows(rows, 'mention_rate_desc').slice(0, 5)
  const worst = sortPromptRows(rows, 'mention_rate_asc').slice(0, 5)

  return {
    configured: true,
    hasData: ds.responses.length > 0,
    kpis,
    previous,
    trend: trendByRun(ds, runs),
    entities: entityShares(ds),
    byProvider: byProvider(ds),
    byIntent: byIntent(ds),
    byTopic: byTopic(ds),
    heat: topicProviderHeat(ds),
    citationOwners: citationOwners(ds),
    topCitedDomains: applyFlags(citedDomains(ds).slice(0, 10), flags),
    topPrompts: best,
    weakPrompts: worst,
    activeRun,
    lastRun,
  }
}

// ── Competitor insights ──────────────────────────────────────────────────────

export async function buildCompetitorInsights(ctx: RadarCtx, filters: RadarFilters): Promise<CompetitorInsightsDTO> {
  const { ds, runs } = await loadDataset(ctx, filters)
  return {
    responses: ds.responses.length,
    entities: entityShares(ds),
    trend: competitorTrend(ds, runs),
    headToHead: headToHead(ds),
    byTopic: competitorByTopic(ds),
    domains: competitorDomains(ds),
  }
}

// ── Citations ────────────────────────────────────────────────────────────────

export interface CitationParams { view?: string; q?: string; competitorId?: string; page?: number; pageSize?: number; vendorOnly?: boolean }

export async function buildCitations(ctx: RadarCtx, filters: RadarFilters, p: CitationParams): Promise<CitationsDTO> {
  const view = oneOf<CitationView>(['own', 'competitor', 'external', 'gap'], p.view, 'external')
  const pageSize = Math.min(1000, Math.max(1, Math.floor(p.pageSize ?? 50) || 50))
  const page = Math.max(1, Math.floor(p.page ?? 1) || 1)
  const [{ ds }, flags] = await Promise.all([loadDataset(ctx, filters), loadFlagSources(ctx.orgId)])

  const all = applyFlags(citedDomains(ds), flags)
  const gap = applyFlags(citationGapDomains(ds), flags)
  const q = (p.q ?? '').trim().toLowerCase()
  const refine = (rows: CitedDomainRow[]): CitedDomainRow[] => rows.filter((r) => {
    if (p.competitorId && r.competitorId !== p.competitorId) return false
    if (p.vendorOnly && r.vendor === null && !r.isOwnPbn) return false
    if (q && !r.domain.toLowerCase().includes(q) && !r.urls.some((u) => u.url.toLowerCase().includes(q) || u.title.toLowerCase().includes(q))) return false
    return true
  })
  const source = view === 'gap' ? gap : all.filter((r) => r.ownerType === view)
  const rows = refine(source)

  const withCitations = new Set(ds.citations.map((c) => c.responseId))
  return {
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

export async function buildProjectOptions(orgId: string): Promise<ProjectOptDTO[]> {
  const [projects, profiles, active] = await Promise.all([
    prisma.project.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, clientName: true, website: true }, orderBy: { name: 'asc' } }),
    prisma.brandRadarProfile.findMany({ where: { organizationId: orgId }, select: { projectId: true, schedule: true, lastRunAt: true, nextRunAt: true } }),
    prisma.brandRadarPrompt.groupBy({ by: ['projectId'], where: { organizationId: orgId, status: 'ACTIVE' }, _count: { _all: true } }),
  ])
  const prof = new Map(profiles.map((p) => [p.projectId, p]))
  const act = new Map(active.map((a) => [a.projectId, a._count._all]))
  return projects.map((p) => {
    const pr = prof.get(p.id)
    return {
      id: p.id,
      name: p.name,
      clientName: p.clientName ?? '',
      website: p.website ?? '',
      hasProfile: !!pr,
      activePrompts: act.get(p.id) ?? 0,
      schedule: pr ? oneOf<Schedule>(SCHEDULES, pr.schedule, 'manual') : null,
      lastRunAt: pr?.lastRunAt ? pr.lastRunAt.toISOString() : null,
      nextRunAt: pr?.nextRunAt ? pr.nextRunAt.toISOString() : null,
    }
  })
}
