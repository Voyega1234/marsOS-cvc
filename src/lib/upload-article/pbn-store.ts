// ─── PBN Backlinks — หา/สร้างแถวโปรเจกต์ PBN ขององค์กร (ฝั่งเซิร์ฟเวอร์เท่านั้น) ─────────────────

import { prisma } from '@/lib/prisma'
import { PBN_CLIENT_NAME, PBN_KIND, PBN_PREFS_MARK } from './pbn'

/** id ของโปรเจกต์ PBN ขององค์กร — ยังไม่มีก็สร้างให้ (ล็อกต่อองค์กร กันกดพร้อมกันแล้วได้ 2 แถว) */
export async function getOrCreatePbnClientId(orgId: string, userId: string): Promise<string> {
  const found = await findPbnClientId(orgId)
  if (found) return found
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pbn-client:${orgId}`}))`
    const again = await tx.uploadClient.findFirst({
      where: { organizationId: orgId, pushPrefs: { contains: PBN_PREFS_MARK } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (again) return again.id
    const created = await tx.uploadClient.create({
      data: {
        organizationId: orgId,
        name: PBN_CLIENT_NAME,
        website: '',
        pushPrefs: JSON.stringify({ kind: PBN_KIND }),
        createdById: userId,
      },
      select: { id: true },
    })
    return created.id
  })
}

export async function findPbnClientId(orgId: string): Promise<string | null> {
  const row = await prisma.uploadClient.findFirst({
    where: { organizationId: orgId, pushPrefs: { contains: PBN_PREFS_MARK } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return row?.id ?? null
}
