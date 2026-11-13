export interface ProjectData {
  /** โลโก้ลูกค้า (data URL รูปเล็ก หรือ path เก่า) — ใช้แสดงที่หัวหน้าโปรเจกต์ */
  logoUrl?: string | null
  id: string
  autoSchedule?: boolean
  wordpressConnectionId?: string | null
  name: string
  clientName: string | null
  website: string
  businessType: string
  industry: string | null
  language: string
  notes: string | null
  projectContext: string | null
  imageStyleGuide: string | null
  brandTone?: string | null
  styleGuide?: string | null
  accentColor?: string
  articleTheme?: string
  themeColors?: string
  forbiddenWords?: string
  sampleArticle?: string | null
  internalLinks?: string
  gscSiteUrl?: string | null
  ga4PropertyId?: string | null
  ctaSetting?: string
  authorEnabled?: boolean
  authorName?: string | null
  authorTitle?: string | null
  authorImage?: string | null
  authors?: string  // JSON: AuthorProfile[]
  _count: { articles: number; keywords: number }
}

export interface KeywordRow {
  no: number
  keyword: string
  title: string
  volume: number
  intent: string
  keyword_type: string
  priority: 'high' | 'medium' | 'low'
  opportunity_score: number
  content_type: string
  page_type?: string
  notes?: string
  // Framework fields
  funnel?: string
  traffic_score?: number
  authority_score?: number
  lead_score?: number
  sales_score?: number
  retention_score?: number
  primary_objective?: string
  secondary_objective?: string
  article_type?: string
  // Sheet fields
  slug?: string
  cluster?: string
  page_tier?: string
  status?: string
  action?: string
  section?: string
  keyword_group?: string
  current_url?: string
  conversion_potential?: number
  traffic_potential?: number
  relevance_score?: number
  position?: number
  // Keyword Intent Skill fields (meta) — optional, ผลรุ่นเก่าไม่มีค่าพวกนี้
  group_head?: boolean
  cluster_name?: string
  page_type_unified?: 'HOMEPAGE' | 'SERVICE' | 'CATEGORY' | 'LOCATION' | 'COMPARISON' | 'TOOL' | 'BLOG'
  pillar_intent?: string
  intent_code?: 'I' | 'C' | 'T' | 'N'
  fit?: 'FIT' | 'ARTICLE_ONLY' | 'NOT_RECOMMENDED'
  remark?: string
  approved?: boolean
}

export interface TimelineEntry {
  date: string
  thaiDate: string
  dayOfWeek: string
  keyword: string
  title: string
  priority: string
  volume: number
  intent: string
  opportunity_score: number
  isCore: boolean
  phase: number
  weekLabel: string
  articleStatus: 'pending' | 'writing' | 'done' | 'review' | 'approved'
  // Extended fields
  articleObjectiveTag?: string
  funnel?: string
  timelineBatch?: '20/80 First Batch' | '20/80 Remaining Batch'
  timelinePhase?: string
  priorityScore?: number
  publishingPriority?: number
  reasonForScheduling?: string
  websiteTypeUsed?: string
  isLocked?: boolean
  isManualDateOverride?: boolean
  status?: 'Draft' | 'Scheduled' | 'Published' | 'Locked' | 'Excluded'
  slug?: string
  page_type?: string
  cluster_label?: string
  kw_status?: string
  assignedAuthorId?: string  // id from Project.authors array
  keywordId?: string  // DB Keyword.id for article slug mapping
  // ── ค่าที่แก้เองในแท็บ Review — ชนะทุกแหล่งตอน Push ──
  // เขียนโดย ReviewTab > saveSeo เท่านั้น · ไม่มีเส้นทางอื่นเขียนทับ
  // (บทความ/DB อาจถูก job อื่นเขียนทับได้ แต่ตรงนี้ไม่ถูกแตะ)
  reviewSeoTitle?: string
  reviewMetaDescription?: string
  reviewMetaEditedAt?: string
}

export interface ArticleJob {
  entryIdx: number
  date: string
  keyword: string
  title: string
  status: 'idle' | 'writing' | 'done' | 'error' | 'cover' | 'review' | 'approved'
  html: string
  coverImage: string
  coverMimeType: string
  midImage: string
  midMimeType: string
  error: string
  slug?: string
  /** id ของ Article ใน DB — ใช้บันทึกเนื้อหาที่แก้ในหน้านี้กลับเข้า DB */
  articleId?: string
}
