// ─── Upload Article — Internal Link: sanitize + สุ่มเลือกลิงก์ให้แต่ละบทความ ───────
// ฟังก์ชันล้วน ไม่พึ่ง prisma/session — เรียกตรงจาก unit test ได้

import type { UploadInternalLinks, UploadKeyword, UploadLinkPair } from './types'
import { parseWriterSourceName } from './pbn'
import { effectiveArticleStatus } from './duplicates'

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

/**
 * คำเชื่อม/คำถาม/คำเปรียบเทียบที่ไม่บอกหัวข้อ — ไม่นับเป็นคำที่ "ตรงกัน" (ระดับภาษา ใช้ได้ทุกวงการ ห้ามใส่คำเฉพาะธุรกิจ)
 * เช่น "ต่างกันอย่างไร" "ยี่ห้อไหนดี" "ราคาเท่าไหร่" มีในคำค้นทุกเว็บ ถ้านับจะลิงก์ข้ามเรื่อง (บทความโซล่าเซลล์ไปหน้าฟันปลอม)
 */
const STOP_TOKENS = new Set([
  'ที่', 'การ', 'และ', 'หรือ', 'ของ', 'ได้', 'ไหม', 'ไม่', 'มี', 'เป็น', 'ใน', 'กับ', 'ให้', 'จะ', 'คือ', 'อะไร', 'อย่างไร', 'ยังไง',
  'วิธี', 'แบบ', 'เรื่อง', 'ทำ', 'ใช้', 'ดี', 'ราคา', 'รีวิว', 'คน', 'ไป', 'มา', 'ต้อง', 'เท่าไร', 'เท่าไหร่',
  'ทำไม', 'แค่ไหน', 'ยัง', 'ไง', 'บ้าง', 'ได้แก่', 'สรุป',
  'ต่าง', 'กัน', 'ไหน', 'ยี่ห้อ', 'เท่า', 'ไหร่', 'ไร', 'อย่าง', 'เกิด', 'จาก', 'กี่', 'ใคร', 'เหมาะ', 'แนะนำ', 'ปกติ',
  'นี้', 'นั้น', 'แล้ว', 'ควร', 'ก็', 'ถึง', 'ว่า', 'ซึ่ง', 'โดย', 'เพื่อ', 'ตาม', 'ขึ้น', 'ช่วง', 'ล่าสุด', 'ปี',
  'the', 'and', 'or', 'of', 'to', 'in', 'for', 'a', 'an', 'is', 'are', 'how', 'what', 'why', 'when', 'where', 'which', 'who',
  'with', 'without', 'best', 'vs', 'versus', 'near', 'me', 'my', 'your', 'you', 'can', 'do', 'does', 'on', 'at', 'by', 'from',
  'top', 'guide', 'tips', 'review', 'it', 'this', 'that', 'should', 'much', 'many',
])

/** คำอังกฤษพหูพจน์ → เอกพจน์อย่างง่าย (termites = termite) */
function stemToken(t: string): string {
  if (!/^[a-z]+$/.test(t) || t.length <= 3) return t
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1)
  return t
}

let tokenSegmenter: Intl.Segmenter | null | undefined
/** ตัดคำ keyword/ชื่อบทความเป็นชุดคำ (ไทยใช้ Intl.Segmenter) — ตัดคำสั้น/คำเชื่อมทิ้ง */
export function topicTokens(text: string): string[] {
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
    const t = stemToken(w.trim())
    // ตัวเลขล้วน (ปี ราคา จำนวน) ไม่บอกหัวข้อ
    if (t.length >= 2 && !STOP_TOKENS.has(t) && !/^\d+$/.test(t)) out.add(t)
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
export function linkPoolForArticle(
  links: UploadInternalLinks,
  params: { slug: string; excludeUrl?: string; extra?: UploadLinkPair[]; ownKeywords?: string[] },
): UploadLinkPair[] {
  const excludedSet = new Set((links.excluded || []).map(normalizeUrl))
  if (params.excludeUrl) excludedSet.add(normalizeUrl(params.excludeUrl))
  // keyword หลัก/ชื่อบทความนี้เอง ห้ามเป็น anchor ไปหน้าอื่น (แย่งอันดับกันเอง)
  const own = new Set((params.ownKeywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean))
  const seen = new Set<string>()
  const out: UploadLinkPair[] = []
  const gsc = [...(links.gsc || [])].sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
  for (const pair of [...(links.manual || []), ...(params.extra || []), ...gsc]) {
    const key = normalizeUrl(pair.url)
    if (seen.has(key) || excludedSet.has(key)) continue
    if (pathEndsWithSlug(pair.url, params.slug)) continue
    if (own.has(pair.keyword.trim().toLowerCase())) continue
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
  // anchor = keyword หลักของบทความนี้ (ลิงก์ไปหน้าอื่นจะแย่งอันดับกันเอง) — ไม่เอา
  const pool = Array.from(poolMap.values()).filter((p) => p.keyword.trim().toLowerCase() !== ownKeyword)
  const max = parseLinksPerArticle(links.linksPerArticle).max
  return rankLinksByTopic(pool, { keyword: params.keyword, title: params.title }, manualKeys).slice(0, max)
}

/** anchor สำรองต้องยาวอย่างน้อยเท่านี้ (นับตัวอักษรรวมวรรณยุกต์) — ตัดคำสั้นกว้าง ๆ อย่าง "บ้าน" "วงจร" */
const FALLBACK_ANCHOR_MIN = 5

/** วลีย่อยของ keyword ที่เป็นคำติดกัน (ไม่ข้ามช่องว่าง) เรียงยาวไปสั้น — ไทยตัดคำละเอียดเกิน เช่น "แมลงเม่า" = "แมลง"+"เม่า" */
function keywordPhrases(keyword: string): { text: string; tokens: string[] }[] {
  const s = (keyword || '').toLowerCase().trim()
  if (!tokenSegmenter) topicTokens('') // init segmenter
  const out: { text: string; tokens: string[] }[] = []
  for (const chunk of s.split(/\s+/).filter(Boolean)) {
    const words = tokenSegmenter
      ? Array.from(tokenSegmenter.segment(chunk)).filter((seg) => seg.isWordLike).map((seg) => ({ w: seg.segment, i: seg.index }))
      : [{ w: chunk, i: 0 }]
    // วลีต้องเริ่ม/จบตรงขอบคำจริง (ต้นช่วง/ท้ายช่วง หรือติดคำเชื่อม) — กันวลีหั่นกลางคำประสม
    // เช่น "ฟันกับวีเนียร์" จาก "ครอบฟันกับวีเนียร์", "ปลวกในบ้าน" จาก "รังปลวกในบ้าน", "ฟันปลอมมีกี่" ที่ห้อยคำถาม
    const isStop = (k: number) => STOP_TOKENS.has(words[k].w)
    for (let a = 0; a < words.length; a++) {
      if (isStop(a) || (a > 0 && !isStop(a - 1))) continue
      for (let b = a; b < words.length; b++) {
        if (isStop(b) || (b < words.length - 1 && !isStop(b + 1))) continue
        const text = chunk.slice(words[a].i, words[b].i + words[b].w.length)
        out.push({ text, tokens: words.slice(a, b + 1).map((x) => x.w) })
      }
    }
  }
  return out.sort((x, y) => y.text.length - x.text.length)
}

/**
 * pool สำหรับแทรกลิงก์: คู่ที่ตรงหัวข้อ (anchor = keyword เต็ม) ก่อน แล้วตามด้วย anchor สำรอง
 * anchor สำรอง = วลีในคู่ลิงก์ที่มีคำเฉพาะร่วมกับบทความ เช่น คู่ "แมลงเม่า คือปลวกไหม" ในบทความเรื่องแมลงเม่า ใช้วลี "แมลงเม่า"
 * (keyword จาก GSC มักยาวเป็นประโยคค้นหา ไม่โผล่ในเนื้อหาตรงทุกตัว) — วลีที่เป็นแค่คำกว้าง ๆ ไม่ใช้
 */
export function anchorPoolForTopic(
  ranked: UploadLinkPair[],
  topic: { keyword: string; title?: string },
  allPairs: UploadLinkPair[],
): UploadLinkPair[] {
  const weight = topicWeigher(allPairs)
  const topicSet = new Set(topicTokens(`${topic.keyword} ${topic.title ?? ''}`))
  const fallback: UploadLinkPair[] = []
  for (const p of ranked) {
    const full = p.keyword.trim().toLowerCase()
    const pairTokens = topicTokens(p.keyword)
    const seen = new Set<string>()
    for (const ph of keywordPhrases(p.keyword)) {
      if (ph.text === full || seen.has(ph.text) || Array.from(ph.text).length < FALLBACK_ANCHOR_MIN) continue
      const phTokens = ph.tokens.map((t) => stemToken(t))
      if (!phTokens.some((t) => topicSet.has(t) && weight(t) > 0)) continue
      // วลีต้องพาหัวข้อหลักของหน้าปลายทางมาด้วย — "ปลวกในบ้าน" จาก "รังปลวกในบ้าน" ขาด "รัง" = กว้างเกิน
      if (topicCoverage(pairTokens, new Set(phTokens), weight) <= TOPIC_COVER_MIN) continue
      // คำเดียว (เช่น "ศัตรู") หรือคำเดียว + คำเชื่อม (เช่น "ในบ้าน") กว้างเกิน — ต้องเป็นวลีที่มีคำเนื้อหาอย่างน้อย 2 คำ
      const content = ph.tokens.filter((t) => t.length >= 2 && !STOP_TOKENS.has(t))
      if (content.length < 2) continue
      seen.add(ph.text)
      fallback.push({ ...p, keyword: ph.text })
    }
  }
  return [...ranked, ...fallback]
}

const ANCHOR_MAX = 80

/** หน้ารวม/หน้าระบบ (ผู้เขียน หมวด แท็ก หน้าแรก หน้ารวมบล็อก ติดต่อ) — ไม่ใช่หน้าที่ตรงหัวข้อบทความ */
const NON_TOPIC_PATH = /^\/(?:(?:en|th)\/)?(?:(?:blog|news|articles?|contact-us|contact|about-us|about|faqs?|our-review|comparison|reviews?)\/?)?$|\/(?:author|category|tag|page|feed)\//i

export function isTopicPageUrl(url: string): boolean {
  try {
    return !NON_TOPIC_PATH.test(new URL(url).pathname)
  } catch {
    return true
  }
}

/**
 * คำขยายกว้าง ๆ ที่บังเอิญตรงกับชื่อบทความ — ไม่นับเป็นคำที่ตรงหัวข้อ
 * ระดับภาษาเท่านั้น ห้ามใส่คำเฉพาะธุรกิจ (เคยใส่ "จัด/กำจัด/ป้องกัน" จากเว็บปลวก ทำให้ "จัดฟัน" "จัดเบรค" จับคู่ไม่ได้)
 * คำประจำวงการของแต่ละเว็บ (ปลวก, ฟัน, คอนโด) ตัดอัตโนมัติด้วยความถี่ใน pool ของโปรเจกต์นั้น — ดู topicWeigher
 */
export const GENERIC_SHARED = new Set(['ก่อน', 'หลัง', 'เลือก', 'เข้า', 'ออก', 'ง่าย', 'จริง', 'ได้ผล', 'ถาวร', 'รวม', 'สาเหตุ', 'อันตราย', 'แก้', 'ไข', 'สังเกต', 'รู้จัก', 'ตัว'])

/** บทความ/anchor ต้องครอบคลุมน้ำหนักหัวข้อของหน้าปลายทาง "เกิน" สัดส่วนนี้ — ได้แค่ครึ่ง (เช่น "สี" จาก "ฟอกสีฟัน") = แค่บังเอิญมีคำเดียวกัน */
export const TOPIC_COVER_MIN = 0.5

/**
 * น้ำหนักคำ (IDF) จาก pool ลิงก์ของโปรเจกต์นั้นเอง — ไม่ผูกกับวงการ
 * คำที่อยู่ในคู่ลิงก์เกิน 30% (pool ตั้งแต่ 5 คู่) = คำประจำเว็บ น้ำหนัก 0; คำเชื่อม/คำกว้าง น้ำหนัก 0
 */
export function topicWeigher(pairs: UploadLinkPair[]): (t: string) => number {
  const df = new Map<string, number>()
  const withKeyword = pairs.filter((p) => p.keyword.trim())
  for (const p of withKeyword) for (const t of topicTokens(p.keyword)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = withKeyword.length
  return (t: string) => {
    if (GENERIC_SHARED.has(t) || STOP_TOKENS.has(t)) return 0
    const d = df.get(t) ?? 0
    if (n >= 5 && d / n > 0.3) return 0
    return Math.log((n + 1) / Math.max(d, 1))
  }
}

/** สัดส่วนน้ำหนักของ pairTokens ที่อยู่ใน covered (0..1) — pair ที่ไม่มีคำมีน้ำหนักเลย = 0 */
export function topicCoverage(pairTokens: string[], covered: Set<string>, weight: (t: string) => number): number {
  let total = 0
  let hit = 0
  for (const t of pairTokens) {
    const w = weight(t)
    total += w
    if (covered.has(t)) hit += w
  }
  return total > 0 ? hit / total : 0
}

/** คำที่อยู่ในคู่ลิงก์เกิน 30% (pool ตั้งแต่ 5 คู่) — บอกหัวข้อไม่ได้ เช่น "ปลวก" ในเว็บกำจัดปลวก */
export function commonTopicTokens(pairs: UploadLinkPair[]): Set<string> {
  const df = new Map<string, number>()
  const withKeyword = pairs.filter((p) => p.keyword.trim())
  for (const p of withKeyword) for (const t of topicTokens(p.keyword)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = withKeyword.length
  const out = new Set<string>()
  if (n < 5) return out
  df.forEach((d, t) => { if (d / n > 0.3) out.add(t) })
  return out
}

/**
 * คู่ลิงก์ที่ keyword มีคำร่วมกับ keyword/ชื่อบทความ เรียงจากตรงมากสุด — คู่ที่ไม่มีคำร่วมเลยถูกตัดทิ้ง
 * คำที่อยู่ในคู่ลิงก์เกิน 30% (pool ตั้งแต่ 5 คู่) ไม่นับ, anchor ว่างไม่เอา, เสมอกัน = manual ก่อน แล้วคลิกมากก่อน
 */
export function rankLinksByTopic(
  pairs: UploadLinkPair[],
  topic: { keyword: string; title?: string },
  manualKeys: Set<string> = new Set(),
): UploadLinkPair[] {
  const pool = pairs
    // anchor ว่าง / ยาวเป็นย่อหน้า (query จากผู้ช่วย AI ใน GSC เช่น "context: location: ...") ไม่ใช่ keyword
    .filter((p) => p.keyword.trim() && Array.from(p.keyword.trim()).length <= ANCHOR_MAX && isTopicPageUrl(p.url))
    .map((p) => ({ pair: p, manual: manualKeys.has(normalizeUrl(p.url)), tokens: topicTokens(p.keyword) }))
  if (pool.length === 0) return []

  const articleTokens = new Set(topicTokens(`${topic.keyword} ${topic.title ?? ''}`))
  /** คำยิ่งหายากใน pool ยิ่งบอกหัวข้อได้ชัด — คำประจำเว็บ (เกิน 30% ของ pool) และคำกว้างไม่นับ */
  const weight = topicWeigher(pool.map((item) => item.pair))

  return pool
    .map((item) => {
      let score = 0
      for (const t of item.tokens) if (articleTokens.has(t)) score += weight(t)
      // บทความต้องครอบคลุมหัวข้อหลักของหน้าปลายทางอย่างน้อยครึ่ง — มีคำเดียวกันคำเดียวจากคำค้นยาว ๆ ไม่พอ
      return { ...item, score, cover: topicCoverage(item.tokens, articleTokens, weight) }
    })
    .filter((item) => item.score > 0 && item.cover > TOPIC_COVER_MIN)
    .sort((a, b) => b.score - a.score || b.cover - a.cover || Number(b.manual) - Number(a.manual) || (b.pair.clicks ?? 0) - (a.pair.clicks ?? 0))
    .map((item) => item.pair)
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
  wordpressPostId?: string | null
  pushedAt?: Date | string | null
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
    const url = effectiveArticleStatus(r) === 'PUSHED' && r.pushMode === 'publish' && r.wordpressUrl ? r.wordpressUrl : null
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
