// ─── Upload Article — Internal Link: sanitize + สุ่มเลือกลิงก์ให้แต่ละบทความ ───────
// ฟังก์ชันล้วน ไม่พึ่ง prisma/session — เรียกตรงจาก unit test ได้

import type { UploadInternalLinks, UploadLinkPair } from './types'

const URL_MAX = 500
const KEYWORD_MAX = 200
const MANUAL_MAX = 300
const GSC_MAX = 1000
const EXCLUDED_MAX = 2000
const GSC_SITE_URL_MAX = 300
const LINKS_PER_ARTICLE_RE = /^\d{1,2}(-\d{1,2})?$/
/** กันสระ pool ใหญ่เกินจำเป็นก่อนสุ่ม (ประสิทธิภาพ) */
const POOL_CAP = 200

function sanitizePair(raw: unknown): UploadLinkPair | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const url = typeof r.url === 'string' ? r.url.trim() : ''
  if (!url || url.length > URL_MAX || !/^https?:\/\//i.test(url)) return null
  const keyword = typeof r.keyword === 'string' ? r.keyword.trim().slice(0, KEYWORD_MAX) : ''
  const out: UploadLinkPair = { keyword, url }
  if (typeof r.clicks === 'number' && Number.isFinite(r.clicks)) out.clicks = r.clicks
  return out
}

export interface SanitizeInternalLinksResult {
  value: Partial<UploadInternalLinks>
  error?: string
}

/** sanitize เฉพาะ field ที่ถูกส่งมาจริง (partial update) — คืน error ตัวแรกที่เจอถ้าข้อมูลไม่ผ่าน */
export function sanitizeInternalLinks(input: Partial<UploadInternalLinks>): SanitizeInternalLinksResult {
  const value: Partial<UploadInternalLinks> = {}

  if (input.gscSiteUrl !== undefined) {
    if (typeof input.gscSiteUrl !== 'string' || input.gscSiteUrl.length > GSC_SITE_URL_MAX) {
      return { value, error: 'gscSiteUrl ไม่ถูกต้อง' }
    }
    value.gscSiteUrl = input.gscSiteUrl.trim()
  }

  if (input.linksPerArticle !== undefined) {
    if (typeof input.linksPerArticle !== 'string' || !LINKS_PER_ARTICLE_RE.test(input.linksPerArticle)) {
      return { value, error: 'linksPerArticle ต้องเป็นตัวเลขหรือช่วง เช่น 3 หรือ 3-5' }
    }
    value.linksPerArticle = input.linksPerArticle
  }

  if (input.manual !== undefined) {
    if (!Array.isArray(input.manual) || input.manual.length > MANUAL_MAX) {
      return { value, error: `manual ต้องเป็นลิสต์ไม่เกิน ${MANUAL_MAX} รายการ` }
    }
    value.manual = input.manual.map(sanitizePair).filter((r): r is UploadLinkPair => Boolean(r))
  }

  if (input.gsc !== undefined) {
    if (!Array.isArray(input.gsc) || input.gsc.length > GSC_MAX) {
      return { value, error: `gsc ต้องเป็นลิสต์ไม่เกิน ${GSC_MAX} รายการ` }
    }
    value.gsc = input.gsc.map(sanitizePair).filter((r): r is UploadLinkPair => Boolean(r))
  }

  if (input.excluded !== undefined) {
    if (!Array.isArray(input.excluded) || input.excluded.length > EXCLUDED_MAX) {
      return { value, error: `excluded ต้องเป็นลิสต์ไม่เกิน ${EXCLUDED_MAX} รายการ` }
    }
    value.excluded = input.excluded.filter((v): v is string => typeof v === 'string').map((v) => v.trim().slice(0, URL_MAX)).filter(Boolean)
  }

  if (input.gscFetchedAt !== undefined) {
    if (typeof input.gscFetchedAt === 'string') value.gscFetchedAt = input.gscFetchedAt
  }

  return { value }
}

/** normalize URL ไว้เทียบซ้ำ (origin+pathname ตัด / ท้ายออก, ตัวพิมพ์เล็ก) */
function normalizeUrl(u: string): string {
  try {
    const p = new URL(u)
    return (p.origin + p.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    return u.trim().toLowerCase()
  }
}

/** URL ที่ path ลงท้ายด้วย slug ของบทความปัจจุบัน — ไม่เอามาลิงก์เข้าตัวเอง */
function pathEndsWithSlug(url: string, slug: string): boolean {
  if (!slug) return false
  const s = slug.toLowerCase()
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '').toLowerCase()
    return p === `/${s}` || p.endsWith(`/${s}`)
  } catch {
    return url.toLowerCase().includes(s)
  }
}

function hashSeed(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0
  }
  return h || 1
}

/** mulberry32 — สุ่มเทียม deterministic จาก seed ตัวเลข */
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function parseLinksPerArticle(raw: string): { min: number; max: number } {
  const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(raw || '')
  if (!m) return { min: 3, max: 5 }
  const a = Number(m[1])
  const b = m[2] ? Number(m[2]) : a
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

export interface PickLinksParams {
  keyword: string
  slug: string
  /** URL ของบทความปัจจุบัน (ถ้ามี) — กันลิงก์เข้าตัวเอง */
  excludeUrl?: string
}

/**
 * เลือกลิงก์ภายในให้บทความ 1 ชิ้น: pool = gsc (ที่ไม่ถูกติ๊กออก) + manual (dedupe by url, manual ชนะ)
 * ตัด URL ที่ path ลงท้ายด้วย slug ของบทความเอง แล้วสุ่มแบบ seed จาก keyword ให้ผลเดิมทุกครั้งที่ keyword เดิม
 */
export function pickLinksForKeyword(links: UploadInternalLinks, params: PickLinksParams): UploadLinkPair[] {
  const excludedSet = new Set((links.excluded || []).map(normalizeUrl))
  if (params.excludeUrl) excludedSet.add(normalizeUrl(params.excludeUrl))

  const poolMap = new Map<string, UploadLinkPair>()
  for (const pair of links.gsc || []) {
    const key = normalizeUrl(pair.url)
    if (excludedSet.has(key)) continue
    if (pathEndsWithSlug(pair.url, params.slug)) continue
    poolMap.set(key, pair)
  }
  for (const pair of links.manual || []) {
    const key = normalizeUrl(pair.url)
    if (excludedSet.has(key)) continue
    if (pathEndsWithSlug(pair.url, params.slug)) continue
    poolMap.set(key, pair) // manual ชนะ gsc เมื่อ url ซ้ำกัน
  }

  let pool = Array.from(poolMap.values())
  if (pool.length === 0) return []
  if (pool.length > POOL_CAP) pool = pool.slice(0, POOL_CAP)

  const rand = seededRandom(hashSeed(params.keyword))
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const range = parseLinksPerArticle(links.linksPerArticle)
  const n = Math.min(pool.length, range.min + Math.floor(rand() * (range.max - range.min + 1)))
  return shuffled.slice(0, Math.max(0, n))
}
