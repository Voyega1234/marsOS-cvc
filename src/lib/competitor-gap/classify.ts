/**
 * Competitor Gap — จัดประเภทหน้า + วัดความเกี่ยวข้องเชิงแข่งขัน (ชั้น "โค้ด" ต้นทุน AI = 0)
 *
 * ใช้ URL + Title + H1 + H2 + Schema + breadcrumb ประกอบกัน — ไม่ตัดสินจาก URL อย่างเดียว
 * หน้าที่กฎยังไม่มั่นใจจะถูกส่งต่อให้ AI เป็นชุด (ดู aiClassify.ts)
 */

import { segmentWords } from '@/lib/wordgod/text/thai'
import type { PageRecord, PageType } from './types'

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'you', 'your', 'our', 'are', 'was', 'have',
  'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'is', 'it', 'as', 'be', 'or', 'we',
  'และ', 'ของ', 'ที่', 'ใน', 'กับ', 'จาก', 'เป็น', 'การ', 'ความ', 'ได้', 'ให้', 'มี', 'ไม่', 'ก็',
  'คือ', 'จะ', 'ด้วย', 'แล้ว', 'อยู่', 'นี้', 'นั้น', 'ๆ', 'เรา', 'คุณ', 'ทุก', 'ทั้ง', 'อย่าง',
])

/**
 * คำที่พบได้ทุกวงการ — เจอแล้วพิสูจน์ไม่ได้ว่าคีย์เวิร์ดอยู่ในธุรกิจเดียวกัน
 * เช่น "ทำ" ใน "รับทำ seo" กับ "ร้านทำผม" เป็นคำเดียวกันแต่คนละธุรกิจ
 */
const GENERIC_TOKENS = new Set([
  'ทำ', 'รับ', 'รับทำ', 'ร้าน', 'ราคา', 'ถูก', 'ดี', 'ที่สุด', 'ใกล้', 'ฉัน', 'ใหม่', 'ฟรี',
  'วิธี', 'แนะนำ', 'สมัคร', 'งาน', 'บริษัท', 'แบบ', 'เปิด', 'หา', 'ขาย', 'ซื้อ', 'ครบ',
  'ไทย', 'thailand', 'thai', 'service', 'services', 'best', 'cheap', 'near', 'top', 'free',
  'how', 'what', 'why', 'new', 'price', 'cost',
])

/** true = คำนี้กว้างเกินกว่าจะใช้เป็นหลักฐานความเกี่ยวข้อง */
export function isGenericToken(token: string): boolean {
  return GENERIC_TOKENS.has(token)
}

export function tokens(text: string): string[] {
  return segmentWords(text)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

function pageText(p: PageRecord): string {
  return [p.path.replace(/[-_/]+/g, ' '), p.title, p.h1, p.h2.join(' ')].join(' ')
}

// ── ประเภทหน้า (deterministic) ───────────────────────────────────────────────

interface Rule {
  type: PageType
  path?: RegExp
  text?: RegExp
  schema?: string[]
  weight: number
}

const RULES: Rule[] = [
  { type: 'contact',   path: /\/(contact|contact-us|ติดต่อ|ติดต่อเรา|get-in-touch)(\/|$)/i, text: /^(ติดต่อเรา|contact us|contact)$/i, weight: 3 },
  { type: 'about',     path: /\/(about|about-us|เกี่ยวกับ|เกี่ยวกับเรา|company|our-story|team)(\/|$)/i, schema: ['AboutPage'], weight: 3 },
  { type: 'career',    path: /\/(career|careers|jobs|job|ร่วมงาน|สมัครงาน|recruit)(\/|$)/i, weight: 3 },
  { type: 'legal',     path: /\/(privacy|terms|policy|cookie|disclaimer|นโยบาย|เงื่อนไข|ข้อตกลง)(\/|$)/i, weight: 3 },
  { type: 'case-study',path: /\/(case-study|case-studies|portfolio|works|ผลงาน|เคส|success-stor)/i, text: /(case study|กรณีศึกษา|ผลงานลูกค้า|success story)/i, weight: 3 },
  { type: 'tool',      path: /\/(calculator|calc|tool|tools|estimator|quote|เครื่องมือ|คำนวณ)/i, text: /(คำนวณ|calculator|เครื่องคิด|ประเมินราคา)/i, weight: 3 },
  { type: 'glossary',  path: /\/(glossary|dictionary|knowledge|คำศัพท์|ศัพท์|สาระ|faq)/i, schema: ['FAQPage', 'DefinedTermSet'], weight: 2 },
  { type: 'route',     path: /\/(route|routes|เส้นทาง|shipping-from|from-.+-to-.+)/i, text: /((จาก|from)\s*\S+\s*(ไป|to|→|-)\s*\S+)/i, weight: 3 },
  { type: 'location',  path: /\/(location|locations|branch|branches|area|areas|สาขา|พื้นที่|จังหวัด|เขต|in-[a-z-]+)(\/|$)/i, schema: ['LocalBusiness', 'Place'], weight: 2 },
  { type: 'industry',  path: /\/(industry|industries|solutions|sector|อุตสาหกรรม|กลุ่มธุรกิจ)/i, weight: 2 },
  { type: 'article',   path: /\/(blog|news|article|articles|post|posts|บทความ|ข่าว)(\/|$)/i, schema: ['Article', 'BlogPosting', 'NewsArticle'], weight: 3 },
  { type: 'guide',     path: /\/(guide|guides|how-to|howto|tutorial|คู่มือ|วิธี|แนะนำ)/i, text: /(คู่มือ|how to|วิธีการ|ครบจบ|ฉบับสมบูรณ์|ultimate guide)/i, weight: 2 },
  { type: 'product',   path: /\/(product|products|shop|store|สินค้า|ผลิตภัณฑ์)(\/|$)/i, schema: ['Product', 'Offer'], weight: 3 },
  { type: 'category',  path: /\/(category|categories|collection|หมวดหมู่|หมวด|tag)(\/|$)/i, schema: ['CollectionPage', 'ItemList'], weight: 2 },
  { type: 'landing',   path: /\/(lp|landing|promotion|promo|campaign|โปรโมชั่น|โปรโมชัน)(\/|$)/i, weight: 2 },
  { type: 'service',   path: /\/(service|services|solution|บริการ|รับ[ก-๙]+|งาน[ก-๙]+)(\/|$)/i, schema: ['Service'], weight: 3 },
]

const COMMERCIAL_TYPES: PageType[] = ['service', 'product', 'category', 'location', 'route', 'industry', 'landing', 'homepage']
const CONTENT_TYPES: PageType[] = ['article', 'guide', 'case-study', 'glossary', 'tool']
const NON_SEO_TYPES: PageType[] = ['about', 'contact', 'career', 'legal']

/**
 * หัวข้อที่ข้อความบอกว่าเป็น "งานบริการ" เช่น "รับทำ Backlink", "บริการดูแลเว็บ"
 * ใช้ตอนแนะนำหน้าใหม่ — คู่แข่งอาจวางหน้าแบบนี้ไว้ใต้ /products/ แต่หน้าที่เราควรสร้างคือหน้าบริการ
 */
const SERVICE_LABEL = /(รับทำ|รับจ้าง|รับ[ก-๙]{2,}|บริการ|ให้เช่า|ดูแล|ออกแบบ|service)/i

export function labelLooksLikeService(label: string): boolean {
  return SERVICE_LABEL.test(label)
}

export function isCommercialType(t: PageType): boolean { return COMMERCIAL_TYPES.includes(t) }
export function isContentType(t: PageType): boolean { return CONTENT_TYPES.includes(t) }

export interface ClassifyResult {
  type: PageType
  confident: boolean
}

export function classifyPageByRules(p: PageRecord): ClassifyResult {
  if (p.path === '/' || p.path === '') return { type: 'homepage', confident: true }

  const text = [p.title, p.h1, p.h2.slice(0, 6).join(' ')].join(' ')
  const scores = new Map<PageType, number>()
  const bump = (t: PageType, n: number) => scores.set(t, (scores.get(t) ?? 0) + n)

  for (const rule of RULES) {
    if (rule.path?.test(p.path)) bump(rule.type, rule.weight)
    if (rule.text?.test(text)) bump(rule.type, rule.weight - 1)
    if (rule.schema && p.schemaTypes.some(s => rule.schema!.includes(s))) bump(rule.type, rule.weight)
  }

  // สัญญาณเสริม: มีวันที่เผยแพร่ + เนื้อหายาว = แนวบทความ
  if (p.publishedDate && p.wordCount > 400) bump('article', 2)
  if (p.schemaTypes.includes('Article') || p.schemaTypes.includes('BlogPosting')) bump('article', 2)
  if (p.schemaTypes.includes('BreadcrumbList') && /blog|news|บทความ/i.test(p.path)) bump('article', 1)

  let best: PageType = 'other'
  let bestScore = 0
  let second = 0
  for (const [t, s] of Array.from(scores.entries())) {
    if (s > bestScore) { second = bestScore; bestScore = s; best = t }
    else if (s > second) second = s
  }

  const confident = bestScore >= 3 && bestScore - second >= 1
  return { type: bestScore > 0 ? best : 'other', confident }
}

// ── ความเกี่ยวข้องเชิงแข่งขัน ────────────────────────────────────────────────

export interface Vocabulary {
  /** token → น้ำหนัก (มาจาก keyword เป้าหมาย + หัวข้อที่ตลาดใช้จริงบน SERP) */
  weights: Map<string, number>
  keywordTokens: string[]
}

export function buildVocabulary(keyword: string, marketTitles: string[]): Vocabulary {
  const weights = new Map<string, number>()
  const kwTokens = tokens(keyword)
  for (const t of kwTokens) weights.set(t, 5)

  const freq = new Map<string, number>()
  for (const title of marketTitles) {
    const uniq = Array.from(new Set(tokens(title)))
    for (const t of uniq) freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  const sorted = Array.from(freq.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120)
  for (const [t, n] of sorted) {
    if (!weights.has(t)) weights.set(t, Math.min(3, 1 + n / 5))
  }
  return { weights, keywordTokens: kwTokens }
}

/** 0–1 : หน้านี้สนับสนุนหัวข้อ/ธุรกิจของ keyword เป้าหมายแค่ไหน */
export function scoreRelevance(p: PageRecord, vocab: Vocabulary): number {
  const ts = new Set(tokens(pageText(p)))
  if (ts.size === 0) return 0
  let hit = 0
  let max = 0
  for (const [t, w] of Array.from(vocab.weights.entries())) {
    max += w
    if (ts.has(t)) hit += w
  }
  if (max === 0) return 0
  const overlap = hit / max
  // normalize: แตะคำหลักไม่กี่คำก็ถือว่าเกี่ยว — ไม่ต้องตรงทั้งคลัง
  return Math.max(0, Math.min(1, overlap * 6))
}

export const RELEVANCE_THRESHOLD = 0.16

export function decideRelevant(p: PageRecord, score: number): boolean {
  if (!p.indexable) return false
  if (NON_SEO_TYPES.includes(p.pageType)) return false
  if (p.wordCount < 80 && !isCommercialType(p.pageType)) return false
  if (p.pageType === 'homepage') return true
  if (score >= RELEVANCE_THRESHOLD) return true
  // หน้าเชิงพาณิชย์ที่แตะคำหลักอย่างน้อย 1 คำ ถือว่าอยู่ในสนามเดียวกัน
  return isCommercialType(p.pageType) && score > 0.05
}

export function applyRuleClassification(pages: PageRecord[], vocab: Vocabulary): PageRecord[] {
  for (const p of pages) {
    const r = classifyPageByRules(p)
    p.pageType = r.type
    p.classifiedBy = r.confident ? 'rule' : 'unknown'
    p.relevanceScore = Number(scoreRelevance(p, vocab).toFixed(3))
    p.relevant = decideRelevant(p, p.relevanceScore)
  }
  return pages
}
