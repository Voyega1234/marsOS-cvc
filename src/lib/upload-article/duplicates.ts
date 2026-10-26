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

/** แถวอื่นที่ซ้ำกับ article: โพสต์ WP เดียวกัน หรือ slug ตรงกัน หรือชื่อเดียวกัน */
export function duplicatesOf<T extends ArticleDupKey>(article: ArticleDupKey, others: T[]): T[] {
  const title = normalizeArticleTitle(article.title)
  const slug = (article.slug ?? '').trim()
  const postId = article.wordpressPostId
  return others.filter((o) => {
    if (o.id === article.id) return false
    if (postId && o.wordpressPostId && o.wordpressPostId === postId) return true
    if (slug && (o.slug ?? '').trim() === slug) return true
    if (title && normalizeArticleTitle(o.title) === title) return true
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
export function isArticlePushed(article: { wordpressPostId: string | null; pushedAt: string | Date | null }): boolean {
  return Boolean(article.wordpressPostId || article.pushedAt)
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
