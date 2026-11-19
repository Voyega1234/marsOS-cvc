/**
 * Brand Radar — scorecard loader. Server only.
 * Grades come from the already filtered entity shares; months cover the whole history of the project
 * (every platform, question and date) and are built from aggregate queries, not row loads.
 */
import { prisma } from '@/lib/prisma'
import { buildMonthStats, gradeScores, pickMonths, type MonthRow } from './scorecard'
import type { ScorecardDTO } from './scorecard-types'
import { isProviderKey, type EntityShare } from './types'

interface RoundAcc { asked: number; mentioned: number; ownedCited: number; appeared: number; positionSum: number; positionCount: number }

const emptyAcc = (): RoundAcc => ({ asked: 0, mentioned: 0, ownedCited: 0, appeared: 0, positionSum: 0, positionCount: 0 })

/**
 * `clientView` mirrors the prompt scope of loadDataset: a customer login only counts prompts that staff put into monitoring.
 */
export async function buildScorecard(
  base: { organizationId: string; projectId: string },
  entities: EntityShare[],
  responses: number,
  clientView = false,
): Promise<ScorecardDTO> {
  const grades = gradeScores(entities, responses)

  const [promptRows, respGroups, posGroups] = await Promise.all([
    prisma.brandRadarPrompt.findMany({
      where: { ...base, ...(clientView ? { status: { in: ['ACTIVE', 'INACTIVE'] } } : {}) },
      select: { id: true },
    }),
    prisma.brandRadarResponse.groupBy({
      by: ['runId', 'promptId', 'provider', 'brandMentioned', 'ownedCited'],
      where: { ...base, status: 'DONE' },
      _count: { _all: true },
    }),
    prisma.brandRadarMention.groupBy({
      by: ['runId', 'promptId', 'provider'],
      where: { ...base, entityType: 'brand', position: { not: null } },
      _sum: { position: true },
      _count: { position: true },
    }),
  ])
  // Same as loadDataset: answers of a deleted prompt or of an unknown platform are ignored.
  const promptIds = new Set(promptRows.map((p) => p.id))
  const usable = (g: { promptId: string; provider: string }) => promptIds.has(g.promptId) && isProviderKey(g.provider)

  const rounds = new Map<string, RoundAcc>()
  const accOf = (runId: string) => {
    let a = rounds.get(runId)
    if (!a) rounds.set(runId, (a = emptyAcc()))
    return a
  }
  for (const g of respGroups) {
    if (!usable(g)) continue
    const n = g._count._all
    const a = accOf(g.runId)
    a.asked += n
    if (g.brandMentioned === true) a.mentioned += n
    if (g.ownedCited === true) a.ownedCited += n
    if (g.brandMentioned === true || g.ownedCited === true) a.appeared += n
  }
  for (const g of posGroups) {
    if (!usable(g)) continue
    const a = accOf(g.runId)
    a.positionSum += g._sum.position ?? 0
    a.positionCount += g._count.position
  }

  const runIds = Array.from(rounds.keys())
  const runs = runIds.length > 0
    ? await prisma.brandRadarRun.findMany({ where: { ...base, id: { in: runIds } }, select: { id: true, startedAt: true } })
    : []
  const rows: MonthRow[] = runs.flatMap((r) => {
    const a = rounds.get(r.id)
    return a ? [{ startedAt: r.startedAt, ...a }] : []
  })

  return { grades, months: pickMonths(buildMonthStats(rows)) }
}
