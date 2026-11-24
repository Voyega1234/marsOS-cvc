/**
 * Brand Radar — URL Monitor loader. Server only.
 * The monitored list lives in the AppSetting key-value table (one JSON value per project), so no new table is needed.
 * Callers must have checked that the user may manage this project (requireProject): the list is staff only.
 */
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { buildInsight, loadDataset } from './queries'
import type { RadarCtx } from './server'
import { isProviderKey, type RadarFilters } from './types'
import {
  buildUrlMonthStats, buildUrlReport, citingDataset, parseMonitoredUrls, pickUrlMonths, summarizeUrls, urlMatcher, urlMonitorKey,
  type UrlMonthRow,
} from './url-monitor'
import type { MonitoredUrl, UrlMonitorDTO, UrlScorecard } from './url-monitor-types'

/** ids per query when looking up the answers that cite the URL */
const ID_CHUNK = 5000

export async function loadMonitoredUrls(projectId: string): Promise<MonitoredUrl[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: urlMonitorKey(projectId) }, select: { value: true } })
  return parseMonitoredUrls(row?.value)
}

async function saveMonitoredUrls(projectId: string, list: MonitoredUrl[]): Promise<void> {
  const key = urlMonitorKey(projectId)
  if (list.length === 0) {
    await prisma.appSetting.deleteMany({ where: { key } })
    return
  }
  const value = JSON.stringify(list)
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

export async function addMonitoredUrl(projectId: string, existing: MonitoredUrl[], item: Pick<MonitoredUrl, 'url' | 'normalizedUrl' | 'prefix'>): Promise<{ urls: MonitoredUrl[]; id: string }> {
  const added: MonitoredUrl = { id: randomUUID(), ...item, addedAt: new Date().toISOString() }
  const urls = [...existing, added]
  await saveMonitoredUrls(projectId, urls)
  return { urls, id: added.id }
}

/** null when the id is not in the list */
export async function removeMonitoredUrl(projectId: string, id: string): Promise<MonitoredUrl[] | null> {
  const existing = await loadMonitoredUrls(projectId)
  const urls = existing.filter((m) => m.id !== id)
  if (urls.length === existing.length) return null
  await saveMonitoredUrls(projectId, urls)
  return urls
}

type Base = { organizationId: string; projectId: string }

/**
 * Month comparison over the whole history of the project (every platform, question and date).
 * Counted like loadDataset: collected answers only, answers of a deleted prompt or of an unknown platform ignored.
 */
async function loadUrlMonths(base: Base, url: MonitoredUrl): Promise<NonNullable<UrlScorecard['months']>> {
  const match = urlMatcher(url)
  const [promptRows, respGroups, citeRaw] = await Promise.all([
    prisma.brandRadarPrompt.findMany({ where: base, select: { id: true } }),
    prisma.brandRadarResponse.groupBy({ by: ['runId', 'promptId', 'provider'], where: { ...base, status: 'DONE' }, _count: { _all: true } }),
    prisma.brandRadarCitation.findMany({
      // startsWith narrows the rows; the exact rule is applied below by urlMatcher
      where: { ...base, normalizedUrl: url.prefix ? { startsWith: url.normalizedUrl } : url.normalizedUrl },
      select: { responseId: true, normalizedUrl: true, position: true },
    }),
  ])
  const promptIds = new Set(promptRows.map((p) => p.id))
  const usable = (g: { promptId: string; provider: string }) => promptIds.has(g.promptId) && isProviderKey(g.provider)

  interface Round { asked: number; cited: number; brandMentioned: number; placeSum: number; placeCount: number; prompts: Set<string>; citingPrompts: Set<string> }
  const rounds = new Map<string, Round>()
  for (const g of respGroups) {
    if (!usable(g)) continue
    let r = rounds.get(g.runId)
    if (!r) rounds.set(g.runId, (r = { asked: 0, cited: 0, brandMentioned: 0, placeSum: 0, placeCount: 0, prompts: new Set(), citingPrompts: new Set() }))
    r.asked += g._count._all
    r.prompts.add(g.promptId)
  }

  const cites = citeRaw.filter((c) => match(c.normalizedUrl))
  const citingIds = Array.from(new Set(cites.map((c) => c.responseId)))
  const answers = new Map<string, { runId: string; promptId: string; brandMentioned: boolean | null }>()
  for (let i = 0; i < citingIds.length; i += ID_CHUNK) {
    const found = await prisma.brandRadarResponse.findMany({
      where: { ...base, status: 'DONE', id: { in: citingIds.slice(i, i + ID_CHUNK) } },
      select: { id: true, runId: true, promptId: true, provider: true, brandMentioned: true },
    })
    for (const a of found) if (usable(a)) answers.set(a.id, a)
  }
  for (const a of Array.from(answers.values())) {
    const r = rounds.get(a.runId)
    if (!r) continue
    r.cited += 1
    r.citingPrompts.add(a.promptId)
    if (a.brandMentioned === true) r.brandMentioned += 1
  }
  for (const c of cites) {
    const a = answers.get(c.responseId)
    const r = a ? rounds.get(a.runId) : undefined
    if (!r) continue
    r.placeSum += c.position + 1
    r.placeCount += 1
  }

  const runIds = Array.from(rounds.keys())
  const runs = runIds.length > 0
    ? await prisma.brandRadarRun.findMany({ where: { ...base, id: { in: runIds } }, select: { id: true, startedAt: true } })
    : []
  const rows: UrlMonthRow[] = runs.flatMap((run) => {
    const r = rounds.get(run.id)
    if (!r) return []
    return [{
      startedAt: run.startedAt, asked: r.asked, cited: r.cited, brandMentioned: r.brandMentioned, placeSum: r.placeSum, placeCount: r.placeCount,
      promptIds: Array.from(r.prompts), citingPromptIds: Array.from(r.citingPrompts),
    }]
  })
  return pickUrlMonths(buildUrlMonthStats(rows))
}

/** The monitored list with its headline numbers, and the full report of one URL (`urlId`, else the first) */
export async function buildUrlMonitor(ctx: RadarCtx, filters: RadarFilters, urlId: string | null): Promise<UrlMonitorDTO> {
  const list = await loadMonitoredUrls(ctx.project.id)
  const { ds, runs, configured } = await loadDataset(ctx, filters)
  const urls = summarizeUrls(ds, list)
  const selected = list.find((m) => m.id === urlId) ?? list[0] ?? null
  if (!selected) return { configured, urls, answers: ds.responses.length, selectedId: null, report: null }

  const base: Base = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const { report, citing } = buildUrlReport(ds, runs, selected)
  // Both are extras of the report: a failure leaves that block empty instead of failing the page.
  const [insight, months] = await Promise.all([
    buildInsight(base, citingDataset(ds, citing)).catch((e) => { console.error('url-monitor insight:', e); return undefined }),
    loadUrlMonths(base, selected).catch((e) => { console.error('url-monitor months:', e); return null }),
  ])
  return {
    configured, urls, answers: ds.responses.length, selectedId: selected.id,
    report: { ...report, insight, scorecard: { grades: report.scorecard.grades, months } },
  }
}
