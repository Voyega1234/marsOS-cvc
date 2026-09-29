// ─── Upload Article — Internal Link: sanitize + สุ่มเลือกลิงก์ให้แต่ละบทความ ───────
// ฟังก์ชันล้วน ไม่พึ่ง prisma/session — เรียกตรงจาก unit test ได้

import type { UploadInternalLinks, UploadKeyword, UploadLinkPair } from './types'
import { parseWriterSourceName } from './pbn'

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
export function normalizeUrl(u: string): string {
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

/** ลิงก์ทั้งหมดที่ใช้ได้กับบทความนี้ (ตัด excluded + ลิงก์เข้าตัวเอง) — manual ก่อน แล้ว extra (บทความในระบบ) แล้ว gsc เรียงตามคลิกมากไปน้อย */
export function linkPoolForArticle(links: UploadInternalLinks, params: { slug: string; excludeUrl?: string; extra?: UploadLinkPair[] }): UploadLinkPair[] {
  const excludedSet = new Set((links.excluded || []).map(normalizeUrl))
  if (params.excludeUrl) excludedSet.add(normalizeUrl(params.excludeUrl))
  const seen = new Set<string>()
  const out: UploadLinkPair[] = []
  const gsc = [...(links.gsc || [])].sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
  for (const pair of [...(links.manual || []), ...(params.extra || []), ...gsc]) {
    const key = normalizeUrl(pair.url)
    if (seen.has(key) || excludedSet.has(key)) continue
    if (pathEndsWithSlug(pair.url, params.slug)) continue
    seen.add(key)
    out.push(pair)
  }
  return out
}

/** จำนวนลิงก์สูงสุดต่อบทความจากค่า "3-5" / "3" */
export function maxLinksPerArticle(raw: string): number {
  return parseLinksPerArticle(raw).max
}

export interface PickLinksParams {
  keyword: string
  slug: string
  /** URL ของบทความปัจจุบัน (ถ้ามี) — กันลิงก์เข้าตัวเอง */
  excludeUrl?: string
  /** ลิงก์บทความในระบบ (auto) — แทรกแทรกระหว่าง manual กับ gsc */
  extra?: UploadLinkPair[]
}

/**
 * เลือกลิงก์ภายในให้บทความ 1 ชิ้น: pool = gsc (ที่ไม่ถูกติ๊กออก) + extra (บทความในระบบ) + manual (dedupe by url, manual ชนะ)
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
  for (const pair of params.extra || []) {
    const key = normalizeUrl(pair.url)
    if (excludedSet.has(key)) continue
    if (pathEndsWithSlug(pair.url, params.slug)) continue
    poolMap.set(key, pair) // extra ชนะ gsc เมื่อ url ซ้ำกัน
  }
  for (const pair of links.manual || []) {
    const key = normalizeUrl(pair.url)
    if (excludedSet.has(key)) continue
    if (pathEndsWithSlug(pair.url, params.slug)) continue
    poolMap.set(key, pair) // manual ชนะ extra/gsc เมื่อ url ซ้ำกัน
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

// ─── "จากบทความในระบบ" — บทความที่เขียน/นำเข้าในโปรเจกต์นี้ ใช้เป็นลิงก์ภายในอัตโนมัติ ───────

const ARTICLE_ROWS_MAX = 500

/** field ที่ต้องอ่านจาก UploadArticle เพื่อแปลงเป็นลิงก์ — ไม่ผูกกับ prisma type ตรง ๆ ให้เรียกจาก unit test ได้ */
export interface ArticleLinkSourceRow {
  id: string
  title: string
  sourceName: string
  status: string
  pushMode: string | null
  wordpressUrl: string | null
  createdAt: Date | string
}

export interface ArticleLinkRow {
  articleId: string
  title: string
  /** anchor text: keyword จริงถ้าเขียนจากแผน keyword, ไม่งั้นใช้ชื่อบทความ */
  keyword: string
  /** null = ยังไม่เผยแพร่แบบ Publish จริง ยังใช้เป็นลิงก์ไม่ได้ */
  url: string | null
  status: string
  createdAt: string
}

/** แปลงแถว UploadArticle → รายการลิงก์ภายใน (rows ควรเรียง createdAt ใหม่สุดก่อน + จำกัดจำนวนมาจากผู้เรียกแล้ว) */
export function articleLinkRows(rows: ArticleLinkSourceRow[], keywordPlan: UploadKeyword[]): ArticleLinkRow[] {
  const planById = new Map(keywordPlan.map((k) => [k.id, k]))
  return rows.slice(0, ARTICLE_ROWS_MAX).map((r) => {
    const parsed = parseWriterSourceName(r.sourceName)
    const keyword = (parsed && planById.get(parsed.keywordId)?.keyword) || r.title
    const url = r.status === 'PUSHED' && r.pushMode === 'publish' && r.wordpressUrl ? r.wordpressUrl : null
    return {
      articleId: r.id,
      title: r.title,
      keyword,
      url,
      status: r.status,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : r.createdAt.toISOString(),
    }
  })
}

/** เฉพาะแถวที่เผยแพร่แล้วจริง (มี url) — ใช้เติม pool ลิงก์ภายใน */
export function articleLinkPairs(rows: ArticleLinkRow[]): UploadLinkPair[] {
  return rows
    .filter((r): r is ArticleLinkRow & { url: string } => Boolean(r.url))
    .map((r) => ({ keyword: r.keyword, url: r.url }))
}
