// ─── Upload Article — อ่าน/เขียน UploadClient.pushPrefs (JSON ในคอลัมน์ TEXT เดิม ไม่แก้ schema) ──
// pushPrefs เก็บหลายเรื่องรวมกัน (ค่า push, siteScan, cardSel, keywordPlan, internalLinks)
// หลาย request เขียนพร้อมกันได้ (เช่น บันทึก keyword ระหว่างที่สแกนเว็บ) ทุกการเขียนต้องผ่าน
// updatePrefs ซึ่งล็อกแถวด้วย SELECT ... FOR UPDATE แล้วอ่านค่าล่าสุดก่อนแก้ — กันค่าของอีกฝั่งหาย (lost update)

import { prisma } from '@/lib/prisma'

export type PrefsObject = Record<string, unknown>

/** key หนัก ๆ ที่ไม่ส่งไปกับ UploadClientDTO — หน้า UI โหลดผ่าน route เฉพาะของมันเอง */
export const HEAVY_PREF_KEYS = ['keywordPlan', 'internalLinks'] as const

export function parsePrefs(raw: string | null | undefined): PrefsObject {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as PrefsObject) : {}
  } catch {
    return {}
  }
}

/** อ่าน pushPrefs ล่าสุดของลูกค้า (null = ไม่พบลูกค้าในองค์กรนี้) */
export async function readPrefs(clientId: string, orgId: string): Promise<PrefsObject | null> {
  const row = await prisma.uploadClient.findFirst({ where: { id: clientId, organizationId: orgId }, select: { pushPrefs: true } })
  return row ? parsePrefs(row.pushPrefs) : null
}

/**
 * แก้ pushPrefs แบบล็อกแถว — mutate รับค่าล่าสุด คืน { prefs, result }
 * prefs = undefined แปลว่าไม่ต้องเขียน (เช่น validate ไม่ผ่าน) — คืน null ถ้าไม่พบลูกค้า
 */
export async function updatePrefs<T>(
  clientId: string,
  orgId: string,
  mutate: (current: PrefsObject) => { prefs?: PrefsObject; result: T } | Promise<{ prefs?: PrefsObject; result: T }>,
): Promise<{ result: T; prefs: PrefsObject } | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ pushPrefs: string }>>`
      SELECT "pushPrefs" FROM "plans_seo_pipeline"."UploadClient"
      WHERE "id" = ${clientId} AND "organizationId" = ${orgId}
      FOR UPDATE`
    if (rows.length === 0) return null
    const current = parsePrefs(rows[0].pushPrefs)
    const out = await mutate(current)
    if (out.prefs) {
      await tx.uploadClient.update({ where: { id: clientId }, data: { pushPrefs: JSON.stringify(out.prefs) } })
      return { result: out.result, prefs: out.prefs }
    }
    return { result: out.result, prefs: current }
  }, { timeout: 15_000 })
}
