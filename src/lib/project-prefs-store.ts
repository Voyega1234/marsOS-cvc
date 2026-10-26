// ─── SEO SME — อ่าน/เขียน Project.pushPrefs (JSON ในคอลัมน์ TEXT เดิม ไม่แก้ schema) ──
// pushPrefs เก็บหลายเรื่องรวมกัน (excludeCards, siteScan, indexRequests, ownerTags, articleOwners ฯลฯ)
// การเขียนฝั่งเซิร์ฟเวอร์ต้องผ่าน updateProjectPrefs ซึ่งล็อกแถวด้วย SELECT ... FOR UPDATE แล้วอ่านค่าล่าสุดก่อนแก้
// — กันค่าของอีก request หาย (lost update) แบบเดียวกับ Upload Article (src/lib/upload-article/prefs-store.ts)

import { prisma } from '@/lib/prisma'
import { parsePushPrefs } from '@/lib/project-index-requests'

export type ProjectPrefs = Record<string, unknown>

/**
 * แก้ pushPrefs ของโปรเจกต์แบบล็อกแถว — mutate รับค่าล่าสุด คืน { prefs, result }
 * prefs = undefined แปลว่าไม่ต้องเขียน (เช่น validate ไม่ผ่าน) — คืน null ถ้าไม่พบโปรเจกต์ในองค์กรนี้
 */
export async function updateProjectPrefs<T>(
  projectId: string,
  orgId: string,
  mutate: (current: ProjectPrefs) => { prefs?: ProjectPrefs; result: T } | Promise<{ prefs?: ProjectPrefs; result: T }>,
): Promise<{ result: T; prefs: ProjectPrefs } | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ pushPrefs: string }>>`
      SELECT "pushPrefs" FROM "plans_seo_pipeline"."Project"
      WHERE "id" = ${projectId} AND "organizationId" = ${orgId}
      FOR UPDATE`
    if (rows.length === 0) return null
    const current = parsePushPrefs(rows[0].pushPrefs)
    const out = await mutate(current)
    if (out.prefs) {
      await tx.project.update({ where: { id: projectId }, data: { pushPrefs: JSON.stringify(out.prefs) } })
      return { result: out.result, prefs: out.prefs }
    }
    return { result: out.result, prefs: current }
  }, { timeout: 15_000 })
}

/**
 * key ของ pushPrefs ที่เขียนฝั่งเซิร์ฟเวอร์เท่านั้น — PUT /api/projects/[id] ต้องทิ้งค่าที่ client ส่งมา
 * (สำเนาเก่าในแท็บ Push/Article Lab ส่งกลับมาทับผลจริงไม่ได้)
 */
export const SERVER_OWNED_PREF_KEYS = ['indexRequests', 'siteScan', 'ownerTags', 'articleOwners'] as const

export function stripServerOwnedPrefs(incoming: ProjectPrefs): ProjectPrefs {
  const out = { ...incoming }
  for (const k of SERVER_OWNED_PREF_KEYS) delete out[k]
  return out
}
