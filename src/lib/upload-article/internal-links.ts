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

/** คำเชื่อม/คำถามที่ไม่บอกหัวข้อ — ไม่นับเป็นคำที่ "ตรงกัน" */
const STOP_TOKENS = new Set([
  'ที่', 'การ', 'และ', 'หรือ', 'ของ', 'ได้', 'ไหม', 'ไม่', 'มี', 'เป็น', 'ใน', 'กับ', 'ให้', 'จะ', 'คือ', 'อะไร', 'อย่างไร', 'ยังไง',
  'วิธี', 'แบบ', 'เรื่อง', 'ทำ', 'ใช้', 'ดี', 'ราคา', 'รีวิว', 'คน', 'ไป', 'มา', 'ต้อง', 'เท่าไร', 'เท่าไหร่',
  'the', 'and', 'or', 'of', 'to', 'in', 'for', 'a', 'an', 'is', 'how', 'what', 'with', 'best',
])

let tokenSegmenter: Intl.Segmenter | null | undefined
/** ตัดคำ keyword/ชื่อบทความเป็นชุดคำ (ไทยใช้ Intl.Segmenter) — ตัดคำสั้น/คำเชื่อมทิ้ง */
function topicTokens(text: string): string[] {
  const out = new Set<string>()
  const s = (text || '').toLowerCase()
  if (tokenSegmenter === undefined) {
    try {
      tokenSegmenter = new Intl.Segmenter('th', { granularity: 'word' })
    } catch {
      tokenSegmenter = null
    }
  }
  const words = tokenSegmenter
    ? Array.from(tokenSegmenter.segment(s)).filter((seg) => seg.isWordLike).map((seg) => seg.segment)
    : s.split(/[^a-z0-9฀-๿]+/)
  for (const w of words) {
    const t = w.trim()
    if (t.length >= 2 && !STOP_TOKENS.has(t)) out.add(t)
  }
  return Array.from(out)
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
  /** ชื่อบทความ (ถ้ามี) — ใช้ร่วมกับ keyword หาลิงก์ที่หัวข้อตรงกัน */
  title?: string
  slug: string
  /** URL ของบทความปัจจุบัน (ถ้ามี) — กันลิงก์เข้าตัวเอง */
  excludeUrl?: string
  /** ลิงก์บทความในระบบ (auto) — แทรกแทรกระหว่าง manual กับ gsc */
  extra?: UploadLinkPair[]
}

/**
 * เลือกลิงก์ภายในให้บทความ 1 ชิ้น: pool = gsc (ที่ไม่ถูกติ๊กออก) + extra (บทความในระบบ) + manual (dedupe by url, manual ชนะ)
 * ตัด URL ที่ path ลงท้ายด้วย slug ของบทความเอง
 *
 * เลือกเฉพาะคู่ที่ keyword ตรงหัวข้อบทความ (มีคำร่วมกับ keyword/ชื่อบทความ) เรียงจากตรงมากสุด — ไม่สุ่มแล้ว
 * เดิมสุ่มจากทั้ง pool ทำให้ได้ลิงก์ไม่เกี่ยวกับบทความ (เจ้าของแจ้ง 2026-10-22) — ตรงไม่พอ = ได้ลิงก์น้อยกว่าที่ตั้ง ดีกว่ายัดลิงก์มั่ว
 * คำที่อยู่ในคู่ลิงก์เกือบทุกคู่ (เช่น "ปลวก" ในเว็บกำจัดปลวก) ไม่นับ เพราะไม่ได้บอกว่าตรงหัวข้อ
 * คู่ที่ไม่มี keyword (anchor ว่าง) ไม่เอา — เดิม anchor ว่างถูกแทนด้วย keyword หลักของบทความเอง ลิงก์ keyword ตัวเองไปหน้าอื่น
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

  const ownKeyword = params.keyword.trim().toLowerCase()
  const manualKeys = new Set((links.manual || []).map((p) => normalizeUrl(p.url)))
  const pool = Array.from(poolMap.values())
    // anchor ว่าง หรือ anchor = keyword หลักของบทความนี้ (ลิงก์ไปหน้าอื่นจะแย่งอันดับกันเอง) — ไม่เอา
    .filter((p) => p.keyword.trim() && p.keyword.trim().toLowerCase() !== ownKeyword)
    .map((p) => ({ pair: p, manual: manualKeys.has(normalizeUrl(p.url)), tokens: topicTokens(p.keyword) }))
  if (pool.length === 0) return []

  const articleTokens = new Set(topicTokens(`${params.keyword} ${params.title ?? ''}`))
  const df = new Map<string, number>()
  for (const item of pool) for (const t of item.tokens) df.set(t, (df.get(t) ?? 0) + 1)
  const n = pool.length
  /** คำยิ่งหายากใน pool ยิ่งบอกหัวข้อได้ชัด — คำที่อยู่ในคู่ลิงก์เกิน 30% (pool ตั้งแต่ 5 คู่) ไม่นับ */
  const weight = (t: string) => {
    const d = df.get(t) ?? 0
    if (!d || (n >= 5 && d / n > 0.3)) return 0
    return Math.log((n + 1) / d)
  }

  const scored = pool
    .map((item) => {
      let score = 0
      for (const t of item.tokens) if (articleTokens.has(t)) score += weight(t)
      return { ...item, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.manual) - Number(a.manual) || (b.pair.clicks ?? 0) - (a.pair.clicks ?? 0))

  const max = parseLinksPerArticle(links.linksPerArticle).max
  return scored.slice(0, max).map((item) => item.pair)
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
