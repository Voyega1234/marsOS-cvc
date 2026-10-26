// ─── SEO SME — หาบทความซ้ำในโปรเจกต์เดียวกัน + ล้างข้อมูลที่ผูกกับบทความที่ถูกลบ ──
// ใช้ตรรกะเดียวกับ Upload Article (src/lib/upload-article/duplicates.ts) แต่ตาราง Article ของ SME
// ไม่มี wordpressPostId / pushedAt — ใช้ URL ของโพสต์ (wordpressUrl) แทนตัวระบุโพสต์
// ลบแถวในระบบเท่านั้น ไม่เคยลบโพสต์บนเว็บไซต์

import { duplicateMap, duplicatesOf, type ArticleDupKey } from '@/lib/upload-article/duplicates'

export interface SmeArticleDupFields {
  id: string
  title: string
  slug: string | null
  wordpressUrl: string | null
}

/** URL โพสต์รูปเดียวกัน: host ตัวเล็ก, ตัด query/#/ / ท้าย (เช่น ?mars_v=…) — URL เสีย = null */
export function normalizeWpUrl(u: string | null | undefined): string | null {
  const s = (u ?? '').trim()
  if (!s) return null
  try {
    const url = new URL(s)
    let path = url.pathname
    try { path = decodeURIComponent(path) } catch { /* % เสีย — ใช้ path ดิบ */ }
    path = path.replace(/\/+$/, '')
    return `${url.host.toLowerCase()}${path}`
  } catch {
    return null
  }
}

export function toSmeDupKey(a: SmeArticleDupFields): ArticleDupKey {
  return { id: a.id, title: a.title, slug: a.slug, wordpressPostId: normalizeWpUrl(a.wordpressUrl) }
}

/** ขึ้นเว็บแล้ว (มี URL โพสต์ หรือสถานะ push แล้ว/ร่างบน WordPress) */
export function isSmeArticlePushed(a: { wordpressUrl?: string | null; status?: string | null }): boolean {
  return Boolean(a.wordpressUrl) || a.status === 'POSTED' || a.status === 'WORDPRESS_DRAFTED'
}

/** แถวอื่นที่ซ้ำกับ article: โพสต์เดียวกัน หรือ slug ตรงกัน หรือชื่อเดียวกัน */
export function smeDuplicatesOf<T extends SmeArticleDupFields>(article: SmeArticleDupFields, others: T[]): T[] {
  const byId = new Map(others.map((o) => [o.id, o]))
  return duplicatesOf(toSmeDupKey(article), others.map(toSmeDupKey))
    .map((k) => byId.get(k.id))
    .filter((o): o is T => Boolean(o))
}

/** map id → แถวที่ซ้ำ (เฉพาะแถวที่มีซ้ำอย่างน้อย 1) */
export function smeDuplicateMap<T extends SmeArticleDupFields>(articles: T[]): Map<string, T[]> {
  const byId = new Map(articles.map((a) => [a.id, a]))
  const out = new Map<string, T[]>()
  duplicateMap(articles.map(toSmeDupKey)).forEach((dups, id) => {
    out.set(id, dups.map((k) => byId.get(k.id)).filter((o): o is T => Boolean(o)))
  })
  return out
}

/** ตัด key ของบทความที่ถูกลบออกจาก pushPrefs (indexRequests / articleOwners) — key อื่นคงเดิม */
export function pruneArticleFromPrefs(prefs: Record<string, unknown>, articleId: string): Record<string, unknown> | null {
  let changed = false
  const next: Record<string, unknown> = { ...prefs }
  for (const key of ['indexRequests', 'articleOwners'] as const) {
    const map = prefs[key]
    if (map && typeof map === 'object' && !Array.isArray(map) && articleId in (map as Record<string, unknown>)) {
      const copy = { ...(map as Record<string, unknown>) }
      delete copy[articleId]
      next[key] = copy
      changed = true
    }
  }
  return changed ? next : null
}
