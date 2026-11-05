// แถวเงาของ "เขียนใหม่ด้วย AI" (sourceType 'ai-rewrite', sourceName 'rw:<id บทความเดิม>', status WRITING)
import { prisma } from '@/lib/prisma'
import { WRITER_STALE_MS } from '@/lib/upload-article/writer'

export const REWRITE_SOURCE_TYPE = 'ai-rewrite'

/** ใส่ใน where ของรายการ/นับ/ลิงก์ภายใน — แถวเงาห้ามโผล่ให้ใครเห็น */
export const NOT_REWRITE_SHADOW = { sourceType: { not: REWRITE_SOURCE_TYPE } } as const

/** แถวเงาที่ยังสด (กำลังเขียนอยู่จริง) ของบทความนี้ — ไม่มี = null */
export async function freshRewriteShadow(articleId: string, orgId: string) {
  return prisma.uploadArticle.findFirst({
    where: {
      organizationId: orgId,
      sourceType: REWRITE_SOURCE_TYPE,
      sourceName: `rw:${articleId}`,
      status: 'WRITING',
      updatedAt: { gt: new Date(Date.now() - WRITER_STALE_MS) },
    },
    select: { id: true, createdAt: true },
  })
}

/** แถวสำรองของ "เขียนใหม่ด้วย AI" — แถวเดียวต่อบทความ (sourceType เดียวกับแถวเงา จึงถูก NOT_REWRITE_SHADOW กรองออกเหมือนกัน; ไม่ใช่ WRITING จึงไม่นับเป็นล็อก) */
export const rewriteBackupName = (articleId: string) => `rw-backup:${articleId}`

export async function findRewriteBackup(articleId: string, orgId: string) {
  return prisma.uploadArticle.findFirst({
    where: { organizationId: orgId, sourceType: REWRITE_SOURCE_TYPE, sourceName: rewriteBackupName(articleId) },
    select: { id: true, sourceHtml: true, htmlContent: true, metaDescription: true, createdAt: true },
  })
}

/** PUSHING ที่ค้างเกินนี้ถือว่าหมดอายุ (ฟังก์ชัน push ถูกตัดกลางทาง) — ใช้ร่วมกับ push route */
export const PUSH_LOCK_MS = 6 * 60 * 1000
