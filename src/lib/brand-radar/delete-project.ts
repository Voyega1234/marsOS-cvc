// Brand Radar — delete everything Brand Radar keeps for one project.
//
// Removes Brand Radar data only. It never touches the MarsOS Project row, Project.logoUrl, AIJob cost rows or any
// other module's table, so a regular MarsOS project keeps working everywhere else and simply shows as
// "not set up" in Brand Radar afterwards. A project created inside Brand Radar has no Project row: its profile
// is the project, so it disappears completely.
//
// Brand Radar tables have no foreign keys between them, so nothing cascades: every table is deleted explicitly,
// always filtered by organization and project together.
//
// Callers must have checked that the user may manage this project (requireProject).

import { prisma } from '@/lib/prisma'
import { brandLogoKey } from './brand-logo'
import { isMissingTable } from './server'
import { LIMITS, isManualProjectId } from './types'

/** The AppSetting key of the background-scan switch (see auto-scan.ts) */
const AUTO_SCAN_KEY_PREFIX = 'brand_radar_auto_scan:'
/** The AppSetting key of the saved site check (see site-readiness-fetch.ts) */
const SITE_CHECK_KEY_PREFIX = 'brand_radar_site_check:'

export type DeleteProjectResult =
  | { kind: 'deleted'; counts: Record<string, number> }
  /** provider calls for this project are in flight right now: deleting would leave rows written after the delete */
  | { kind: 'busy'; inFlight: number }

class BusyError extends Error {
  constructor(readonly inFlight: number) {
    super('brand radar scan in flight')
  }
}

/** Tables created by later SQL files: a database that never ran the file does not have them. */
async function optionalTables(): Promise<{ insight: boolean; queryGroup: boolean; answerExtra: boolean; clientAccess: boolean }> {
  // Probed before the transaction: inside one, a failed statement aborts every statement after it.
  const has = async (probe: () => Promise<unknown>): Promise<boolean> => {
    try {
      await probe()
      return true
    } catch (e) {
      if (isMissingTable(e)) return false
      throw e
    }
  }
  const [insight, queryGroup, answerExtra, clientAccess] = await Promise.all([
    has(() => prisma.brandRadarInsight.findFirst({ select: { id: true } })),
    has(() => prisma.brandRadarQueryGroup.findFirst({ select: { id: true } })),
    has(() => prisma.brandRadarAnswerExtra.findFirst({ select: { id: true } })),
    has(() => prisma.brandRadarClientAccess.findFirst({ select: { id: true } })),
  ])
  return { insight, queryGroup, answerExtra, clientAccess }
}

export async function deleteRadarProject(orgId: string, projectId: string, now: Date = new Date()): Promise<DeleteProjectResult> {
  const tables = await optionalTables()
  const where = { organizationId: orgId, projectId }
  const counts: Record<string, number> = {}

  try {
    await prisma.$transaction(
      async (tx) => {
        // The same lock startRun takes: no scan can start for this project while the delete runs.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`

        // Stops the scheduled job from picking this project up again.
        await tx.appSetting.deleteMany({ where: { key: `${AUTO_SCAN_KEY_PREFIX}${projectId}` } })
        // The saved site check would otherwise reappear when a regular project is set up again.
        await tx.appSetting.deleteMany({ where: { key: `${SITE_CHECK_KEY_PREFIX}${projectId}` } })

        // Take every waiting task out of the queue first. This row-locks them, so a scan step that is claiming
        // tasks at this moment either finished before this statement (its tasks are RUNNING and are seen by the
        // check below) or finds nothing left to claim.
        await tx.brandRadarResponse.updateMany({ where: { ...where, status: 'PENDING' }, data: { status: 'SKIPPED' } })
        const inFlight = await tx.brandRadarResponse.count({
          where: { ...where, status: 'RUNNING', lockedAt: { gt: new Date(now.getTime() - LIMITS.taskStaleMs) } },
        })
        if (inFlight > 0) throw new BusyError(inFlight) // rolls everything back, the queue included

        if (tables.answerExtra) counts.answerExtras = (await tx.brandRadarAnswerExtra.deleteMany({ where })).count
        if (tables.insight) counts.insights = (await tx.brandRadarInsight.deleteMany({ where })).count
        counts.mentions = (await tx.brandRadarMention.deleteMany({ where })).count
        counts.citations = (await tx.brandRadarCitation.deleteMany({ where })).count
        if (tables.queryGroup) counts.queryGroups = (await tx.brandRadarQueryGroup.deleteMany({ where })).count
        counts.opportunities = (await tx.brandRadarOpportunity.deleteMany({ where })).count
        counts.responses = (await tx.brandRadarResponse.deleteMany({ where })).count
        counts.runs = (await tx.brandRadarRun.deleteMany({ where })).count
        counts.prompts = (await tx.brandRadarPrompt.deleteMany({ where })).count
        counts.competitors = (await tx.brandRadarCompetitor.deleteMany({ where })).count
        // A customer login must not keep its access to a report that no longer exists.
        if (tables.clientAccess) counts.clientAccess = (await tx.brandRadarClientAccess.deleteMany({ where })).count
        // Only a project created inside Brand Radar keeps its logo here. A regular project's logo is Project.logoUrl,
        // shared with the rest of MarsOS, and stays.
        if (isManualProjectId(projectId)) await tx.appSetting.deleteMany({ where: { key: brandLogoKey(projectId) } })
        counts.profiles = (await tx.brandRadarProfile.deleteMany({ where })).count
      },
      { timeout: 60_000, maxWait: 10_000 },
    )
  } catch (e) {
    if (e instanceof BusyError) return { kind: 'busy', inFlight: e.inFlight }
    throw e
  }
  return { kind: 'deleted', counts }
}
