// ─── Upload Article — ชนิดข้อมูลที่ใช้ร่วมกันระหว่าง API และหน้า UI ──────────────
// ลูกค้าของ Upload Article แยกจาก Project (Clients) เด็ดขาด เก็บในตาราง UploadClient / UploadArticle

import type { UploadCtaSummary } from './cta'
import type { UploadAuthorSummary } from './author'
export type UploadOutputMode = 'html' | 'text'
export type UploadArticleStatus = 'WRITING' | 'IMPORTED' | 'GENERATED' | 'REVIEWED' | 'PUSHING' | 'PUSHED' | 'FAILED'

export interface UploadTheme {
  theme: string
  text: string
  border: string
  accent: string
  background: string
  styleMode: 'embed' | 'clean'
  /** ว่าง = ค่าเริ่มต้น (IBM Plex Sans Thai), 'inherit' = ไม่ใส่ฟอนต์ ใช้ของเว็บ */
  fontFamily?: string
  /** ว่าง = ไม่ใส่ฟอนต์หัวข้อ (ใช้ตามตัวอักษรหลัก/ธีมเว็บ) */
  headingFont?: string
  /** สไตล์ละเอียดจากการสแกนเว็บปลายทาง (FAQ card / ตาราง) — ว่าง = ใช้ค่าตามสีธีม */
  detail?: UploadThemeDetail
  /** สีพื้นของหน้าเว็บด้านหลังบทความ (จากการสแกน) — ใช้แสดงตัวอย่างเท่านั้น ไม่ถูกใส่ใน CSS บทความ
   *  เช่น เว็บพื้นเข้ม + บทความพื้นโปร่งใส + ตัวอักษรขาว ตัวอย่างต้องวางบนพื้นเข้มถึงจะอ่านออก */
  pageBackground?: string
}

export type UploadFaqIcon = 'plus' | 'chevron' | 'caret' | 'arrow' | 'none'

/** หน้าตา FAQ card — ทุกช่องไม่บังคับ ช่องที่ว่างใช้ค่าตั้งต้นของระบบ */
export interface UploadFaqStyle {
  /** card = กล่องมีขอบรอบ, divider = เส้นคั่นด้านล่างอย่างเดียว, plain = ไม่มีขอบ */
  layout?: 'card' | 'divider' | 'plain'
  itemBackground?: string
  itemBorderColor?: string
  itemBorderWidth?: number
  itemRadius?: number
  itemGap?: number
  itemShadow?: boolean
  questionBackground?: string
  questionColor?: string
  questionFontSize?: string
  questionWeight?: number
  questionPadding?: string
  openQuestionBackground?: string
  openQuestionColor?: string
  answerBackground?: string
  answerColor?: string
  answerPadding?: string
  icon?: UploadFaqIcon
  iconPosition?: 'left' | 'right'
  iconColor?: string
}

export interface UploadTableStyle {
  headerBackground?: string
  headerColor?: string
  borderColor?: string
  stripeBackground?: string
}

export interface UploadThemeDetail {
  /** มาจากไหน เช่น "Rank Math FAQ block บน https://…" */
  source?: string
  faq?: UploadFaqStyle
  table?: UploadTableStyle
}

export type UploadComponentKey = 'toc' | 'faq' | 'cta'

/**
 * ผลสแกนต่อ component
 * auto = ธีม/ปลั๊กอินใส่ให้ทุกโพสต์เอง → push ส่วนนี้ไปจะซ้อนกันแน่นอน
 * some-posts = มีเฉพาะในเนื้อหาบางบทความ (ผู้เขียนใส่เอง) → ไม่ซ้ำกับบทความใหม่
 * site = เจอเฉพาะนอกบทความ (หน้าแรก/เมนู)
 */
export interface UploadComponentFinding {
  found: boolean
  where: 'auto' | 'some-posts' | 'site' | null
  source: string
  postsWith: number
  postsChecked: number
  evidence: string[]
}

export interface UploadSiteScan {
  target: string
  scannedAt: string
  checked: string[]
  platform: {
    cms: string
    theme: string | null
    childTheme: string | null
    builders: string[]
    plugins: string[]
  }
  components: Record<UploadComponentKey, UploadComponentFinding>
  /** สรุปหน้าตา FAQ ของเว็บเป็นภาษาคน */
  faqSummary: string
  warnings: string[]
  /** สี/ฟอนต์ที่เสนอจากเว็บ (sanitize แล้ว) — ยังไม่ถูกใช้จนกว่าทีมกดรับและบันทึกธีม */
  suggestedTheme?: Partial<UploadTheme> | null
  detail?: UploadThemeDetail | null
}

/** ฟอนต์ Google ที่เลือกได้ในหน้า Generate (build-html จะ @import ให้เมื่อเลือกตัวใดตัวหนึ่ง) */
export const UPLOAD_GOOGLE_FONTS = [
  'IBM Plex Sans Thai', 'Noto Sans Thai', 'Sarabun', 'Prompt', 'Kanit', 'Mitr', 'Anuphan',
  'Bai Jamjuree', 'Chakra Petch', 'K2D', 'Niramit', 'Noto Serif Thai', 'Trirong',
  'Inter', 'Roboto', 'Open Sans', 'Poppins', 'Montserrat', 'Lato',
]

/** ค่า fontFamily พิเศษ: ไม่กำหนดฟอนต์ ใช้ฟอนต์ของเว็บปลายทาง */
export const UPLOAD_FONT_INHERIT = 'inherit'

export interface UploadPushPrefs {
  stripH1?: boolean
  useElementor?: boolean
  wpPostType?: 'post' | 'page'
  publishMode?: 'draft' | 'publish'
  excludeCards?: { toc?: boolean; cta?: boolean; faq?: boolean }
  /** ผลสแกนเว็บปลายทางล่าสุด (แสดงซ้ำในหน้า Generate/Push) */
  siteScan?: UploadSiteScan
  /** card ที่ทีมติ๊กออกในหน้า Push ต่อบทความ — ผูกกับ htmlVersion ถ้า HTML เปลี่ยน ค่านี้ใช้ไม่ได้ */
  cardSel?: Record<string, UploadCardSelection>
  /** วัน-เวลาเผยแพร่ที่ตั้งไว้ต่อบทความ (ISO UTC) — push ขึ้น WordPress เป็น date_gmt, อนาคต + publish = ตั้งเวลา (future) */
  publishAt?: Record<string, string>
  /** ค่าเริ่มต้นตอนสร้างรูปบทความ (Project Setting > รูปภาพ) */
  imageDefaults?: UploadImageDefaults
  /** เว็บ GSC ที่เลือกไว้สำหรับแท็บ Report (service account เท่านั้น — ไม่ผูกกับ internalLinks.gscSiteUrl) */
  gscReport?: UploadGscReportPrefs
  /** ขอให้ Google index อัตโนมัติหลัง push แบบ Publish สำเร็จ (ไม่ตั้ง = เปิด) */
  autoRequestIndex?: boolean
  /** ผล Request Index ล่าสุดต่อบทความ */
  indexRequests?: Record<string, UploadIndexRequest>
  /** PBN: ผล Request Index ล่าสุด articleId → siteId (บทความเดียวขึ้นได้หลายเว็บ) */
  pbnIndexRequests?: Record<string, Record<string, UploadIndexRequest>>
}

/** ผล Request Index (Google Indexing API) ล่าสุดของบทความ */
export interface UploadIndexRequest {
  url: string
  /** ISO เวลาที่ยิง */
  at: string
  ok: boolean
  error?: string
}

/** ค่าที่เลือกไว้สำหรับแท็บ Report (GSC) */
export interface UploadGscReportPrefs {
  siteUrl: string
}

/** ตัวเลือกสร้างรูป: ปก (featured image) + รูปประกอบในเนื้อหา แบบมีตัวหนังสือหรือไม่มี */
export interface UploadImageDefaults {
  cover: boolean
  coverWithText: boolean
  inlineCount: number
  inlineWithText: boolean
}

export const UPLOAD_MAX_INLINE_IMAGES = 5

export const DEFAULT_UPLOAD_IMAGE_DEFAULTS: UploadImageDefaults = {
  cover: true,
  coverWithText: true,
  inlineCount: 2,
  inlineWithText: false,
}

export interface UploadCardSelection {
  /** uploadHtmlVersion(htmlContent) ตอนที่เลือก */
  version: string
  /** id ของ card ที่ไม่เอาขึ้นเว็บ */
  off: string[]
}

// ── Keyword (แท็บแรก) — เก็บใน pushPrefs.keywordPlan (ไม่ส่งไปกับ UploadClientDTO) ──

export type UploadKeywordIntent = 'informational' | 'educational' | 'commercial' | 'transactional' | 'navigational'

export const UPLOAD_INTENT_LABELS: Record<UploadKeywordIntent, string> = {
  informational: 'Informational',
  educational: 'Educational',
  commercial: 'Commercial',
  transactional: 'Transactional',
  navigational: 'Navigational',
}

export interface UploadKeyword {
  id: string
  keyword: string
  /** search volume ถ้าวางมาด้วย */
  volume?: number | null
  /** ชื่อบทความ (H1) ที่ AI เสนอ — แก้เองได้ */
  title: string
  slug: string
  intent: UploadKeywordIntent | ''
  /** ประเภทบทความ เช่น บทความให้ความรู้ / How-to / Listicle / เปรียบเทียบ / รีวิว */
  articleType: string
  /** โน้ตเพิ่มให้คนเขียน (ส่งเข้า prompt ตอนเขียน) */
  note?: string
  /** บทความที่เขียนจาก keyword นี้ล่าสุด (UploadArticle.id) */
  articleId?: string
  /** ข้อความผิดพลาดจากการเขียนรอบล่าสุด (ว่าง = ไม่มี) */
  writeError?: string
  createdAt: string
}

// ── Internal Link — เก็บใน pushPrefs.internalLinks (ไม่ส่งไปกับ UploadClientDTO) ──

export interface UploadLinkPair {
  keyword: string
  url: string
  clicks?: number
}

export interface UploadInternalLinks {
  /** GSC property ที่เลือกไว้ เช่น sc-domain:example.com หรือ https://example.com/ */
  gscSiteUrl: string
  /** จำนวนลิงก์ต่อบทความ เช่น "3-5" หรือ "3" */
  linksPerArticle: string
  gsc: UploadLinkPair[]
  manual: UploadLinkPair[]
  /** URL ที่ติ๊กไม่เอา */
  excluded: string[]
  gscFetchedAt?: string
}

export const DEFAULT_UPLOAD_INTERNAL_LINKS: UploadInternalLinks = {
  gscSiteUrl: '',
  linksPerArticle: '3-5',
  gsc: [],
  manual: [],
  excluded: [],
}

export interface UploadClientDTO {
  id: string
  name: string
  website: string
  language: 'th' | 'en' | 'both'
  theme: UploadTheme
  pushPrefs: UploadPushPrefs
  websitePlatform: string
  wpUrl: string
  wpUser: string
  hasWpPassword: boolean
  /** ค่า secret แสดงแบบ •••• + 4 ตัวท้าย */
  siteConnectionMasked: Record<string, string>
  /** สถานะ CTA (Project Setting > CTA) แบบย่อ — ค่าเต็มโหลดผ่าน /clients/[id]/cta */
  ctaSummary: UploadCtaSummary
  /** สถานะกล่องผู้เขียน (Project Setting > Author Box) แบบย่อ — ค่าเต็มโหลดผ่าน /clients/[id]/author */
  authorSummary: UploadAuthorSummary
  /** ผลทดสอบการเชื่อมต่อล่าสุดที่บันทึกไว้ — stale = credentials/แพลตฟอร์มเปลี่ยนหลังทดสอบ ต้องทดสอบใหม่ */
  connectionStatus?: { platform: string; ok: boolean; message: string; at: string; stale: boolean } | null
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
