/**
 * Brand Radar — scan runner (server only).
 * A run = one BrandRadarRun row + one BrandRadarResponse row per (prompt, provider, sample), which doubles as the task queue.
 * LLM providers ask each prompt samplesPerPrompt times (answers vary between asks); observed SERP providers once.
 * The page (or the cron) calls stepRun repeatedly; each call claims a few PENDING tasks with
 * FOR UPDATE SKIP LOCKED, so parallel callers never take the same task.
 * The provider caller is injectable so tests never touch the network.
 *
 * After each answer is stored the runner also keeps what the provider searched for and asks a second, cheap
 * model how the answer portrays the tracked brands (BrandRadarInsight), then sorts new search queries into
 * topic groups (BrandRadarQueryGroup). All of that is best effort: a failure there never fails the answer.
 */
import { Prisma, type BrandRadarRun } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAIJob } from '@/lib/logAIJob'
import { detectEntities, type BrandSpec, type CompetitorSpec } from './detect'
import { extractCitations, type RawCitation } from './citations'
import { callProvider, hasCredentials, dfsListPrice, logProviderCall, type ProviderCaller } from './providers'
import { isDue, monthKey, monthRange, nextRunAfter, periodKey, promptSetHash } from './schedule'
import { cleanFoundSources, cleanQueries, normalizeQueryKey } from './insight'
import { resolveLanguage } from './language'
import { listAutoScanProjectIds, touchCronHeartbeat } from './auto-scan'
import { ANALYSIS_LIMITS, distinctQueries, liveAnalyzer, type InsightAnalyzer, type SentimentTarget } from './sentiment'
import {
  DEFAULT_SAMPLES, LIMITS, PROVIDERS, PROVIDER_KEYS, SEARCH_QUERY_SUPPORT, aiJobProjectId, isManualProjectId, isProviderKey, normalizeSamples, parseSchedule, samplesFor,
  type AnswerSentiment, type OtherEntity, type ProviderKey, type RunDTO, type RunDetailRes, type RunDueRes, type RunEstimateDTO, type RunListRes,
  type RunStatus, type RunStepRes, type RunTrigger, type TaskStatus, type UsageDTO,
} from './types'

const SCHEMA = 'plans_seo_pipeline'
const COST_WINDOW_DAYS = 90
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export interface RunnerCtx {
  orgId: string
  userId: string
  project: { id: string; name?: string; clientName?: string }
}

type Db = Prisma.TransactionClient

/**
 * The project a run belongs to, checked against the run's own organization. A project created inside Brand Radar
 * has no Project row: its profile is the project (see MANUAL_PROJECT_PREFIX).
 */
async function loadRunProject(orgId: string, projectId: string): Promise<{ id: string; name: string; clientName: string } | null> {
  if (isManualProjectId(projectId)) {
    const m = await prisma.brandRadarProfile.findFirst({ where: { projectId, organizationId: orgId }, select: { brandName: true } })
    return m ? { id: projectId, name: m.brandName, clientName: m.brandName } : null
  }
  const p = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true, name: true, clientName: true } })
  return p ? { id: p.id, name: p.name, clientName: p.clientName || '' } : null
}

function jsonStrings(s: string | null | undefined): string[] {
  try {
    const v = JSON.parse(s || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function profileProviders(json: string | null | undefined): ProviderKey[] {
  return jsonStrings(json).filter(isProviderKey)
}

// ── DTO ──────────────────────────────────────────────────────────────────────

export function toRunDTO(run: BrandRadarRun, createdByName: string): RunDTO {
  return {
    id: run.id,
    projectId: run.projectId,
    trigger: (run.trigger === 'schedule' ? 'schedule' : 'manual') as RunTrigger,
    status: run.status as RunStatus,
    providers: profileProviders(run.providers),
    promptCount: run.promptCount,
    samplesPerPrompt: run.samplesPerPrompt,
    totalTasks: run.totalTasks,
    doneTasks: run.doneTasks,
    failedTasks: run.failedTasks,
    skippedTasks: run.skippedTasks,
    costUsd: run.costUsd,
    estimatedCostUsd: run.estimatedCostUsd,
    periodKey: run.periodKey,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    createdByName,
  }
}

async function nameOf(userId: string): Promise<string> {
  if (!userId) return ''
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  return u ? u.name || u.email || userId : ''
}

async function dto(run: BrandRadarRun): Promise<RunDTO> {
  return toRunDTO(run, await nameOf(run.createdById))
}

// ── Reads used by the routes ─────────────────────────────────────────────────

/** Null when the run does not exist in this organization + project */
export async function getRun(ctx: { orgId: string; project: { id: string } }, runId: string): Promise<BrandRadarRun | null> {
  if (!runId) return null
  return prisma.brandRadarRun.findFirst({ where: { id: runId, organizationId: ctx.orgId, projectId: ctx.project.id } })
}

export async function getRunDTO(ctx: RunnerCtx, runId: string): Promise<RunDTO | null> {
  const run = await getRun(ctx, runId)
  return run ? dto(run) : null
}

export async function listRuns(ctx: RunnerCtx, page: number, pageSize: number): Promise<RunListRes> {
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const size = Math.min(Math.max(Math.floor(pageSize) || 20, 1), 100)
  const pg = Math.max(Math.floor(page) || 1, 1)
  const [total, rows] = await Promise.all([
    prisma.brandRadarRun.count({ where }),
    prisma.brandRadarRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (pg - 1) * size, take: size }),
  ])
  const names = new Map<string, string>()
  const ids = Array.from(new Set(rows.map((r) => r.createdById).filter(Boolean)))
  for (const id of ids) names.set(id, await nameOf(id))
  return { runs: rows.map((r) => toRunDTO(r, names.get(r.createdById) || '')), total, page: pg, pageSize: size }
}

export async function getRunDetail(ctx: RunnerCtx, runId: string): Promise<RunDetailRes | null> {
  const run = await getRun(ctx, runId)
  if (!run) return null
  const rows = await prisma.brandRadarResponse.findMany({
    where: { runId: run.id, organizationId: ctx.orgId, projectId: ctx.project.id, status: { in: ['FAILED', 'SKIPPED'] } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { promptText: true, provider: true, status: true, error: true },
  })
  return {
    run: await dto(run),
    failures: rows.map((r) => ({
      promptText: r.promptText,
      provider: (isProviderKey(r.provider) ? r.provider : 'openai') as ProviderKey,
      status: r.status as TaskStatus,
      error: r.error,
    })),
  }
}

// ── Estimate ─────────────────────────────────────────────────────────────────

interface Plan {
  profile: Prisma.BrandRadarProfileGetPayload<Record<string, never>> | null
  prompts: Array<{ id: string; text: string; country: string; language: string }>
  providers: ProviderKey[]
  /** profile setting; per-provider count comes from samplesFor() */
  samples: number
  avg: Map<string, { avg: number; calls: number }>
  monthSpend: number
}

async function monthSpendOf(db: Db, orgId: string, projectId: string, now: Date): Promise<number> {
  const { start, end } = monthRange(now)
  const r = await db.brandRadarResponse.aggregate({
    where: { organizationId: orgId, projectId, updatedAt: { gte: start, lt: end } },
    _sum: { costUsd: true },
  })
  return r._sum.costUsd || 0
}

async function loadPlan(db: Db, ctx: RunnerCtx, now: Date): Promise<Plan> {
  const profile = await db.brandRadarProfile.findFirst({ where: { organizationId: ctx.orgId, projectId: ctx.project.id } })
  const avg = new Map<string, { avg: number; calls: number }>()
  if (!profile) return { profile: null, prompts: [], providers: [], samples: DEFAULT_SAMPLES, avg, monthSpend: 0 }

  const all = await db.brandRadarPrompt.findMany({
    where: { organizationId: ctx.orgId, projectId: ctx.project.id, status: 'ACTIVE' },
    select: { id: true, text: true, country: true, language: true, priority: true, createdAt: true },
  })
  all.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 1
    const pb = PRIORITY_RANK[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  const prompts = all.slice(0, Math.max(profile.maxPromptsPerRun, 0)).map((p) => ({
    id: p.id,
    text: p.text,
    country: p.country || profile.country,
    language: resolveLanguage(profile.language, p.text, p.language),
  }))

  const providers = profileProviders(profile.providers).filter((k) => hasCredentials(k))
  const since = new Date(now.getTime() - COST_WINDOW_DAYS * 86_400_000)
  const groups = await db.brandRadarResponse.groupBy({
    by: ['provider'],
    where: { organizationId: ctx.orgId, status: 'DONE', costUsd: { not: null }, updatedAt: { gte: since } },
    _avg: { costUsd: true },
    _count: { _all: true },
  })
  for (const g of groups) {
    if (g._avg.costUsd !== null) avg.set(g.provider, { avg: g._avg.costUsd, calls: g._count._all })
  }
  const monthSpend = await monthSpendOf(db, ctx.orgId, ctx.project.id, now)
  const samples = normalizeSamples(profile.samplesPerPrompt)
  return { profile, prompts, providers, samples, avg, monthSpend }
}

function estimateFrom(plan: Plan): RunEstimateDTO {
  const { profile } = plan
  const perProvider: RunEstimateDTO['perProvider'] = plan.providers.map((k) => {
    const a = plan.avg.get(k)
    // every DataForSEO platform has a fixed list price per call; OpenRouter cost is only known from past calls
    const fallback = dfsListPrice(k)
    const samples = samplesFor(k, plan.samples)
    return {
      provider: k,
      samples,
      tasks: plan.prompts.length * samples,
      avgCostUsd: a ? a.avg : fallback,
      basedOnCalls: a ? a.calls : 0,
    }
  })
  const unknown = perProvider.some((p) => p.avgCostUsd === null)
  const estimatedCostUsd = unknown ? null : perProvider.reduce((s, p) => s + (p.avgCostUsd || 0) * p.tasks, 0)
  const budget = profile ? profile.monthlyBudgetUsd : null
  const out: RunEstimateDTO = {
    prompts: plan.prompts.length,
    providers: plan.providers,
    samplesPerPrompt: plan.samples,
    tasks: perProvider.reduce((s, p) => s + p.tasks, 0),
    estimatedCostUsd,
    perProvider,
    monthSpendUsd: plan.monthSpend,
    monthlyBudgetUsd: budget,
    allowed: true,
    reason: '',
  }
  const block = (reason: string): RunEstimateDTO => ({ ...out, allowed: false, reason })
  if (!profile) return block('Brand Radar is not set up for this client yet')
  if (!plan.prompts.length) return block('No active prompts. Activate at least one prompt before scanning')
  if (!plan.providers.length) return block('No usable provider: select a provider whose credentials are connected on the server')
  if (budget !== null) {
    if (plan.monthSpend >= budget) {
      return block(`Monthly budget reached ($${plan.monthSpend.toFixed(4)} of $${budget.toFixed(2)})`)
    }
    if (estimatedCostUsd !== null && plan.monthSpend + estimatedCostUsd > budget) {
      return block(`This scan is estimated at $${estimatedCostUsd.toFixed(4)} and would pass the monthly budget ($${plan.monthSpend.toFixed(4)} spent of $${budget.toFixed(2)})`)
    }
  }
  return out
}

export async function estimateRun(ctx: RunnerCtx, now: Date = new Date()): Promise<RunEstimateDTO> {
  return estimateFrom(await loadPlan(prisma, ctx, now))
}

// ── Start ────────────────────────────────────────────────────────────────────

export type StartResult =
  | { kind: 'started'; run: BrandRadarRun }
  | { kind: 'existing'; run: BrandRadarRun }
  | { kind: 'conflict'; run: BrandRadarRun }
  | { kind: 'blocked'; reason: string }

export async function startRun(ctx: RunnerCtx, trigger: RunTrigger, now: Date = new Date()): Promise<StartResult> {
  let key: string | null = null
  try {
    return await prisma.$transaction(async (tx) => {
      // one start at a time per project: the lock is released when the transaction ends
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.project.id}))`

      const running = await tx.brandRadarRun.findFirst({
        where: { organizationId: ctx.orgId, projectId: ctx.project.id, status: 'RUNNING' },
      })
      if (running) return { kind: 'conflict', run: running } as StartResult

      const plan = await loadPlan(tx, ctx, now)
      if (trigger === 'schedule' && plan.profile) {
        key = periodKey(plan.profile.schedule, now)
        if (key) {
          const dup = await tx.brandRadarRun.findFirst({ where: { projectId: ctx.project.id, periodKey: key } })
          if (dup) return { kind: 'existing', run: dup } as StartResult
        }
      }
      const est = estimateFrom(plan)
      if (!est.allowed) return { kind: 'blocked', reason: est.reason } as StartResult

      const run = await tx.brandRadarRun.create({
        data: {
          organizationId: ctx.orgId,
          projectId: ctx.project.id,
          trigger,
          status: 'RUNNING',
          providers: JSON.stringify(plan.providers),
          promptCount: plan.prompts.length,
          samplesPerPrompt: plan.samples,
          promptSetHash: promptSetHash(plan.prompts.map((p) => p.id)),
          totalTasks: est.tasks,
          estimatedCostUsd: est.estimatedCostUsd,
          periodKey: key,
          createdById: ctx.userId,
          startedAt: now,
        },
      })
      // Sample-major order (tasks are claimed oldest first): every prompt gets its first ask on
      // every provider before any second ask, so a run stopped early still covers all prompts.
      const rows: Prisma.BrandRadarResponseCreateManyInput[] = []
      const maxSamples = Math.max(1, ...plan.providers.map((k) => samplesFor(k, plan.samples)))
      for (let s = 0; s < maxSamples; s++) {
        for (const p of plan.prompts) {
          for (const k of plan.providers) {
            if (s >= samplesFor(k, plan.samples)) continue
            rows.push({
              organizationId: ctx.orgId,
              projectId: ctx.project.id,
              runId: run.id,
              promptId: p.id,
              provider: k,
              sampleIndex: s,
              promptText: p.text,
              country: p.country,
              language: p.language,
              collectionMethod: PROVIDERS[k].method,
            })
          }
        }
      }
      await tx.brandRadarResponse.createMany({ data: rows })
      return { kind: 'started', run } as StartResult
    }, { timeout: 30_000, maxWait: 10_000 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && key) {
      const dup = await prisma.brandRadarRun.findFirst({ where: { projectId: ctx.project.id, periodKey: key } })
      if (dup) return { kind: 'existing', run: dup }
    }
    throw e
  }
}

// ── Step ─────────────────────────────────────────────────────────────────────

interface ClaimedTask {
  id: string
  promptId: string
  provider: string
  promptText: string
  country: string
  language: string
  attempts: number
  costUsd: number | null
}

/** Recompute the run counters from its tasks (the tasks are the source of truth) */
async function refreshCounters(runId: string): Promise<void> {
  const groups = await prisma.brandRadarResponse.groupBy({
    by: ['status'],
    where: { runId },
    _count: { _all: true },
    _sum: { costUsd: true },
  })
  let done = 0, failed = 0, skipped = 0, cost = 0
  for (const g of groups) {
    if (g.status === 'DONE') done = g._count._all
    else if (g.status === 'FAILED') failed = g._count._all
    else if (g.status === 'SKIPPED') skipped = g._count._all
    cost += g._sum.costUsd || 0
  }
  await prisma.brandRadarRun.update({ where: { id: runId }, data: { doneTasks: done, failedTasks: failed, skippedTasks: skipped, costUsd: cost } })
}

/** Close the run when no task is waiting or in flight. Never touches a run that is no longer RUNNING. */
async function finalizeIfDone(run: BrandRadarRun, now: Date): Promise<void> {
  const open = await prisma.brandRadarResponse.count({ where: { runId: run.id, status: { in: ['PENDING', 'RUNNING'] } } })
  if (open > 0) return
  const fresh = await prisma.brandRadarRun.findUnique({ where: { id: run.id } })
  if (!fresh || fresh.status !== 'RUNNING') return
  let status: RunStatus
  if (fresh.doneTasks > 0 && fresh.failedTasks + fresh.skippedTasks === 0) status = 'COMPLETED'
  else if (fresh.doneTasks === 0 && fresh.failedTasks > 0) status = 'FAILED'
  else status = 'PARTIAL' // some done + some failed/skipped, or everything skipped
  const upd = await prisma.brandRadarRun.updateMany({ where: { id: run.id, status: 'RUNNING' }, data: { status, finishedAt: now } })
  if (upd.count === 0) return
  await prisma.brandRadarProfile.updateMany({ where: { projectId: run.projectId, organizationId: run.organizationId }, data: { lastRunAt: now } })
  await refreshOpportunitiesAfterRun(run)
}

/**
 * Recompute the project's opportunities once a run closes. Dynamic import: queries.ts imports this file.
 * A failure here must not undo or fail the finished run; staff can still press Refresh on the tab.
 * role 'SYSTEM': no person triggered this; refreshOpportunities only reads orgId and project.id.
 */
async function refreshOpportunitiesAfterRun(run: BrandRadarRun): Promise<void> {
  try {
    // same org check as every route: the run's own org must own the project
    const { loadOwnedProject } = await import('./server')
    const project = await loadOwnedProject(run.organizationId, run.projectId)
    if (!project) return
    const { refreshOpportunities } = await import('./queries')
    await refreshOpportunities({ orgId: run.organizationId, userId: run.createdById, role: 'SYSTEM', project })
  } catch (e) {
    console.error('[brand-radar] opportunity refresh after run failed', e instanceof Error ? e.message : e)
  }
}

function spec(profile: Prisma.BrandRadarProfileGetPayload<Record<string, never>>): BrandSpec {
  return {
    name: profile.brandName,
    aliases: jsonStrings(profile.aliases),
    ambiguousAliases: jsonStrings(profile.ambiguousAliases),
    contextTerms: jsonStrings(profile.contextTerms),
  }
}

// ── Answer insight: search queries + sentiment + query groups ────────────────

/** The insight tables arrive with a separate SQL file. Until it has run, scans work as before and skip this part. */
let insightTables: { ok: boolean; at: number } | null = null
const INSIGHT_RECHECK_MS = 60_000

async function insightTablesReady(): Promise<boolean> {
  if (insightTables && (insightTables.ok || Date.now() - insightTables.at < INSIGHT_RECHECK_MS)) return insightTables.ok
  try {
    await prisma.brandRadarInsight.findFirst({ select: { id: true } })
    await prisma.brandRadarQueryGroup.findFirst({ select: { id: true } })
    insightTables = { ok: true, at: Date.now() }
  } catch (e) {
    const missing = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2021' || e.code === 'P2022')
    if (!missing) console.error('[brand-radar] insight tables check failed', e instanceof Error ? e.message : e)
    insightTables = { ok: false, at: Date.now() }
  }
  return insightTables.ok
}

/** Same idea for the answer-extra table: after a missing-table error, skip it for 60 seconds and then check again. */
let answerExtraMissingAt = 0

/** Store the names the AI platform tagged in this answer. Never throws: the answer itself is already saved. */
async function captureAnswerExtra(a: { t: ClaimedTask; run: BrandRadarRun; key: ProviderKey; otherEntities: OtherEntity[] | undefined }): Promise<void> {
  const list = a.otherEntities
  if (!list || list.length === 0 || Date.now() - answerExtraMissingAt < INSIGHT_RECHECK_MS) return
  try {
    const { t, run, key } = a
    const entities = JSON.stringify(list)
    await prisma.brandRadarAnswerExtra.upsert({
      where: { responseId: t.id },
      create: { organizationId: run.organizationId, projectId: run.projectId, runId: run.id, responseId: t.id, promptId: t.promptId, provider: key, entities },
      update: { entities },
    })
  } catch (e) {
    // same check as server.ts isMissingTable (not imported: server.ts pulls in the session layer)
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2021' || e.code === 'P2022')) { answerExtraMissingAt = Date.now(); return }
    console.error('[brand-radar extra]', errText(e))
  }
}

const failedCallCost = (e: unknown): number => Number((e as { usage?: { costUsd?: number } })?.usage?.costUsd) || 0
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500)

/**
 * Store what the provider searched for and how the answer portrays the tracked brands.
 * Returns the queries that count for Search Query Groups (providers that expose their real searches).
 * Never throws: the answer itself is already saved.
 */
async function captureInsight(a: {
  t: ClaimedTask
  run: BrandRadarRun
  key: ProviderKey
  text: string
  hits: ReturnType<typeof detectEntities>
  searchQueries: unknown
  found: ReturnType<typeof extractCitations>
  clientName: string
  userId: string
  analyzer: InsightAnalyzer | null
}): Promise<string[]> {
  try {
    if (!(await insightTablesReady())) return []
    const { t, run, key } = a
    const queries = cleanQueries(a.searchQueries)
    const foundSources = cleanFoundSources(a.found.map((f) => ({ url: f.url, domain: f.domain, title: f.title, ownerType: f.ownerType })))
    let sentiment: AnswerSentiment | null = null
    let sentimentModel = ''

    if (a.analyzer && a.text.trim().length >= ANALYSIS_LIMITS.answerMin) {
      const targets: SentimentTarget[] = []
      if (a.hits.brand) targets.push({ entityType: 'brand', key: 'brand', name: a.hits.brand.name })
      for (const h of a.hits.competitors) targets.push({ entityType: 'competitor', key: h.competitorId || h.key, name: h.name })
      const jobBase = {
        organizationId: run.organizationId,
        projectId: aiJobProjectId(run.projectId),
        jobType: 'BRAND_RADAR_SENTIMENT',
        modelProvider: 'openrouter',
        createdById: a.userId,
        inputSummary: `[brand-radar] ${t.promptText}`.slice(0, 500),
      }
      try {
        const r = await a.analyzer.sentiment({ prompt: t.promptText, answer: a.text, targets: targets.slice(0, ANALYSIS_LIMITS.entitiesMax), clientName: a.clientName })
        sentiment = r.sentiment
        sentimentModel = r.model
        // the analysis is part of what this answer cost: run cost and the monthly budget both read this column
        if (r.costUsd > 0) await prisma.brandRadarResponse.update({ where: { id: t.id }, data: { costUsd: { increment: r.costUsd } } })
        await logAIJob({ ...jobBase, modelName: r.model, status: 'SUCCESS', tokenUsed: r.tokens, estimatedCost: r.costUsd })
      } catch (e) {
        const cost = failedCallCost(e)
        if (cost > 0) await prisma.brandRadarResponse.update({ where: { id: t.id }, data: { costUsd: { increment: cost } } })
        await logAIJob({ ...jobBase, modelName: '', status: 'FAILED', estimatedCost: cost, errorMessage: errText(e) })
      }
    }

    if (queries.length || sentiment || foundSources.length) {
      const data = { searchQueries: JSON.stringify(queries), foundSources: JSON.stringify(foundSources), sentiment: sentiment ? JSON.stringify(sentiment) : null, sentimentModel }
      await prisma.brandRadarInsight.upsert({
        where: { responseId: t.id },
        create: { organizationId: run.organizationId, projectId: run.projectId, runId: run.id, responseId: t.id, promptId: t.promptId, provider: key, ...data },
        update: data,
      })
    }
    return SEARCH_QUERY_SUPPORT[key] === 'exposed' ? queries : []
  } catch (e) {
    console.error('[brand-radar] insight capture failed', errText(e))
    return []
  }
}

/**
 * Give search queries that have no group yet a topic group (one model call for up to groupBatch queries).
 * `costResponseId`: the answer that carries the call's cost, so the run total and the monthly budget stay true.
 * Never throws. A query the model leaves out stays ungrouped and is shown as its own group.
 */
async function groupNewQueries(
  run: BrandRadarRun,
  queries: string[],
  costResponseId: string | null,
  clientName: string,
  userId: string,
  analyzer: InsightAnalyzer,
): Promise<void> {
  try {
    const distinct = distinctQueries(queries)
    if (!distinct.size || !(await insightTablesReady())) return
    const known = await prisma.brandRadarQueryGroup.findMany({
      where: { organizationId: run.organizationId, projectId: run.projectId, queryKey: { in: Array.from(distinct.keys()) } },
      select: { queryKey: true },
    })
    for (const k of known) distinct.delete(k.queryKey)
    const fresh = Array.from(distinct.entries()).slice(0, ANALYSIS_LIMITS.groupBatch)
    if (!fresh.length) return

    const recent = await prisma.brandRadarQueryGroup.findMany({
      where: { organizationId: run.organizationId, projectId: run.projectId, groupName: { not: '' } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { groupName: true },
    })
    const existing = Array.from(new Set(recent.map((g) => g.groupName))).slice(0, ANALYSIS_LIMITS.existingGroupsMax)

    const jobBase = {
      organizationId: run.organizationId,
      projectId: aiJobProjectId(run.projectId),
      jobType: 'BRAND_RADAR_QUERY_GROUPS',
      modelProvider: 'openrouter',
      createdById: userId,
      inputSummary: `[brand-radar] group ${fresh.length} search queries`,
    }
    const addCost = async (cost: number) => {
      if (cost > 0 && costResponseId) await prisma.brandRadarResponse.update({ where: { id: costResponseId }, data: { costUsd: { increment: cost } } })
    }
    try {
      const r = await analyzer.groupQueries({ queries: fresh.map(([, q]) => q), existing, clientName })
      const rows: Prisma.BrandRadarQueryGroupCreateManyInput[] = []
      const seen = new Set<string>()
      for (const g of r.groups) {
        const queryKey = normalizeQueryKey(g.query)
        if (!distinct.has(queryKey) || seen.has(queryKey) || !g.groupName) continue
        seen.add(queryKey)
        rows.push({ organizationId: run.organizationId, projectId: run.projectId, queryKey, query: distinct.get(queryKey) || g.query, groupName: g.groupName })
      }
      if (rows.length) await prisma.brandRadarQueryGroup.createMany({ data: rows, skipDuplicates: true })
      await addCost(r.costUsd)
      await logAIJob({ ...jobBase, modelName: r.model, status: 'SUCCESS', tokenUsed: r.tokens, estimatedCost: r.costUsd })
    } catch (e) {
      const cost = failedCallCost(e)
      await addCost(cost)
      await logAIJob({ ...jobBase, modelName: '', status: 'FAILED', estimatedCost: cost, errorMessage: errText(e) })
    }
  } catch (e) {
    console.error('[brand-radar] query grouping failed', errText(e))
  }
}

/** Queries of this run that still have no group once its last task is finished (a failed or oversized earlier batch). */
const SWEEP_CHUNKS = 2

async function sweepUngroupedQueries(run: BrandRadarRun, clientName: string, userId: string, analyzer: InsightAnalyzer): Promise<void> {
  try {
    if (!(await insightTablesReady())) return
    const exposed = PROVIDER_KEYS.filter((k) => SEARCH_QUERY_SUPPORT[k] === 'exposed')
    const rows = await prisma.brandRadarInsight.findMany({
      where: { organizationId: run.organizationId, projectId: run.projectId, runId: run.id, provider: { in: exposed }, searchQueries: { not: '[]' } },
      select: { responseId: true, searchQueries: true },
    })
    if (!rows.length) return
    const all: string[] = []
    for (const r of rows) {
      try {
        all.push(...cleanQueries(JSON.parse(r.searchQueries)))
      } catch { /* a row that is not JSON holds no queries */ }
    }
    for (let i = 0; i < SWEEP_CHUNKS; i++) await groupNewQueries(run, all, rows[0].responseId, clientName, userId, analyzer)
  } catch (e) {
    console.error('[brand-radar] query group sweep failed', errText(e))
  }
}

/**
 * Read one answer the way a scan does: which brands it names and which pages it cites. No database access.
 * The sample-size test in Settings uses the same function, so a test and a real scan can never disagree
 * about what counts as a mention or a citation.
 */
export function analyzeAnswer(
  text: string,
  citations: RawCitation[],
  profile: Prisma.BrandRadarProfileGetPayload<Record<string, never>>,
  competitors: Array<CompetitorSpec & { domains: string[] }>,
  foundSources?: RawCitation[],
): { hits: ReturnType<typeof detectEntities>; cites: ReturnType<typeof extractCitations>; found: ReturnType<typeof extractCitations> } {
  const hits = detectEntities(text, spec(profile), competitors.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })))
  const owned = jsonStrings(profile.ownedDomains)
  if (profile.primaryDomain) owned.push(profile.primaryDomain)
  const compSpecs = competitors.map((c) => ({ id: c.id, domains: c.domains }))
  const cites = extractCitations({ text, citations }, owned, compSpecs)
  // Found-but-not-cited pages go through the same classifier as citations, so own / competitor / other cannot disagree.
  // Empty text: only the supplied list is read, never the answer.
  const citedUrls = new Set(cites.map((c) => c.normalizedUrl))
  const found = extractCitations({ text: '', citations: foundSources ?? [] }, owned, compSpecs).filter((f) => !citedUrls.has(f.normalizedUrl))
  return { hits, cites, found }
}

/** One claimed task. Returns the search queries of this answer that still need a group (empty when there are none). */
async function processTask(
  t: ClaimedTask,
  run: BrandRadarRun,
  profile: Prisma.BrandRadarProfileGetPayload<Record<string, never>>,
  competitors: Array<CompetitorSpec & { domains: string[] }>,
  clientName: string,
  userId: string,
  caller: ProviderCaller,
  analyzer: InsightAnalyzer | null,
): Promise<string[]> {
  const key = (isProviderKey(t.provider) ? t.provider : 'openai') as ProviderKey
  const log = { orgId: run.organizationId, userId, projectId: run.projectId }
  const before = t.costUsd || 0
  try {
    if (!isProviderKey(t.provider)) throw new Error(`Unknown provider ${t.provider}`)
    const r = await caller(key, { prompt: t.promptText, country: t.country || profile.country, language: resolveLanguage(profile.language, t.promptText, t.language), clientName })
    const tokens = r.inputTokens + r.outputTokens
    if (r.status === 'SKIPPED') {
      await prisma.brandRadarResponse.update({
        where: { id: t.id },
        data: { status: 'SKIPPED', error: r.error || 'Skipped', lockedAt: null, costUsd: before + r.costUsd, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
      })
      await logProviderCall(log, key, t.promptText, { ok: true, model: r.model, costUsd: r.costUsd, tokens })
      return []
    }

    const text = (r.text || '').slice(0, LIMITS.responseTextMax)
    const { hits, cites, found } = analyzeAnswer(text, r.citations, profile, competitors, r.foundSources)
    const now = new Date()
    const base = { organizationId: run.organizationId, projectId: run.projectId, runId: run.id, responseId: t.id, promptId: t.promptId, provider: key }

    await prisma.$transaction(async (tx) => {
      await tx.brandRadarResponse.update({
        where: { id: t.id },
        data: {
          status: 'DONE',
          error: '',
          lockedAt: null,
          responseText: text,
          model: r.model,
          collectionMethod: PROVIDERS[key].method,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: before + r.costUsd,
          brandMentioned: !!hits.brand,
          brandOccurrences: hits.brand ? hits.brand.occurrences : 0,
          brandRecommended: !!(hits.brand && hits.brand.recommended),
          ownedCited: cites.some((c) => c.ownerType === 'own'),
          citationCount: cites.length,
          collectedAt: now,
        },
      })
      const mentions: Prisma.BrandRadarMentionCreateManyInput[] = []
      if (hits.brand) {
        const h = hits.brand
        mentions.push({ ...base, entityType: 'brand', entityKey: 'brand', competitorId: null, entityName: h.name, occurrences: h.occurrences, matchedAliases: JSON.stringify(h.matchedAliases), recommended: h.recommended, compared: h.compared, position: h.position, positionPct: h.positionPct, snippet: h.snippet })
      }
      for (const h of hits.competitors) {
        mentions.push({ ...base, entityType: 'competitor', entityKey: h.key, competitorId: h.competitorId || h.key, entityName: h.name, occurrences: h.occurrences, matchedAliases: JSON.stringify(h.matchedAliases), recommended: h.recommended, compared: h.compared, position: h.position, positionPct: h.positionPct, snippet: h.snippet })
      }
      if (mentions.length) await tx.brandRadarMention.createMany({ data: mentions, skipDuplicates: true })
      if (cites.length) {
        await tx.brandRadarCitation.createMany({
          data: cites.map((c) => ({ ...base, url: c.url, normalizedUrl: c.normalizedUrl, host: c.host, domain: c.domain, title: c.title, ownerType: c.ownerType, competitorId: c.competitorId, position: c.position })),
          skipDuplicates: true,
        })
      }
    })
    await logProviderCall(log, key, t.promptText, { ok: true, model: r.model, costUsd: r.costUsd, tokens })
    await captureAnswerExtra({ t, run, key, otherEntities: r.otherEntities })
    return await captureInsight({ t, run, key, text, hits, searchQueries: r.searchQueries, found, clientName, userId, analyzer })
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500)
    const cost = Number((e as { costUsd?: number }).costUsd) || 0
    const fatal = msg.startsWith('NOT_CONNECTED')
    const status = !fatal && t.attempts < LIMITS.taskMaxAttempts ? 'PENDING' : 'FAILED'
    await prisma.brandRadarResponse.update({
      where: { id: t.id },
      data: { status, error: msg, lockedAt: null, costUsd: cost > 0 || t.costUsd !== null ? before + cost : null },
    })
    await logProviderCall(log, key, t.promptText, { ok: false, model: '', costUsd: cost, tokens: 0, error: msg })
    return []
  }
}

/**
 * Do one batch of work for a run. Null = the run does not exist in this organization + project.
 * `analyzer` reads sentiment and groups search queries. It defaults to the live one only with the live provider
 * caller, so a test that passes a fake caller never reaches the network unless it passes a fake analyzer too.
 */
export async function stepRun(
  ids: { orgId: string; userId: string; projectId: string },
  runId: string,
  caller: ProviderCaller = callProvider,
  now: Date = new Date(),
  analyzer: InsightAnalyzer | null = caller === callProvider ? liveAnalyzer : null,
): Promise<RunStepRes | null> {
  const run = await prisma.brandRadarRun.findFirst({ where: { id: runId, organizationId: ids.orgId, projectId: ids.projectId } })
  if (!run) return null
  if (run.status !== 'RUNNING') return { run: await dto(run), processed: 0, done: true }

  // 1) tasks claimed by a worker that never came back
  const cutoff = new Date(now.getTime() - LIMITS.taskStaleMs)
  const staleWhere = { runId: run.id, status: 'RUNNING', lockedAt: { lt: cutoff } }
  await prisma.brandRadarResponse.updateMany({
    where: { ...staleWhere, attempts: { lt: LIMITS.taskMaxAttempts } },
    data: { status: 'PENDING', lockedAt: null, error: 'Reclaimed after a stalled call' },
  })
  await prisma.brandRadarResponse.updateMany({
    where: { ...staleWhere, attempts: { gte: LIMITS.taskMaxAttempts } },
    data: { status: 'FAILED', lockedAt: null, error: 'Stalled call, no attempts left' },
  })

  const profile = await prisma.brandRadarProfile.findFirst({ where: { organizationId: run.organizationId, projectId: run.projectId } })

  // 2) budget
  const spend = await monthSpendOf(prisma, run.organizationId, run.projectId, now)
  if (profile && profile.monthlyBudgetUsd !== null && spend >= profile.monthlyBudgetUsd) {
    await prisma.brandRadarResponse.updateMany({
      where: { runId: run.id, status: 'PENDING' },
      data: { status: 'SKIPPED', error: 'Monthly budget reached' },
    })
    await refreshCounters(run.id)
    await finalizeIfDone(run, now)
    const after = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run.id } })
    return { run: await dto(after), processed: 0, done: after.status !== 'RUNNING' }
  }

  // 3) claim a batch
  const lockedAt = now.toISOString()
  const claimed = await prisma.$queryRaw<ClaimedTask[]>`
    UPDATE ${Prisma.raw(`"${SCHEMA}"."BrandRadarResponse"`)} AS r
    SET "status" = 'RUNNING', "attempts" = r."attempts" + 1,
        "lockedAt" = (${lockedAt}::timestamptz AT TIME ZONE 'UTC'),
        "updatedAt" = (${lockedAt}::timestamptz AT TIME ZONE 'UTC')
    WHERE r."id" IN (
      SELECT s."id" FROM ${Prisma.raw(`"${SCHEMA}"."BrandRadarResponse"`)} AS s
      WHERE s."runId" = ${run.id} AND s."status" = 'PENDING'
      ORDER BY s."createdAt", s."sampleIndex", s."id"
      LIMIT ${LIMITS.stepBatch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING r."id", r."promptId", r."provider", r."promptText", r."country", r."language", r."attempts", r."costUsd"`

  if (claimed.length && profile) {
    const comps = await prisma.brandRadarCompetitor.findMany({
      where: { organizationId: run.organizationId, projectId: run.projectId, status: 'ACTIVE' },
    })
    const competitors = comps.map((c) => ({ id: c.id, name: c.name, aliases: jsonStrings(c.aliases), domains: jsonStrings(c.domains) }))
    const project = await loadRunProject(run.organizationId, run.projectId)
    const clientName = (project && (project.clientName || project.name)) || ''
    const userId = run.createdById || ids.userId
    const found = await Promise.all(claimed.map((t) => processTask(t, run, profile, competitors, clientName, userId, caller, analyzer)))
    if (analyzer) {
      const source = found.findIndex((q) => q.length > 0)
      if (source >= 0) await groupNewQueries(run, found.flat(), claimed[source].id, clientName, userId, analyzer)
      const open = await prisma.brandRadarResponse.count({ where: { runId: run.id, status: { in: ['PENDING', 'RUNNING'] } } })
      if (open === 0) await sweepUngroupedQueries(run, clientName, userId, analyzer)
    }
  } else if (claimed.length && !profile) {
    await prisma.brandRadarResponse.updateMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      data: { status: 'FAILED', error: 'Brand Radar profile no longer exists', lockedAt: null },
    })
  }

  await refreshCounters(run.id)
  await finalizeIfDone(run, new Date())
  const after = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run.id } })
  return { run: await dto(after), processed: claimed.length, done: after.status !== 'RUNNING' }
}

// ── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelRun(ctx: RunnerCtx, runId: string, now: Date = new Date()): Promise<RunDTO | null> {
  const run = await getRun(ctx, runId)
  if (!run) return null
  if (run.status === 'RUNNING') {
    await prisma.brandRadarResponse.updateMany({ where: { runId: run.id, status: 'PENDING' }, data: { status: 'SKIPPED', error: 'Cancelled' } })
    await prisma.brandRadarRun.updateMany({ where: { id: run.id, status: 'RUNNING' }, data: { status: 'CANCELLED', finishedAt: now } })
    await refreshCounters(run.id)
  }
  const after = await prisma.brandRadarRun.findUniqueOrThrow({ where: { id: run.id } })
  return dto(after)
}

// ── Scheduled start ──────────────────────────────────────────────────────────

export async function runDue(ctx: RunnerCtx, now: Date = new Date()): Promise<RunDueRes> {
  const profile = await prisma.brandRadarProfile.findFirst({ where: { organizationId: ctx.orgId, projectId: ctx.project.id } })
  if (!profile) return { run: null, reason: 'Brand Radar is not set up for this client yet' }
  const schedule = profile.schedule
  // A stored value this version cannot read is treated like manual: no automatic scan
  const spec = parseSchedule(schedule)
  if (!spec || spec.kind === 'manual') return { run: null, reason: 'Schedule is manual' }
  if (!isDue(schedule, profile.nextRunAt, now)) return { run: null, reason: 'Not due yet' }

  const r = await startRun(ctx, 'schedule', now)
  if (r.kind === 'blocked') return { run: null, reason: r.reason }
  if (r.kind === 'conflict') return { run: await dto(r.run), reason: 'A scan is already running' }
  // started or already scanned this period: the next due time moves forward either way
  await prisma.brandRadarProfile.updateMany({
    where: { id: profile.id, organizationId: ctx.orgId },
    data: { nextRunAt: nextRunAfter(schedule, now) },
  })
  return { run: await dto(r.run), reason: r.kind === 'started' ? 'Scheduled scan started' : 'This period was already scanned' }
}

// ── Cron ─────────────────────────────────────────────────────────────────────

export async function cronTick(
  maxMs: number,
  caller: ProviderCaller = callProvider,
): Promise<{ started: number; stepped: number }> {
  const t0 = Date.now()
  const now = new Date()
  let started = 0
  let stepped = 0

  // Lets Settings show that the scheduled job is alive. Never a reason to skip the scans themselves.
  try {
    await touchCronHeartbeat(now)
  } catch (e) {
    console.error('[brand-radar cron] heartbeat failed', e instanceof Error ? e.message : e)
  }

  // Only projects whose "automatic scanning" switch is on are started or continued here.
  // Every other project keeps scanning the old way: while someone has the page open.
  const autoIds = await listAutoScanProjectIds()
  if (!autoIds.length) return { started, stepped }

  const profiles = await prisma.brandRadarProfile.findMany({
    where: {
      projectId: { in: autoIds },
      schedule: { not: 'manual' },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    select: { organizationId: true, projectId: true, createdById: true },
  })
  for (const p of profiles) {
    if (Date.now() - t0 >= maxMs) break
    const project = await loadRunProject(p.organizationId, p.projectId)
    if (!project) continue
    const ctx: RunnerCtx = { orgId: p.organizationId, userId: p.createdById, project }
    try {
      const r = await runDue(ctx, now)
      if (r.run && r.reason === 'Scheduled scan started') started++
    } catch (e) {
      console.error('[brand-radar cron] start failed', p.projectId, e instanceof Error ? e.message : e)
    }
  }

  while (Date.now() - t0 < maxMs) {
    const running = await prisma.brandRadarRun.findMany({
      where: { status: 'RUNNING', projectId: { in: autoIds } },
      orderBy: { startedAt: 'asc' },
      take: 50,
    })
    if (!running.length) break
    let processed = 0
    for (const run of running) {
      if (Date.now() - t0 >= maxMs) break
      try {
        const r = await stepRun({ orgId: run.organizationId, userId: run.createdById, projectId: run.projectId }, run.id, caller)
        if (r) {
          stepped++
          processed += r.processed
        }
      } catch (e) {
        console.error('[brand-radar cron] step failed', run.id, e instanceof Error ? e.message : e)
      }
    }
    if (processed === 0) break // nothing claimable right now (tasks held by other workers)
  }
  return { started, stepped }
}

// ── Usage ────────────────────────────────────────────────────────────────────

const CALL_ROWS = (orgId: string, projectId: string, start: Date, end: Date): Prisma.BrandRadarResponseWhereInput => ({
  organizationId: orgId,
  projectId,
  updatedAt: { gte: start, lt: end },
  OR: [{ status: { in: ['DONE', 'FAILED'] } }, { status: 'SKIPPED', costUsd: { not: null } }],
})

export async function usage(ctx: RunnerCtx, now: Date = new Date()): Promise<UsageDTO> {
  const profile = await prisma.brandRadarProfile.findFirst({
    where: { organizationId: ctx.orgId, projectId: ctx.project.id },
    select: { monthlyBudgetUsd: true },
  })
  const { start, end } = monthRange(now)
  const rows = await prisma.brandRadarResponse.groupBy({
    by: ['provider', 'status'],
    where: CALL_ROWS(ctx.orgId, ctx.project.id, start, end),
    _count: { _all: true },
    _sum: { costUsd: true },
  })
  const map = new Map<string, { calls: number; failed: number; costUsd: number }>()
  for (const r of rows) {
    const e = map.get(r.provider) || { calls: 0, failed: 0, costUsd: 0 }
    e.calls += r._count._all
    if (r.status === 'FAILED') e.failed += r._count._all
    e.costUsd += r._sum.costUsd || 0
    map.set(r.provider, e)
  }
  const byProvider: UsageDTO['byProvider'] = PROVIDER_KEYS.filter((k) => map.has(k)).map((k) => {
    const e = map.get(k)!
    return { provider: k, label: PROVIDERS[k].label, calls: e.calls, failed: e.failed, costUsd: e.costUsd }
  })
  const monthSpendUsd = byProvider.reduce((s, p) => s + p.costUsd, 0)
  const calls = byProvider.reduce((s, p) => s + p.calls, 0)
  // spend also counts rows that are not "calls" yet (retries waiting) so it matches the budget check
  const spend = await monthSpendOf(prisma, ctx.orgId, ctx.project.id, now)

  const history: UsageDTO['history'] = []
  const keys: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 30 * 86_400_000)
    const k = monthKey(d)
    if (keys.indexOf(k) < 0) keys.push(k)
  }
  const months = keys.slice(-6)
  for (const k of months) {
    const r = monthRange(new Date(`${k}-15T12:00:00+07:00`))
    const [agg, byStatus] = await Promise.all([
      prisma.brandRadarResponse.aggregate({ where: { organizationId: ctx.orgId, projectId: ctx.project.id, updatedAt: { gte: r.start, lt: r.end } }, _sum: { costUsd: true } }),
      prisma.brandRadarResponse.groupBy({ by: ['status'], where: CALL_ROWS(ctx.orgId, ctx.project.id, r.start, r.end), _count: { _all: true } }),
    ])
    const cnt = byStatus.reduce((s, x) => s + x._count._all, 0)
    const failed = byStatus.reduce((s, x) => s + (x.status === 'FAILED' ? x._count._all : 0), 0)
    history.push({ month: k, costUsd: agg._sum.costUsd || 0, calls: cnt, failed })
  }

  const budget = profile ? profile.monthlyBudgetUsd : null
  return {
    month: monthKey(now),
    monthSpendUsd: Math.max(spend, monthSpendUsd),
    monthlyBudgetUsd: budget,
    budgetUsed: budget && budget > 0 ? Math.max(spend, monthSpendUsd) / budget : null,
    calls,
    byProvider,
    history,
  }
}
