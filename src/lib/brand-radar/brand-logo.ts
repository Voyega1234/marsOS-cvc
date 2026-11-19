// Brand logo storage for Brand Radar.
//
// A regular project keeps its logo in Project.logoUrl (shared with the rest of the system). A project created
// inside Brand Radar has no Project row, so its logo lives in the AppSetting key-value table instead.
// Callers must have checked that the user may read or manage this project (requireProjectReader / requireProject).

import { prisma } from '@/lib/prisma'
import { readClientLogo } from '@/lib/upload-article/client-logo'
import { isManualProjectId } from './types'

const KEY_PREFIX = 'brand_radar_logo:'

export function brandLogoKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`
}

export async function getBrandLogo(orgId: string, projectId: string): Promise<string | null> {
  if (isManualProjectId(projectId)) {
    const row = await prisma.appSetting.findUnique({ where: { key: brandLogoKey(projectId) }, select: { value: true } })
    return row ? readClientLogo(row.value) : null
  }
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { logoUrl: true } })
  return project ? readClientLogo(project.logoUrl) : null
}

/** `logo` must already be validated by the caller (validateClientLogoInput). Returns false when the project does not exist. */
export async function setBrandLogo(orgId: string, projectId: string, logo: string | null): Promise<boolean> {
  if (isManualProjectId(projectId)) {
    const key = brandLogoKey(projectId)
    if (logo === null) await prisma.appSetting.deleteMany({ where: { key } })
    else await prisma.appSetting.upsert({ where: { key }, create: { key, value: logo }, update: { value: logo } })
    return true
  }
  const res = await prisma.project.updateMany({ where: { id: projectId, organizationId: orgId }, data: { logoUrl: logo } })
  return res.count > 0
}

/**
 * When each project's logo last changed, for the projects that have one (used as the cache version in the logo URL).
 * The logo data itself is never selected here: it can be up to 40KB per row.
 */
export async function brandLogoVersions(orgId: string, manualIds: string[], idScope: { id?: { in: string[] } }): Promise<Map<string, Date>> {
  const [projects, settings] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: orgId, ...idScope, logoUrl: { startsWith: 'data:image/' } },
      select: { id: true, updatedAt: true },
    }),
    manualIds.length > 0
      ? prisma.appSetting
          .findMany({ where: { key: { in: manualIds.map(brandLogoKey) } }, select: { key: true, updatedAt: true } })
          .catch(() => [] as { key: string; updatedAt: Date }[])
      : Promise.resolve([] as { key: string; updatedAt: Date }[]),
  ])
  const out = new Map<string, Date>()
  for (const p of projects) out.set(p.id, p.updatedAt)
  for (const s of settings) out.set(s.key.slice(KEY_PREFIX.length), s.updatedAt)
  return out
}
