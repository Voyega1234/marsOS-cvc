// ─── Upload Article — โหลดแถวบทความสำหรับหน้า list โดยไม่ลากคอลัมน์หนักที่ list ไม่ได้ใช้ ───
// ผลลัพธ์ต้องเท่ากับ findMany เต็มแถวแล้วผ่าน toUploadArticleDTO(row, false) ทุกตัวอักษร:
//  - จำนวนคำยังนับด้วย countWords ตัวเดิมใน serialize.ts จาก htmlContent || sourceHtml (ไม่นับใน SQL)
//  - sourceHtml ดึงเฉพาะแถวที่ htmlContent ว่าง (null หรือ '') เพราะแถวอื่น DTO ไม่ได้อ่าน
//  - ปกแบบ data URI (~300KB ต่อรูป) ไม่ดึงเลย เพราะ DTO ของ list ตัดทิ้งเป็น null อยู่แล้ว
// ลำดับแถวมาจาก query หลัก (where + orderBy เดิม) เท่านั้น

import type { Prisma, PrismaClient } from '@prisma/client'
import type { UploadArticleRow } from './serialize'

const LIST_SELECT = {
  id: true,
  clientId: true,
  title: true,
  sourceType: true,
  sourceName: true,
  outputMode: true,
  htmlContent: true,
  seoTitle: true,
  metaDescription: true,
  slug: true,
  coverAlt: true,
  status: true,
  pushMode: true,
  wordpressUrl: true,
  wordpressPostId: true,
  pushError: true,
  pushedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

/** แถวที่ htmlContent ว่างแบบเดียวกับ `row.htmlContent || row.sourceHtml` ใน JS (null และ '' ตกไปใช้ sourceHtml) */
const EMPTY_HTML_CONTENT: Prisma.UploadArticleWhereInput = { OR: [{ htmlContent: null }, { htmlContent: '' }] }

/** ปกที่ DTO ของ list ส่งกลับ = ทุกค่าที่ไม่ได้ขึ้นต้นด้วย `data:` (ปก null ไม่ติดเงื่อนไขนี้ และ DTO ให้ null อยู่แล้ว) */
const NON_DATA_COVER: Prisma.UploadArticleWhereInput = { NOT: { coverImageUrl: { startsWith: 'data:' } } }

export type UploadArticleListDb = Pick<PrismaClient, 'uploadArticle'>

/**
 * แถวบทความของหน้า list เรียง updatedAt ใหม่ไปเก่า — ส่งเข้า toUploadArticleDTO(row, false) ได้ทันที
 * `where` ต้องจำกัด organizationId + clientId มาแล้ว (query เสริมทุกตัวใช้ where เดิมครอบไว้เสมอ)
 */
export async function loadUploadArticleListRows(
  db: UploadArticleListDb,
  where: Prisma.UploadArticleWhereInput,
): Promise<UploadArticleRow[]> {
  const [base, sourceRows, coverRows] = await Promise.all([
    db.uploadArticle.findMany({ where, orderBy: { updatedAt: 'desc' }, select: LIST_SELECT }),
    db.uploadArticle.findMany({ where: { AND: [where, EMPTY_HTML_CONTENT] }, select: { id: true, sourceHtml: true } }),
    db.uploadArticle.findMany({ where: { AND: [where, NON_DATA_COVER] }, select: { id: true, coverImageUrl: true } }),
  ])

  const sourceById = new Map(sourceRows.map(r => [r.id, r.sourceHtml]))
  const coverById = new Map(coverRows.map(r => [r.id, r.coverImageUrl]))

  // สาม query ไม่ได้อยู่ใน snapshot เดียวกัน — แถวที่ต้องใช้ sourceHtml แต่ query เสริมไม่เจอ
  // (ถูกแก้/ลบระหว่างทาง) อ่านซ้ำรายตัว; ถ้าหายไปแล้วจริงก็ตัดออกจาก list
  const missing = base.filter(r => !r.htmlContent && !sourceById.has(r.id)).map(r => r.id)
  const refetched = new Map<string, { htmlContent: string | null; sourceHtml: string }>()
  if (missing.length > 0) {
    const rows = await db.uploadArticle.findMany({
      where: { AND: [where, { id: { in: missing } }] },
      select: { id: true, htmlContent: true, sourceHtml: true },
    })
    for (const r of rows) refetched.set(r.id, { htmlContent: r.htmlContent, sourceHtml: r.sourceHtml })
  }

  const out: UploadArticleRow[] = []
  for (const r of base) {
    let htmlContent = r.htmlContent
    let sourceHtml = ''
    if (!htmlContent) {
      const direct = sourceById.get(r.id)
      if (direct !== undefined) {
        sourceHtml = direct
      } else {
        const again = refetched.get(r.id)
        if (!again) continue
        htmlContent = again.htmlContent
        sourceHtml = again.sourceHtml
      }
    }
    out.push({ ...r, htmlContent, sourceHtml, coverImageUrl: coverById.get(r.id) ?? null })
  }
  return out
}
