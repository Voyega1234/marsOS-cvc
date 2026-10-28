/**
 * ภาพรวมบทความทั้งระบบ — SEO SME (Project.timeline) + Upload Article + PBN Backlinks
 * ใช้ร่วมกันที่หน้า บทความทั้งหมด / Content Calendar / Review Queue
 * ไฟล์นี้ใช้ได้ทั้งฝั่ง client และ server (ไม่มี prisma) — ตัวโหลดข้อมูลอยู่ที่ article-overview-server.ts
 */

export type ArticleSource = 'seo-sme' | 'upload-article' | 'pbn'

/** สถานะกลางที่ใช้ทุกหน้า — แต่ละระบบ map สถานะของตัวเองเข้ามา (ของเดิมเก็บไว้ใน rawStatus) */
export type OverviewStatus = 'pending' | 'writing' | 'review' | 'done' | 'approved' | 'pushed' | 'failed'

export interface OverviewArticle {
  /** key ที่ไม่ซ้ำทั้งระบบ */
  id: string
  source: ArticleSource
  /** id ของ Project (SEO SME) หรือ UploadClient (Upload/PBN) */
  clientId: string
  clientName: string
  /** ตำแหน่งใน Project.timeline.entries (SEO SME) — Upload/PBN = -1 */
  entryIndex: number
  /** UploadArticle.id (Upload/PBN) — SEO SME = null */
  uploadArticleId: string | null
  title: string
  keyword: string
  status: OverviewStatus
  rawStatus: string
  /** วันเผยแพร่ YYYY-MM-DD ของ SEO SME ('' = ยังไม่กำหนด) — Upload/PBN ใช้ publishAt แทน */
  date: string
  /** วัน-เวลาเผยแพร่ ISO ของ Upload/PBN (ตั้งไว้ หรือวันที่ push จริง) — แปลงเป็นวันตามเวลาเครื่องผู้ใช้ด้วย overviewDay() */
  publishAt: string | null
  updatedAt: string
  href: string
  funnel?: string
  slug?: string
  intent?: string
  priority?: string
  volume?: number
  timelineBatch?: string
}

export interface OverviewClient {
  id: string
  name: string
  source: ArticleSource
}

export const OVERVIEW_STATUSES: OverviewStatus[] = ['pending', 'writing', 'review', 'done', 'approved', 'pushed', 'failed']
export const OVERVIEW_SOURCES: ArticleSource[] = ['seo-sme', 'upload-article', 'pbn']

/** สถานะ Upload/PBN → สถานะกลาง (GENERATED = เขียนแล้วรอทีมตรวจใน Review, REVIEWED = ผ่าน Review แล้ว) */
export const UPLOAD_TO_OVERVIEW: Record<string, OverviewStatus> = {
  IMPORTED: 'pending',
  WRITING: 'writing',
  GENERATED: 'review',
  REVIEWED: 'approved',
  PUSHING: 'approved',
  PUSHED: 'pushed',
  FAILED: 'failed',
}

const SME_STATUSES = new Set<OverviewStatus>(['pending', 'writing', 'review', 'done', 'approved', 'pushed'])
export function smeToOverview(articleStatus: string | undefined): OverviewStatus {
  return SME_STATUSES.has(articleStatus as OverviewStatus) ? (articleStatus as OverviewStatus) : 'pending'
}

function pad(n: number) { return String(n).padStart(2, '0') }

/** วันของบทความเป็น YYYY-MM-DD ตามเวลาเครื่องผู้ใช้ ('' = ยังไม่กำหนดวัน) */
export function overviewDay(a: Pick<OverviewArticle, 'date' | 'publishAt'>): string {
  if (a.publishAt) {
    const d = new Date(a.publishAt)
    if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return /^\d{4}-\d{2}-\d{2}/.test(a.date) ? a.date.slice(0, 10) : ''
}

/** เวลา HH:MM ของ Upload/PBN ที่ตั้งเวลาไว้ ('' = ไม่มีเวลา) */
export function overviewTime(a: Pick<OverviewArticle, 'publishAt'>): string {
  if (!a.publishAt) return ''
  const d = new Date(a.publishAt)
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
