// ─── SEO SME — เก็บผล Request Index (Google Indexing API) ต่อบทความ ───
// เก็บใน Project.pushPrefs.indexRequests[articleId] (ไม่แก้ schema) — เขียนฝั่งเซิร์ฟเวอร์เท่านั้น
// อ่าน-merge-เขียนใน transaction เดียว กันทับ key อื่นของ pushPrefs

import { prisma } from '@/lib/prisma'

export interface ProjectIndexRecord { url: string; at: string; ok: boolean; error?: string }

export function parsePushPrefs(v: unknown): Record<string, unknown> {
  if (!v) return {}
  if (typeof v === 'string') { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {} } catch { return {} } }
  if (typeof v === 'object') return v as Record<string, unknown>
  return {}
}

/** จดผลของบทความหนึ่งชิ้น คืน indexRequests ทั้งหมดล่าสุด (ไม่ throw) */
export async function saveProjectIndexRequest(
  projectId: string,
  articleId: string,
  record: ProjectIndexRecord,
): Promise<Record<string, ProjectIndexRecord>> {
  try {
    return await prisma.$transaction(async (tx) => {
      const p = await tx.project.findUnique({ where: { id: projectId }, select: { pushPrefs: true } })
      const prefs = parsePushPrefs(p?.pushPrefs)
      const cur = (prefs.indexRequests && typeof prefs.indexRequests === 'object' ? prefs.indexRequests : {}) as Record<string, ProjectIndexRecord>
      const next = { ...cur, [articleId]: record }
      await tx.project.update({ where: { id: projectId }, data: { pushPrefs: JSON.stringify({ ...prefs, indexRequests: next }) } })
      return next
    })
  } catch {
    return { [articleId]: record }
  }
}
