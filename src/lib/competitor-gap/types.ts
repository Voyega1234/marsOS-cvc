/**
 * Competitor Gap — shared types.
 *
 * โมดูลนี้แยกขาดจากส่วนอื่นของ MarsOS: ไม่มีไฟล์ไหนนอก src/lib/competitor-gap,
 * src/app/api/competitor-gap และ src/components/projects/competitor-gap import จากที่นี่
 * (ยกเว้นแท็บใน ClientDetailTabs ที่ import คอมโพเนนต์หน้าเดียว)
 *
 * กติกาข้อมูล: ห้ามแต่งตัวเลข — ทุก metric ที่ไม่มีข้อมูลจริงต้องเป็น null และ UI แสดง "—"
 */

// ── Input ────────────────────────────────────────────────────────────────────

export interface AdvancedSettings {
  /** งบหน้าที่ "ดึงจริง" ต่อโดเมน (discovery แยกต่างหาก, เพดาน MAX_DISCOVER_URLS) */
  maxPagesPerDomain: number
  /** จำนวนคู่แข่งจาก Google Top N (ค่าเริ่มต้น 5) */
  competitorCount: number
  /** ดึง ranked keywords จาก DataForSEO (มีค่าใช้จ่าย) */
  includeKeywordGap: boolean
  /** อนุญาต render ด้วย browser เฉพาะหน้าที่ตรวจพบว่าต้องใช้ JS */
  jsFallback: boolean
}

export interface RunInput {
  projectId: string
  ourWebsite: string
  keyword: string
  /**
   * คู่แข่งที่ผู้ใช้ระบุเอง (origin ที่ normalize แล้ว) — ถูกใส่เข้ารอบสแกนก่อนเสมอ
   * ถ้าระบุไม่ครบตาม competitorCount ระบบจะเติมจาก Google Top N ด้วยกระบวนการเดิม
   */
  manualCompetitors?: string[]
  /** key ของ COUNTRIES ใน locations.ts */
  country: string
  advanced: AdvancedSettings
}

// ── SERP ─────────────────────────────────────────────────────────────────────

export type CompetitorKind =
  | 'business'
  | 'content'
  | 'directory'
  | 'government'
  | 'community'
  | 'marketplace'
  | 'media'
  | 'other'

export interface SerpEntry {
  position: number
  domain: string
  url: string
  title: string
  kind: CompetitorKind
  /** เทียบเคียงกับเว็บลูกค้าได้ไหม (ใช้คิด baseline) */
  comparable: boolean
}

export interface SerpResult {
  keyword: string
  locationCode: number
  languageCode: string
  fetchedAt: string
  /** Top 5 (หรือ competitorCount) ที่เอาไปสแกน */
  top: SerpEntry[]
  /** ผลออร์แกนิกทั้งหมดที่ดึงมา (โชว์ตามจริง ไม่ตัดทิ้งเงียบ ๆ) */
  all: SerpEntry[]
}

// ── Crawl ────────────────────────────────────────────────────────────────────

export type PageType =
  | 'homepage' | 'service' | 'product' | 'category' | 'location' | 'route'
  | 'industry' | 'article' | 'guide' | 'case-study' | 'tool' | 'glossary'
  | 'landing' | 'about' | 'contact' | 'career' | 'legal' | 'other'

export interface PageRecord {
  url: string
  path: string
  status: number
  canonical: string | null
  indexable: boolean
  /** เหตุผลที่ index ไม่ได้ (noindex / canonical ชี้ที่อื่น / status ไม่ใช่ 200) */
  nonIndexableReason: string | null
  title: string
  metaDescription: string
  h1: string
  h2: string[]
  wordCount: number
  internalLinks: number
  schemaTypes: string[]
  publishedDate: string | null
  modifiedDate: string | null
  jsSuspected: boolean
  jsRendered: boolean
  hasList: boolean
  hasTable: boolean
  numberDensity: number
  pageType: PageType
  classifiedBy: 'rule' | 'ai' | 'unknown'
  relevant: boolean
  relevanceScore: number
  /** ข้อความตัวอย่างสำหรับ AI — ถูกลบทิ้งหลังจบขั้น classify เพื่อไม่ให้ state บวม */
  sample?: string
  qualityScore: number | null
  qualityDims?: Record<string, number>
  // ── สัญญาณโครงสร้างบทความ (ไม่มีในผลสแกนรุ่นก่อน จึงเป็น optional) ──
  h3?: string[]
  questionHeadings?: number
  citationLinks?: number
  authorName?: string | null
  hasSummaryBlock?: boolean
  leadWordCount?: number
  answersInLead?: boolean
  images?: number
  imagesWithAlt?: number
}

export interface CrawlCoverage {
  robotsFound: boolean
  robotsBlockedRoot: boolean
  sitemapUrls: number
  discovered: number
  crawled: number
  ok: number
  redirects: number
  nonIndexable: number
  blocked: number
  errors: number
  jsSuspected: number
  jsRendered: number
  truncated: boolean
  confidence: 'high' | 'medium' | 'low'
  notes: string[]
}

export interface DomainState {
  /** index 0 = เว็บเรา */
  isOurs: boolean
  /** true = ผู้ใช้กรอก URL นี้เอง ไม่ได้มาจากผล SERP */
  manual?: boolean
  label: string
  domain: string
  origin: string
  serpPosition: number | null
  serpUrl: string | null
  kind: CompetitorKind
  comparable: boolean
  pages: PageRecord[]
  coverage: CrawlCoverage
  /** ranked keywords (เติมในขั้น keywords) */
  organicKeywords: number | null
  estimatedTraffic: number | null
}

// ── Inventory / baseline ─────────────────────────────────────────────────────

export interface DomainInventory {
  domain: string
  isOurs: boolean
  comparable: boolean
  totalIndexable: number
  relevant: number
  byType: Record<PageType, number>
  contentQuality: number | null
  organicKeywords: number | null
  estimatedTraffic: number | null
}

export interface MetricRow {
  key: string
  label: string
  ours: number | null
  competitors: (number | null)[]
  median: number | null
  average: number | null
  best: number | null
  missingToBaseline: number | null
  coveragePct: number | null
  gapPct: number | null
  /** ตัวเลขล้วน ๆ ไม่ใช่เป้าหมาย — ใช้ประกอบ ห้ามสั่งสร้างหน้าตามส่วนต่าง */
  countOnly: boolean
}

// ── Topics ───────────────────────────────────────────────────────────────────

export interface TopicCluster {
  id: string
  label: string
  tokens: string[]
  ourPages: number
  ourUrls: string[]
  competitorPages: number[]
  /** จำนวนคู่แข่งเทียบเคียงที่มีหน้าในคลัสเตอร์นี้ */
  competitorCoverage: number
  comparableCount: number
  medianPages: number
  state: 'missing' | 'weak' | 'strong' | 'low-value'
  sampleTitles: string[]
  dominantType: PageType
}

// ── Keyword gap ──────────────────────────────────────────────────────────────

export type KeywordState =
  | 'MISSING' | 'WEAK' | 'NEAR_WIN' | 'WINNING' | 'DEFEND' | 'UNIQUE_OPPORTUNITY'

/**
 * สิ่งที่ควรทำกับคีย์เวิร์ดหนึ่งคำ (Keyword Opportunity Recommendation)
 *
 * COMPETITOR GAP DECISION RULE: คู่แข่งติดอันดับคำนี้ = หลักฐานว่ามี "โอกาส"
 * ไม่ใช่หลักฐานว่าต้องสร้างหน้าใหม่ — ถ้าเรามีหน้า/คำที่รองรับอยู่แล้ว ให้เสริมของเดิม
 */
export type KeywordOpportunityAction =
  | 'CREATE_NEW'
  | 'ADD_TO_EXISTING'
  | 'MERGE_WITH_EXISTING_TOPIC'
  | 'SEND_TO_KEYWORD_RESEARCH'
  | 'ADD_TO_EXISTING_KEYWORDS'
  | 'ADD_TO_EXCLUDE'
  | 'IGNORE'
  | 'NEEDS_REVIEW'

export interface KeywordGapRow {
  keyword: string
  searchVolume: number | null
  ourPosition: number | null
  ourUrl: string | null
  competitorPositions: (number | null)[]
  competitorCoverage: number
  bestCompetitorPosition: number | null
  state: KeywordState
  intent: string | null
  // ── ชั้น Keyword Opportunity Recommendation (optional — รายงานรุ่นเก่าไม่มีฟิลด์เหล่านี้) ──
  /** คู่แข่งเจ้าที่ติดอันดับดีที่สุดของคำนี้ */
  bestCompetitorDomain?: string | null
  /** เจตนาที่อ่านได้จากตัวคีย์เวิร์ดเอง (คนละชั้นกับ intent ของ DataForSEO) */
  guardIntent?: string | null
  guardTopic?: string | null
  /** คีย์เวิร์ด/หน้าเดิมที่รองรับคำนี้อยู่แล้ว */
  existingMatch?: string | null
  existingUrl?: string | null
  /** 0–100 — 0–39 ต่ำ · 40–59 ต้องตรวจ · 60–79 น่าจะกินกันเอง · 80–100 กินกันเองแน่ */
  cannibalizationRisk?: number | null
  /** 0–100 โอกาสของคำนี้หลังหักความเสี่ยงกินกันเอง */
  opportunityScore?: number | null
  recommendedAction?: KeywordOpportunityAction
  /** เหตุผลที่อ่านรู้เรื่องว่าทำไมถึงแนะนำแบบนี้ */
  actionReasons?: string[]
}

export interface KeywordGapResult {
  available: boolean
  note: string | null
  rows: KeywordGapRow[]
  counts: Record<KeywordState, number>
}

// ── Actions / opportunities ──────────────────────────────────────────────────

export type ActionType = 'FIX' | 'UPGRADE' | 'CREATE' | 'REFRESH' | 'MERGE' | 'KEEP' | 'REVIEW'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export interface GapAction {
  id: string
  priority: Priority
  action: ActionType
  title: string
  /** keyword หลักของหน้านั้น (มาจาก keyword gap จริง หรือ label คลัสเตอร์) */
  primaryKeyword: string | null
  primaryKeywordVolume: number | null
  secondaryKeywords: string[]
  searchIntent: string | null
  pageType: PageType | null
  competitorCoverage: string | null
  existingUrl: string | null
  recommendedUrl: string | null
  reason: string
  evidence: string[]
  topicsToCover: string[]
  internalLinks: string[]
  differentiation: string | null
  impact: 'Very High' | 'High' | 'Medium' | 'Low'
}

export interface SurpassIdea {
  id: string
  title: string
  competitorWeakness: string
  userValue: string
  whyDifferent: string
  seoOpportunity: string
  effort: 'Low' | 'Medium' | 'High'
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface CompetitorSummary {
  domain: string
  /** true = คู่แข่งที่ผู้ใช้ระบุเอง */
  manual?: boolean
  position: number | null
  rankingUrl: string | null
  kind: CompetitorKind
  comparable: boolean
  inventory: DomainInventory
  topClusters: string[]
  coverage: CrawlCoverage
  whyTheyWin: string | null
  whereWeak: string | null
  whatToMatch: string | null
  doNotCopy: string | null
  howToBeat: string | null
}

// ── โครงสร้างบทความ (SEO / AEO / GEO / E-E-A-T) ─────────────────────────────

/** เสาที่ใช้จัดกลุ่มข้อค้นพบ — SEO=อันดับ, AEO=ตอบคำถาม, GEO=ถูกอ้างในคำตอบ AI, EEAT=ความน่าเชื่อถือ */
export type StructurePillar = 'SEO' | 'AEO' | 'GEO' | 'E-E-A-T'

export interface StructureProfile {
  domain: string
  isOurs: boolean
  /** จำนวนหน้าเนื้อหาที่ใช้คิดค่าเหล่านี้ (บทความ/ไกด์/เคส/คำศัพท์) */
  contentPages: number
  medianWordCount: number | null
  medianH2: number | null
  medianH3: number | null
  /** คำก่อนหัวข้อแรก — ย่อหน้านำที่ตอบคำถามทันที */
  medianLeadWords: number | null
  medianCitations: number | null
  questionHeadingPct: number | null
  faqSchemaPct: number | null
  howToSchemaPct: number | null
  articleSchemaPct: number | null
  authorNamedPct: number | null
  datedPct: number | null
  summaryBlockPct: number | null
  answersInLeadPct: number | null
  listPct: number | null
  tablePct: number | null
  imageAltPct: number | null
}

export interface StructureFinding {
  pillar: StructurePillar
  label: string
  ours: number | null
  median: number | null
  /** true = ค่าน้อยกว่าดีกว่า (ยังไม่มีตัวไหนใช้ แต่กันไว้ให้ตารางอ่านถูก) */
  lowerIsBetter: boolean
  unit: '%' | 'คำ' | 'หัวข้อ' | 'ลิงก์'
  status: 'ตามมาตรฐาน' | 'ต่ำกว่ามาตรฐาน' | 'ไม่มีข้อมูล'
  /** สิ่งที่คู่แข่งทำจริง อ้างตัวเลขที่วัดได้ */
  whatCompetitorsDo: string
  /** สิ่งที่ต้องทำเพิ่ม — เขียนจากตัวเลข ไม่ใช่คำแนะนำลอย ๆ */
  fix: string
}

export interface ArticleStructureReport {
  available: boolean
  note: string | null
  ours: StructureProfile | null
  competitors: StructureProfile[]
  median: StructureProfile | null
  findings: StructureFinding[]
  /** ตัวอย่างหน้าเนื้อหาของคู่แข่งที่โครงสร้างครบที่สุด (ดูของจริงได้) */
  exemplars: { domain: string; url: string; title: string; why: string }[]
  summary: string | null
  aiNotes: { pillar: StructurePillar; title: string; whatToDo: string }[]
}

export interface GapReport {
  version: 1
  runId: string
  input: RunInput
  generatedAt: string
  serp: SerpResult
  domains: DomainInventory[]
  competitors: CompetitorSummary[]
  metrics: MetricRow[]
  clusters: TopicCluster[]
  keywordGap: KeywordGapResult
  /** 0–100 คะแนนความพร้อมแข่งขัน (คำนวณจาก metric ที่มีจริงเท่านั้น) */
  readiness: number | null
  readinessBreakdown: { label: string; weight: number; coveragePct: number }[]
  gapToBaselinePct: number | null
  biggestProblem: string | null
  baselineBasis: { comparableDomains: string[]; note: string }
  phase1: {
    actions: GapAction[]
    counts: Record<string, number>
    projectedCoveragePct: number | null
    summary: string | null
  }
  phase2: {
    ideas: SurpassIdea[]
    summary: string | null
  }
  /** วิเคราะห์โครงสร้างบทความเทียบคู่แข่ง (ไม่มีในรายงานรุ่นก่อน จึงเป็น optional) */
  articleStructure?: ArticleStructureReport
  costUsd: number
  warnings: string[]
}

// ── Snapshot ประวัติ (ไว้เทียบความคืบหน้าข้ามรอบสแกน) ───────────────────────

/** ประเภทหน้าที่นับเป็น "หน้าเนื้อหา" เวลาคิด parity กับคู่แข่ง */
export const CONTENT_PAGE_TYPES: PageType[] = ['article', 'guide', 'case-study', 'glossary', 'tool']

/**
 * สรุปย่อของรายงานหนึ่งรอบ — เก็บเฉพาะตัวเลขที่วัดได้จริง ไม่เก็บรายงานเต็ม
 * ใช้ตอบคำถาม "สแกนรอบก่อน gap แคบลงหรือยัง" โดยไม่ต้องเก็บรายงานเก่าทั้งก้อน
 */
export interface GapSnapshot {
  runId: string
  generatedAt: string
  keyword: string
  readiness: number | null
  gapToBaselinePct: number | null
  ourRelevantPages: number | null
  ourContentPages: number | null
  /** จำนวนคำที่เว็บเราติด Top 10 (null = รอบนั้นไม่ได้ดึงข้อมูลคีย์เวิร์ด) */
  ourTop10Keywords: number | null
  keywordCounts: Record<KeywordState, number> | null
  missingClusters: number
  weakClusters: number
  actionCounts: Record<string, number>
}

// ── Run state (เก็บใน AppSetting) ────────────────────────────────────────────

export type RunPhase =
  | 'serp' | 'crawl' | 'classify' | 'topics' | 'keywords'
  | 'baseline' | 'phase1' | 'phase2' | 'structure' | 'done'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface RunStep {
  id: string
  label: string
  status: StepStatus
  detail?: string
}

export interface RunState {
  version: 1
  runId: string
  projectId: string
  input: RunInput
  status: 'running' | 'done' | 'error'
  phase: RunPhase
  /** index โดเมนถัดไปที่ต้อง crawl */
  cursor: number
  steps: RunStep[]
  serp: SerpResult | null
  domains: DomainState[]
  clusters: TopicCluster[]
  keywordGap: KeywordGapResult | null
  report: GapReport | null
  costUsd: number
  warnings: string[]
  error: string | null
  createdAt: string
  updatedAt: string
}
