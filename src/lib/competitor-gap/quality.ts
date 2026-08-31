/**
 * Competitor Gap — SEO Content Quality Score (0–100) ของ MarsOS
 *
 * นี่ไม่ใช่คะแนนของ Google — เป็นคะแนนเปรียบเทียบภายในที่อธิบายได้ทุกมิติ
 * ค่าคงที่ทั้งหมดรวมศูนย์อยู่ไฟล์นี้ไฟล์เดียว (ห้ามกระจายเลขวิเศษไปที่อื่น)
 * ทุกมิติคำนวณจากข้อมูลที่ crawl มาได้จริง — ไม่มีการเดา
 */

import type { PageRecord, PageType } from './types'
import { isCommercialType, isContentType, tokens } from './classify'

export const QUALITY_WEIGHTS = {
  searchIntentMatch: 15,
  topicCompleteness: 15,
  contentDepth: 15,
  usefulSpecificity: 10,
  evidence: 10,
  titleStructure: 10,
  freshness: 10,
  internalLinking: 8,
  trustSignals: 7,
} as const

export type QualityDim = keyof typeof QUALITY_WEIGHTS

export const DIM_LABELS: Record<QualityDim, string> = {
  searchIntentMatch: 'Search Intent Match',
  topicCompleteness: 'Topic Completeness',
  contentDepth: 'Content Depth',
  usefulSpecificity: 'Useful Specificity',
  evidence: 'Evidence / Expertise',
  titleStructure: 'Title / H1 / Structure',
  freshness: 'Freshness',
  internalLinking: 'Internal Linking',
  trustSignals: 'Trust Signals',
}

export type SearchIntent = 'transactional' | 'commercial' | 'informational' | 'navigational'

const COMMERCIAL_MARKERS = /(ราคา|ค่าบริการ|รับทำ|รับจ้าง|บริการ|จ้าง|ซื้อ|ขาย|สั่ง|บริษัท|ใกล้ฉัน|ที่ไหนดี|price|cost|buy|hire|service|company|near me|quote)/i
const COMPARISON_MARKERS = /(เปรียบเทียบ|vs|ดีที่สุด|แนะนำ|รีวิว|เลือก|top\s?\d|best|review|compare)/i
const INFO_MARKERS = /(คือ|คืออะไร|วิธี|ทำไม|ขั้นตอน|how|what|why|guide|คู่มือ|ความหมาย)/i

export function detectIntent(keyword: string): SearchIntent {
  if (COMPARISON_MARKERS.test(keyword)) return 'commercial'
  if (COMMERCIAL_MARKERS.test(keyword)) return 'transactional'
  if (INFO_MARKERS.test(keyword)) return 'informational'
  return 'commercial'
}

export function expectedTypes(intent: SearchIntent): PageType[] {
  switch (intent) {
    case 'transactional': return ['service', 'product', 'landing', 'location', 'route', 'category', 'homepage']
    case 'commercial':    return ['service', 'guide', 'case-study', 'tool', 'category', 'product', 'article']
    case 'informational': return ['article', 'guide', 'glossary', 'tool', 'case-study']
    default:              return ['homepage', 'about', 'contact']
  }
}

export interface QualityBenchmark {
  medianWords: number
  medianH2: number
  medianInternalLinks: number
  medianAgeDays: number | null
  intent: SearchIntent
  keywordTokens: string[]
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function buildBenchmark(pages: PageRecord[], keyword: string): QualityBenchmark {
  const rel = pages.filter(p => p.relevant)
  const base = rel.length >= 5 ? rel : pages
  const ages: number[] = []
  const now = Date.now()
  for (const p of base) {
    const d = p.modifiedDate ?? p.publishedDate
    if (d) ages.push((now - new Date(d).getTime()) / 86_400_000)
  }
  return {
    medianWords: median(base.map(p => p.wordCount)) || 1,
    medianH2: median(base.map(p => p.h2.length)) || 1,
    medianInternalLinks: median(base.map(p => p.internalLinks)) || 1,
    medianAgeDays: ages.length >= 3 ? median(ages) : null,
    intent: detectIntent(keyword),
    keywordTokens: tokens(keyword),
  }
}

function ratio(value: number, benchmark: number): number {
  if (benchmark <= 0) return value > 0 ? 1 : 0
  return Math.max(0, Math.min(1, value / benchmark))
}

export function scorePage(p: PageRecord, b: QualityBenchmark): { score: number; dims: Record<string, number> } {
  const dims = {} as Record<QualityDim, number>

  const expected = expectedTypes(b.intent)
  const typeMatch = expected.includes(p.pageType) ? 1 : (isCommercialType(p.pageType) || isContentType(p.pageType) ? 0.5 : 0.15)
  const kwHit = b.keywordTokens.length
    ? b.keywordTokens.filter(t => `${p.title} ${p.h1}`.toLowerCase().includes(t)).length / b.keywordTokens.length
    : 0
  dims.searchIntentMatch = Math.min(1, typeMatch * 0.7 + kwHit * 0.3)

  dims.topicCompleteness = ratio(p.h2.length, b.medianH2 * 1.2)
  dims.contentDepth = ratio(p.wordCount, b.medianWords * 1.1)
  dims.usefulSpecificity = Math.min(1,
    (p.hasList ? 0.35 : 0) + (p.hasTable ? 0.25 : 0) + Math.min(0.4, p.numberDensity * 12))

  const evidenceSchema = p.schemaTypes.some(s => ['FAQPage', 'HowTo', 'Review', 'Person', 'Dataset', 'Table'].includes(s)) ? 0.35 : 0
  const authorSignal = /author|เขียนโดย|by\s/i.test(`${p.sample ?? ''}`) ? 0.2 : 0
  dims.evidence = Math.min(1, evidenceSchema + authorSignal + (p.hasTable ? 0.2 : 0) + Math.min(0.25, p.numberDensity * 8))

  const titleLen = p.title.length
  dims.titleStructure = Math.min(1,
    (titleLen >= 20 && titleLen <= 70 ? 0.4 : titleLen > 0 ? 0.2 : 0) +
    (p.h1 ? 0.3 : 0) +
    (p.h2.length >= 2 ? 0.3 : p.h2.length === 1 ? 0.15 : 0))

  const dateStr = p.modifiedDate ?? p.publishedDate
  if (!dateStr) dims.freshness = 0.35            // ไม่มีวันที่ = ไม่รู้ ไม่ใช่ "เก่า" — ให้กลาง ๆ และแจ้งเป็นจุดอ่อน
  else {
    const ageDays = (Date.now() - new Date(dateStr).getTime()) / 86_400_000
    const bench = b.medianAgeDays ?? 365
    dims.freshness = Math.max(0, Math.min(1, 1 - ageDays / Math.max(bench * 2, 365)))
  }

  dims.internalLinking = ratio(p.internalLinks, b.medianInternalLinks * 1.1)
  dims.trustSignals = Math.min(1,
    (p.schemaTypes.some(s => ['Organization', 'LocalBusiness', 'Corporation'].includes(s)) ? 0.4 : 0) +
    (p.schemaTypes.includes('BreadcrumbList') ? 0.2 : 0) +
    (p.schemaTypes.length > 0 ? 0.2 : 0) +
    (p.metaDescription ? 0.2 : 0))

  let total = 0
  for (const key of Object.keys(QUALITY_WEIGHTS) as QualityDim[]) {
    total += dims[key] * QUALITY_WEIGHTS[key]
  }
  const rounded: Record<string, number> = {}
  for (const key of Object.keys(dims) as QualityDim[]) rounded[key] = Number(dims[key].toFixed(3))
  return { score: Math.round(total), dims: rounded }
}

export function scoreDomain(pages: PageRecord[], b: QualityBenchmark): { score: number | null; dims: Record<string, number> } {
  const rel = pages.filter(p => p.relevant && p.indexable)
  if (rel.length === 0) return { score: null, dims: {} }
  const agg: Record<string, number> = {}
  let sum = 0
  for (const p of rel) {
    const r = scorePage(p, b)
    p.qualityScore = r.score
    p.qualityDims = r.dims
    sum += r.score
    for (const k of Object.keys(r.dims)) agg[k] = (agg[k] ?? 0) + r.dims[k]
  }
  for (const k of Object.keys(agg)) agg[k] = Number((agg[k] / rel.length).toFixed(3))
  return { score: Math.round(sum / rel.length), dims: agg }
}

export function weaknessesFrom(dims: Record<string, number>): string[] {
  return (Object.keys(QUALITY_WEIGHTS) as QualityDim[])
    .filter(k => (dims[k] ?? 1) < 0.5)
    .sort((a, b) => (dims[a] ?? 1) - (dims[b] ?? 1))
    .slice(0, 5)
    .map(k => DIM_LABELS[k])
}
