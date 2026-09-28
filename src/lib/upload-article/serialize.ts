// ─── Upload Article — แปลง row จาก Prisma เป็น DTO ที่ปลอดภัยส่งให้ frontend ───
// ห้ามส่ง wpAppPasswordEnc / siteConnection ดิบกลับไปเด็ดขาด (mask เท่านั้น)

import type { UploadArticleDTO, UploadArticleStatus, UploadClientDTO, UploadOutputMode, UploadPushPrefs, UploadTheme } from './types'
import { DEFAULT_UPLOAD_THEME } from './types'

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return { ...fallback, ...JSON.parse(json) }
  } catch {
    return fallback
  }
}

/** แสดง secret แบบ •••• + 4 ตัวท้าย — ใช้กับ siteConnection ของแพลตฟอร์มอื่น */
function maskSecretValue(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '••••'
  return `••••${value.slice(-4)}`
}

/** mask ทุกค่าใน siteConnection แบบตื้น (ระดับ 1 ชั้น key: string) ให้ใช้แสดงผลอย่างเดียว */
function maskSiteConnection(raw: string | null | undefined): Record<string, string> {
  const parsed = safeParse<Record<string, unknown>>(raw, {})
  const out: Record<string, string> = {}
  for (const [platform, cfg] of Object.entries(parsed)) {
    if (!cfg || typeof cfg !== 'object') continue
    for (const [key, val] of Object.entries(cfg as Record<string, unknown>)) {
      if (typeof val !== 'string' || !val) continue
      out[`${platform}.${key}`] = maskSecretValue(val)
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

export function toUploadClientDTO(row: UploadClientRow, counts: UploadClientCounts): UploadClientDTO {
  const theme = safeParse<UploadTheme>(row.themeColors, DEFAULT_UPLOAD_THEME)
  const pushPrefs = safeParse<UploadPushPrefs>(row.pushPrefs, {})
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
