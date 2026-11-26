// Server side of translate-sources.ts: writes pushPrefs.translateSources under the row lock.
import { prisma } from '@/lib/prisma'
import { updatePrefs } from './prefs-store'
import { TRANSLATE_SOURCES_KEY, addTranslateSources, readTranslateSources } from './translate-sources'

/**
 * Mark articles of this client as translation sources. Ids that are not this client's articles are
 * ignored. Returns the stored list, or null when the client does not exist in this organization.
 */
export async function markTranslateSources(clientId: string, orgId: string, ids: string[]): Promise<string[] | null> {
  const wanted = readTranslateSources(ids)
  const owned = wanted.length
    ? await prisma.uploadArticle.findMany({
        where: { id: { in: wanted }, clientId, organizationId: orgId },
        select: { id: true },
      })
    : []
  const ownedIds = new Set(owned.map((r) => r.id))
  const add = wanted.filter((id) => ownedIds.has(id))
  const out = await updatePrefs(clientId, orgId, (current) => {
    const before = readTranslateSources(current[TRANSLATE_SOURCES_KEY])
    if (add.length === 0) return { result: before }
    const next = addTranslateSources(before, add)
    return { prefs: { ...current, [TRANSLATE_SOURCES_KEY]: next }, result: next }
  })
  return out ? out.result : null
}
