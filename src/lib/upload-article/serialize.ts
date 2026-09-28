// ─── Upload Article — แปลง row จาก Prisma เป็น DTO ที่ปลอดภัยส่งให้ frontend ───
// ห้ามส่ง wpAppPasswordEnc / siteConnection ดิบกลับไปเด็ดขาด (mask เท่านั้น)

import type { UploadArticleDTO, UploadArticleStatus, UploadCardSelection, UploadClientDTO, UploadOutputMode, UploadPushPrefs, UploadTheme } from './types'
import { DEFAULT_UPLOAD_THEME } from './types'
import { HEAVY_PREF_KEYS } from './prefs-store'
import { readImageDefaults } from './article-images'

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return { ...fallback, ...JSON.parse(json) }
  } catch {
    return fallback
  }
}

/** ช่องที่ไม่ใช่ secret ในแต่ละแพลตฟอร์ม (โดเมน/URL/ID) — แสดงค่าจริงได้ ส่วนที่เหลือถือเป็น secret ทั้งหมด */
const NON_SECRET_SITE_CONN_FIELDS = new Set(['storeDomain', 'webhookUrl', 'siteId'])

/** mask ทุกค่าใน siteConnection แบบตื้น (ระดับ 1 ชั้น key: string) ให้ใช้แสดงผลอย่างเดียว
 * secret ไม่เปิดเผยแม้แต่บางส่วน (ไม่มีตัวท้าย 4 ตัวให้เดางอกได้) — ช่องที่ไม่ใช่ secret (โดเมน) แสดงค่าจริง */
function maskSiteConnection(raw: string | null | undefined): Record<string, string> {
  const parsed = safeParse<Record<string, unknown>>(raw, {})
  const out: Record<string, string> = {}
  for (const [platform, cfg] of Object.entries(parsed)) {
    if (!cfg || typeof cfg !== 'object') continue
    for (const [key, val] of Object.entries(cfg as Record<string, unknown>)) {
      if (typeof val !== 'string' || !val) continue
      out[`${platform}.${key}`] = NON_SECRET_SITE_CONN_FIELDS.has(key) ? val : '••••'
    }
  }
  return out
}

export interface UploadClientRow {
  id: string
  name: string
  website: string
  language: string
  themeColors: string
  pushPrefs: string
  websitePlatform: string
  wpUrl: string
  wpUser: string
  wpAppPasswordEnc: string
  siteConnection: string
  createdAt: Date
  updatedAt: Date
}

export interface UploadClientCounts {
  total: number
  imported: number
  generated: number
  reviewed: number
  pushed: number
  failed: number
}

/** เอาเฉพาะ entry ที่มีรูปร่างถูกต้อง — กัน pushPrefs.cardSel ที่เพี้ยน/ถูกแก้มือหลุดไปหน้า UI */
function sanitizeCardSel(raw: unknown): Record<string, UploadCardSelection> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, UploadCardSelection> = {}
  for (const [articleId, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue
    const v = val as Record<string, unknown>
    if (typeof v.version !== 'string') continue
    if (!Array.isArray(v.off)) continue
    const off = v.off.filter((x): x is string => typeof x === 'string')
    out[articleId] = { version: v.version, off }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** publishAt ต้องเป็น ISO ที่ parse ได้เท่านั้น */
function sanitizePublishAt(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [articleId, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === 'string' && !Number.isNaN(Date.parse(val))) out[articleId] = val
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function toUploadClientDTO(row: UploadClientRow, counts: UploadClientCounts): UploadClientDTO {
  const theme = safeParse<UploadTheme>(row.themeColors, DEFAULT_UPLOAD_THEME)
  const rawPrefs = safeParse<UploadPushPrefs>(row.pushPrefs, {})
  // key หนัก (keywordPlan/internalLinks) ไม่ส่งไปกับ DTO นี้ — หน้า UI โหลดผ่าน route เฉพาะของมันเอง
  const pushPrefs: UploadPushPrefs = { ...rawPrefs }
  for (const key of HEAVY_PREF_KEYS) delete (pushPrefs as Record<string, unknown>)[key]
  const cardSel = sanitizeCardSel((rawPrefs as Record<string, unknown>).cardSel)
  if (cardSel) pushPrefs.cardSel = cardSel
  else delete pushPrefs.cardSel
  const publishAt = sanitizePublishAt((rawPrefs as Record<string, unknown>).publishAt)
  if (publishAt) pushPrefs.publishAt = publishAt
  else delete pushPrefs.publishAt
  pushPrefs.imageDefaults = readImageDefaults((rawPrefs as Record<string, unknown>).imageDefaults)
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    language: row.language === 'en' ? 'en' : 'th',
    theme,
    pushPrefs,
    websitePlatform: row.websitePlatform,
    wpUrl: row.wpUrl,
    wpUser: row.wpUser,
    hasWpPassword: Boolean(row.wpAppPasswordEnc),
    siteConnectionMasked: maskSiteConnection(row.siteConnection),
    counts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export interface UploadArticleRow {
  id: string
  clientId: string
  title: string
  sourceType: string
  sourceName: string
  sourceHtml: string
  outputMode: string
  htmlContent: string | null
  seoTitle: string
  metaDescription: string
  slug: string
  coverImageUrl: string | null
  coverAlt: string
  status: string
  pushMode: string | null
  wordpressUrl: string | null
  wordpressPostId: string | null
  pushError: string | null
  pushedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function countWords(html: string | null): number {
  if (!html) return 0
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim()
  if (!text) return 0
  // ข้อความไทยไม่มีช่องว่างระหว่างคำ — นับตามความยาวตัวอักษรที่ไม่ใช่ whitespace หาร 2 โดยประมาณ
  // ถ้ามีช่องว่าง (อังกฤษ/ผสม) ใช้การนับคำแบบ split ตามปกติ
  const hasSpaces = /\s/.test(text)
  if (hasSpaces) return text.split(/\s+/).filter(Boolean).length
  return Math.round(text.length / 2)
}

/** includeContent = true เฉพาะ GET รายตัว (list ไม่ส่ง sourceHtml/htmlContent เพื่อลดขนาด) */
export function toUploadArticleDTO(row: UploadArticleRow, includeContent = false): UploadArticleDTO {
  const dto: UploadArticleDTO = {
    id: row.id,
    clientId: row.clientId,
    title: row.title,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    outputMode: (row.outputMode === 'text' ? 'text' : 'html') as UploadOutputMode,
    status: row.status as UploadArticleStatus,
    seoTitle: row.seoTitle,
    metaDescription: row.metaDescription,
    slug: row.slug,
    // list ไม่ส่งปกแบบ data URI (รูปละ ~300KB × หลายสิบบทความ = เกินเพดาน response 4.5MB ของ Vercel)
    // หน้าที่ต้องใช้ปกโหลดจาก GET รายตัว (includeContent = true) อยู่แล้ว
    coverImageUrl: includeContent || !row.coverImageUrl?.startsWith('data:') ? row.coverImageUrl : null,
    coverAlt: row.coverAlt,
    pushMode: row.pushMode,
    wordpressUrl: row.wordpressUrl,
    wordpressPostId: row.wordpressPostId,
    pushError: row.pushError,
    pushedAt: row.pushedAt ? row.pushedAt.toISOString() : null,
    wordCount: countWords(row.htmlContent || row.sourceHtml),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
  if (includeContent) {
    dto.sourceHtml = row.sourceHtml
    dto.htmlContent = row.htmlContent
  }
  return dto
}

export function computeClientCounts(articles: Array<{ status: string }>): UploadClientCounts {
  const counts: UploadClientCounts = { total: articles.length, imported: 0, generated: 0, reviewed: 0, pushed: 0, failed: 0 }
  for (const a of articles) {
    if (a.status === 'IMPORTED') counts.imported++
    else if (a.status === 'GENERATED') counts.generated++
    else if (a.status === 'REVIEWED') counts.reviewed++
    else if (a.status === 'PUSHED') counts.pushed++
    else if (a.status === 'FAILED') counts.failed++
  }
  return counts
}
