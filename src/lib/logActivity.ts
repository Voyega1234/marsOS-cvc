/**
 * Central activity logger — call after any meaningful state change.
 * Fire-and-forget: never throws, never blocks the response.
 */
import { prisma } from '@/lib/prisma'

export async function logActivity(opts: {
  organizationId: string
  userId: string
  action: string          // e.g. 'CREATE' | 'UPDATE' | 'DELETE' | 'RUN' | 'PUBLISH'
  entityType: string      // e.g. 'Project' | 'Article' | 'Keyword' | 'KeywordResearch'
  entityId: string
  oldValue?: string
  newValue?: string
}): Promise<void> {
  try {
    await prisma.activityLog.create({ data: opts })
  } catch { /* non-fatal */ }
}
