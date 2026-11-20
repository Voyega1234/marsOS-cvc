// Server-only: log of who changed a lead's status or contact fields (table lt_lead_change,
// scripts/lead-change-migrate.sql). If the table does not exist yet, edits still work; they are
// just not logged, and the reader returns null.
import { prisma } from '@/lib/prisma'
import type { LeadActor, LeadFieldChange } from './leadChangeDiff'

let warned = false
function warnOnce(err: unknown) {
  if (warned) return
  warned = true
  console.warn('[lead-change] lt_lead_change unavailable, changes are not logged:', (err as Error)?.message ?? err)
}

/** Never throws: a failed log must not fail the user's edit. */
export async function recordLeadChanges(
  projectId: string,
  leadId: string,
  actor: LeadActor,
  changes: LeadFieldChange[],
): Promise<void> {
  if (changes.length === 0) return
  try {
    await prisma.ltLeadChange.createMany({
      data: changes.map((c) => ({
        projectId,
        leadId,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        actorType: actor.type,
        actor: actor.name.slice(0, 200),
      })),
    })
  } catch (err) {
    warnOnce(err)
  }
}

export type LeadChangeRow = {
  id: string
  projectId: string
  leadId: string
  field: string
  oldValue: string | null
  newValue: string | null
  actorType: string
  actor: string
  createdAt: Date
}

/** Newest first; null when the table is missing. */
export async function recentLeadChanges(
  projectId: string,
  opts: { take?: number; actorType?: 'client' | 'staff' } = {},
): Promise<LeadChangeRow[] | null> {
  try {
    return await prisma.ltLeadChange.findMany({
      where: { projectId, ...(opts.actorType ? { actorType: opts.actorType } : {}) },
      orderBy: { createdAt: 'desc' },
      take: opts.take ?? 100,
    })
  } catch (err) {
    warnOnce(err)
    return null
  }
}
