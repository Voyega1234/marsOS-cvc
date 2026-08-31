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
  costUsd: number
  warnings: string[]
}

// ── Run state (เก็บใน AppSetting) ────────────────────────────────────────────

export type RunPhase =
  | 'serp' | 'crawl' | 'classify' | 'topics' | 'keywords'
  | 'baseline' | 'phase1' | 'phase2' | 'done'

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
