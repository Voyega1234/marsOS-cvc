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
  /** ว่าง = ค่าเริ่มต้น (IBM Plex Sans Thai), 'inherit' = ไม่ใส่ฟอนต์ ใช้ของเว็บ */
  fontFamily?: string
  /** ว่าง = ไม่ใส่ฟอนต์หัวข้อ (ใช้ตามตัวอักษรหลัก/ธีมเว็บ) */
  headingFont?: string
  /** สไตล์ละเอียดจากการสแกนเว็บปลายทาง (FAQ card / ตาราง) — ว่าง = ใช้ค่าตามสีธีม */
  detail?: UploadThemeDetail
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
