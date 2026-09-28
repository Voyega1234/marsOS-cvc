// ─── Upload Article — ชนิดข้อมูลที่ใช้ร่วมกันระหว่าง API และหน้า UI ──────────────
// ลูกค้าของ Upload Article แยกจาก Project (Clients) เด็ดขาด เก็บในตาราง UploadClient / UploadArticle

export type UploadOutputMode = 'html' | 'text'
export type UploadArticleStatus = 'IMPORTED' | 'GENERATED' | 'REVIEWED' | 'PUSHED' | 'FAILED'

export interface UploadTheme {
  theme: string
  text: string
  border: string
  accent: string
  background: string
  styleMode: 'embed' | 'clean'
  fontFamily?: string
  headingFont?: string
}

export interface UploadPushPrefs {
  stripH1?: boolean
  useElementor?: boolean
  wpPostType?: 'post' | 'page'
  publishMode?: 'draft' | 'publish'
  excludeCards?: { toc?: boolean; cta?: boolean; faq?: boolean }
}

export interface UploadClientDTO {
  id: string
  name: string
  website: string
  language: 'th' | 'en'
  theme: UploadTheme
  pushPrefs: UploadPushPrefs
  websitePlatform: string
  wpUrl: string
  wpUser: string
  hasWpPassword: boolean
  /** ค่า secret แสดงแบบ •••• + 4 ตัวท้าย */
  siteConnectionMasked: Record<string, string>
  counts: { total: number; imported: number; generated: number; reviewed: number; pushed: number; failed: number }
  createdAt: string
  updatedAt: string
}

export interface UploadArticleDTO {
  id: string
  clientId: string
  title: string
  sourceType: string
  sourceName: string
  outputMode: UploadOutputMode
  status: UploadArticleStatus
  seoTitle: string
  metaDescription: string
  slug: string
  coverImageUrl: string | null
  coverAlt: string
  pushMode: string | null
  wordpressUrl: string | null
  wordpressPostId: string | null
  pushError: string | null
  pushedAt: string | null
  wordCount: number
  createdAt: string
  updatedAt: string
  /** มีเฉพาะ GET รายตัว (list ไม่ส่งเพื่อลดขนาด) */
  sourceHtml?: string
  htmlContent?: string | null
}

export const DEFAULT_UPLOAD_THEME: UploadTheme = {
  theme: '#2563eb',
  text: '#1f2937',
  border: '#e5e7eb',
  accent: '#2563eb',
  background: '',
  styleMode: 'embed',
}
