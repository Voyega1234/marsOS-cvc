/**
 * หาบทความซ้ำของลูกค้าเดียวกัน (ชื่อ/slug/โพสต์ WordPress เดียวกัน) — ชิป "ซ้ำ" + รายการในหน้าต่างยืนยันลบ
 * ลบแถวในระบบเท่านั้น ไม่เคยลบโพสต์บนเว็บไซต์
 */

/** ฟิลด์ขั้นต่ำที่ใช้เทียบ — DTO และแถว Prisma ใช้ได้ทั้งคู่ */
export interface ArticleDupKey {
  id: string
  title: string
  slug: string | null
  wordpressPostId: string | null
}

/** ตัดช่องว่างหัวท้าย + ตัวพิมพ์เล็ก + ยุบช่องว่างซ้อน */
export function normalizeArticleTitle(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** หางของ slug ฉบับแปล: "-en" / "-th" แล้วตามด้วย "-2", "-3"… ได้ (ดู translatedSlug ใน translate.ts) */
const LANGUAGE_SLUG_TAIL_RE = /-(en|th)(?:-\d+)?$/

/**
 * สอง slug เป็นบทความเดียวกันคนละภาษา: ตัดหางภาษาแล้วตรงกัน และหางภาษาไม่เหมือนกัน
 * ("guide" กับ "guide-th", "guide-en" กับ "guide-th") — ฉบับแปลภาษาเดียวกันสองรอบ ("guide-th" กับ "guide-th-2") ไม่นับ
 */
export function isOtherLanguageVersion(slugA: string | null | undefined, slugB: string | null | undefined): boolean {
  const a = (slugA ?? '').trim()
  const b = (slugB ?? '').trim()
  if (!a || !b || a === b) return false
  const langA = a.match(LANGUAGE_SLUG_TAIL_RE)?.[1] ?? ''
  const langB = b.match(LANGUAGE_SLUG_TAIL_RE)?.[1] ?? ''
  return langA !== langB && a.replace(LANGUAGE_SLUG_TAIL_RE, '') === b.replace(LANGUAGE_SLUG_TAIL_RE, '')
}

/**
 * แถวอื่นที่ซ้ำกับ article: โพสต์ WP เดียวกัน หรือ slug ตรงกัน หรือชื่อเดียวกัน
 * ชื่อเดียวกันไม่นับเมื่อเป็นคนละภาษาของบทความเดียวกัน (ฉบับแปลที่ชื่อไม่เปลี่ยน เช่น ชื่อแบรนด์)
 */
export function duplicatesOf<T extends ArticleDupKey>(article: ArticleDupKey, others: T[]): T[] {
  const title = normalizeArticleTitle(article.title)
  const slug = (article.slug ?? '').trim()
  const postId = article.wordpressPostId
  return others.filter((o) => {
    if (o.id === article.id) return false
    if (postId && o.wordpressPostId && o.wordpressPostId === postId) return true
    if (slug && (o.slug ?? '').trim() === slug) return true
    if (title && normalizeArticleTitle(o.title) === title) return !isOtherLanguageVersion(slug, o.slug)
    return false
  })
}

/** map id → แถวที่ซ้ำ (เฉพาะแถวที่มีซ้ำอย่างน้อย 1) */
export function duplicateMap<T extends ArticleDupKey>(articles: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const a of articles) {
    const dups = duplicatesOf(a, articles)
    if (dups.length > 0) map.set(a.id, dups)
  }
  return map
}

/** ขึ้นเว็บแล้ว (มีโพสต์ หรือเคย push) */
export function isArticlePushed(article: { wordpressPostId?: string | null; pushedAt?: string | Date | null }): boolean {
  return Boolean(article.wordpressPostId || article.pushedAt)
}

/**
 * สถานะที่ใช้แสดง/กรอง: บทความขึ้นเว็บแล้วแต่สถานะถูกทับเป็น REVIEWED/GENERATED (กด "ผ่าน Review" หลัง push — แก้ที่ PATCH แล้ว)
 * นับเป็น PUSHED เหมือนเดิม — แถวเก่าที่หลุดไปแล้วกลับมาอยู่หน้า Publish/Index/Report โดยไม่ต้องแก้ DB
 */
export function effectiveArticleStatus(article: { status: string; wordpressPostId?: string | null; pushedAt?: string | Date | null }): string {
  return (article.status === 'REVIEWED' || article.status === 'GENERATED') && isArticlePushed(article) ? 'PUSHED' : article.status
}

/** where ของ Prisma คู่กับ effectiveArticleStatus: บทความที่ขึ้นเว็บแล้ว (รวมแถวที่สถานะถูกทับ) — ห้ามใช้คู่กับ OR อื่นระดับเดียวกัน */
export const PUSHED_ARTICLE_WHERE = {
  OR: [
    { status: 'PUSHED' },
    { status: { in: ['REVIEWED', 'GENERATED'] }, OR: [{ wordpressPostId: { not: null } }, { pushedAt: { not: null } }] },
  ],
}

/**
 * Upload Article ลบได้ทุกแถว (เจ้าของสั่ง 2026-10-26) — แถวที่ push แล้วลบแค่ในระบบ โพสต์บนเว็บยังอยู่
 * PBN ที่ push แล้วลบไม่ได้: แต่ละแถวผูกประวัติ push ของเว็บ PBN (server กันอีกชั้น)
 */
export function canDeleteArticle(
  article: { wordpressPostId: string | null; pushedAt: string | Date | null },
  pbn: boolean,
): boolean {
  return !pbn || !isArticlePushed(article)
}
