/**
 * WordGod Online (ไม่มีหน้าร้าน / ขายออนไลน์) — Business-Centric SEO/AEO/GEO
 * Keyword Intelligence Engine
 *
 * ไฟล์นี้เป็น type + ค่าคงที่ล้วน ไม่มี I/O — ใช้ร่วมกันทั้ง route, UI และ
 * Excel export เพื่อให้ทุกช่องอ่านจากชุดข้อมูล canonical เดียวกัน
 *
 * กติกาห้ามละเมิด (เหมือนโหมดมีหน้าร้าน):
 *  - AI ทำได้แค่ตีความ/จัดหมวด/ตั้งชื่อ/เขียน title+slug+เหตุผล — ห้ามเป็นแหล่ง
 *    ของตัวเลข volume/CPC/KD/competition/อันดับ SERP/trend ใด ๆ
 *  - Google Keyword Planner = Primary Reference Volume, DataForSEO = cross-check
 *    เก็บแยกกันเสมอ ห้ามเฉลี่ยรวม; reference = Google → DFS → NULL
 *  - GEO ในโหมดนี้ = Generative Engine Optimization (AI search) ไม่ใช่ภูมิศาสตร์
 */

import type {
  GoogleMetricData,
  DfsMetricData,
  ReferenceVolume,
  VolumeConfidence,
  SearchIntentData,
  SerpSignals,
  MetricStatus,
} from '@/lib/wordgod/local/metrics';

// ── Business input ───────────────────────────────────────────────────────────

export type OnlineBusinessType =
  | 'ONLINE_SERVICE'
  | 'ECOMMERCE'
  | 'SAAS'
  | 'DIGITAL_PRODUCT'
  | 'OTHER';

export const BUSINESS_TYPE_LABELS: Record<OnlineBusinessType, string> = {
  ONLINE_SERVICE: 'Online Service / บริการออนไลน์',
  ECOMMERCE: 'Ecommerce / ขายสินค้าออนไลน์',
  SAAS: 'SaaS / ซอฟต์แวร์',
  DIGITAL_PRODUCT: 'Digital Product / สินค้าดิจิทัล',
  OTHER: 'อื่น ๆ',
};

export type StrategyGoal = 'TRAFFIC_GROWTH' | 'BALANCED' | 'LEAD_GENERATION' | 'SALES_FOCUS';

/** น้ำหนัก traffic/sales รวม 100 เสมอ + weight ของคะแนนรวมที่ขยับตามเป้า */
export interface StrategyPreset {
  goal: StrategyGoal;
  label: string;
  traffic: number; // %
  sales: number;   // %
  /** น้ำหนักตอนรวม Final Score (รวมกัน = 1) — business/seo/aeogeo */
  finalWeights: { business: number; seo: number; aeoGeo: number };
}

export const STRATEGY_PRESETS: Record<StrategyGoal, StrategyPreset> = {
  TRAFFIC_GROWTH: {
    goal: 'TRAFFIC_GROWTH', label: 'Traffic Growth', traffic: 70, sales: 30,
    finalWeights: { business: 0.30, seo: 0.45, aeoGeo: 0.25 },
  },
  BALANCED: {
    goal: 'BALANCED', label: 'Balanced', traffic: 50, sales: 50,
    finalWeights: { business: 0.40, seo: 0.35, aeoGeo: 0.25 },
  },
  LEAD_GENERATION: {
    goal: 'LEAD_GENERATION', label: 'Lead Generation', traffic: 40, sales: 60,
    finalWeights: { business: 0.45, seo: 0.35, aeoGeo: 0.20 },
  },
  SALES_FOCUS: {
    goal: 'SALES_FOCUS', label: 'Sales Focus', traffic: 25, sales: 75,
    finalWeights: { business: 0.50, seo: 0.30, aeoGeo: 0.20 },
  },
};

export interface OnlineResearchInput {
  businessType: OnlineBusinessType;
  businessTypeOther?: string;
  websiteUrl?: string;
  brandName?: string;
  /** สินค้า/บริการหลัก — บังคับอย่างน้อย 1 */
  products: string[];
  targetCustomer?: string;
  customerProblems?: string[];
  country?: string;   // default 'Thailand'
  language?: string;  // default 'th'
  strategyGoal: StrategyGoal;
  targetCount: number; // 50–1000
  competitorDomains?: string[]; // 1–10
  existingPages?: string[];
  includeBrandKeywords?: boolean;      // default true
  includeComparisonKeywords?: boolean; // default true
  includeProblemKeywords?: boolean;    // default true
  businessContext?: string;
}

// ── Journey taxonomy (19 ขั้น, business-centric) ─────────────────────────────

export type JourneyStage =
  | 'PROBLEM_AWARENESS'
  | 'SYMPTOM_SEARCH'
  | 'CAUSE_EXPLORATION'
  | 'EDUCATION_BASICS'
  | 'HOW_TO_DIY'
  | 'SOLUTION_AWARENESS'
  | 'SOLUTION_COMPARISON'
  | 'PRODUCT_DISCOVERY'
  | 'FEATURE_EXPLORATION'
  | 'USE_CASE_FIT'
  | 'VENDOR_COMPARISON'
  | 'REVIEWS_PROOF'
  | 'PRICING_COST'
  | 'OBJECTION_RISK'
  | 'PURCHASE_INTENT'
  | 'CHANNEL_WHERE_TO_BUY'
  | 'ONBOARDING_USAGE'
  | 'AEO_QUESTION'
  | 'GEO_AI_TOPIC';

export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU';
export type Objective = 'TRAFFIC' | 'LEAD' | 'SALE';

export interface JourneyStageDef {
  stage: JourneyStage;
  order: number;          // 1–19
  labelTh: string;
  /** funnel เริ่มต้น (ปรับได้ตาม intent จริง) */
  funnel: FunnelStage;
  /** ช่วง Revenue Proximity ของขั้นนี้ [min, max] — ค่าจริงขยับตาม intent/สัญญาณ */
  revenueProximity: [number, number];
  objective: Objective;
}

export const JOURNEY_STAGES: JourneyStageDef[] = [
  { stage: 'PROBLEM_AWARENESS',   order: 1,  labelTh: 'รู้ตัวว่ามีปัญหา',            funnel: 'TOFU', revenueProximity: [45, 70], objective: 'TRAFFIC' },
  { stage: 'SYMPTOM_SEARCH',      order: 2,  labelTh: 'ค้นอาการ/สัญญาณ',            funnel: 'TOFU', revenueProximity: [45, 65], objective: 'TRAFFIC' },
  { stage: 'CAUSE_EXPLORATION',   order: 3,  labelTh: 'หาสาเหตุ',                    funnel: 'TOFU', revenueProximity: [40, 60], objective: 'TRAFFIC' },
  { stage: 'EDUCATION_BASICS',    order: 4,  labelTh: 'หาความรู้พื้นฐาน',            funnel: 'TOFU', revenueProximity: [10, 40], objective: 'TRAFFIC' },
  { stage: 'HOW_TO_DIY',          order: 5,  labelTh: 'หาวิธีทำเอง',                 funnel: 'TOFU', revenueProximity: [20, 45], objective: 'TRAFFIC' },
  { stage: 'SOLUTION_AWARENESS',  order: 6,  labelTh: 'รู้ว่ามีทางแก้',              funnel: 'MOFU', revenueProximity: [55, 75], objective: 'LEAD' },
  { stage: 'SOLUTION_COMPARISON', order: 7,  labelTh: 'เทียบแนวทางแก้',              funnel: 'MOFU', revenueProximity: [70, 90], objective: 'LEAD' },
  { stage: 'PRODUCT_DISCOVERY',   order: 8,  labelTh: 'ค้นหมวดสินค้า/บริการ',        funnel: 'MOFU', revenueProximity: [70, 90], objective: 'LEAD' },
  { stage: 'FEATURE_EXPLORATION', order: 9,  labelTh: 'เจาะฟีเจอร์/สเปก',            funnel: 'MOFU', revenueProximity: [65, 85], objective: 'LEAD' },
  { stage: 'USE_CASE_FIT',        order: 10, labelTh: 'เช็คว่าเหมาะกับเคสตัวเอง',    funnel: 'MOFU', revenueProximity: [65, 85], objective: 'LEAD' },
  { stage: 'VENDOR_COMPARISON',   order: 11, labelTh: 'เทียบเจ้า/แบรนด์',            funnel: 'MOFU', revenueProximity: [75, 95], objective: 'LEAD' },
  { stage: 'REVIEWS_PROOF',       order: 12, labelTh: 'หารีวิว/หลักฐาน',             funnel: 'MOFU', revenueProximity: [70, 90], objective: 'LEAD' },
  { stage: 'PRICING_COST',        order: 13, labelTh: 'เช็คราคา/ค่าใช้จ่าย',         funnel: 'BOFU', revenueProximity: [90, 100], objective: 'SALE' },
  { stage: 'OBJECTION_RISK',      order: 14, labelTh: 'คลายข้อกังวล/ความเสี่ยง',     funnel: 'BOFU', revenueProximity: [70, 90], objective: 'SALE' },
  { stage: 'PURCHASE_INTENT',     order: 15, labelTh: 'พร้อมซื้อ/จ้าง/สมัคร',        funnel: 'BOFU', revenueProximity: [95, 100], objective: 'SALE' },
  { stage: 'CHANNEL_WHERE_TO_BUY',order: 16, labelTh: 'หาช่องทางซื้อ',               funnel: 'BOFU', revenueProximity: [85, 100], objective: 'SALE' },
  { stage: 'ONBOARDING_USAGE',    order: 17, labelTh: 'ใช้งานหลังซื้อ',              funnel: 'BOFU', revenueProximity: [30, 55], objective: 'TRAFFIC' },
  { stage: 'AEO_QUESTION',        order: 18, labelTh: 'คำถามตรง (Answer Engine)',    funnel: 'TOFU', revenueProximity: [25, 60], objective: 'TRAFFIC' },
  { stage: 'GEO_AI_TOPIC',        order: 19, labelTh: 'หัวข้อ AI Search (Generative)',funnel: 'TOFU', revenueProximity: [30, 65], objective: 'TRAFFIC' },
];

export const JOURNEY_STAGE_MAP: Record<JourneyStage, JourneyStageDef> = Object.fromEntries(
  JOURNEY_STAGES.map(def => [def.stage, def])
) as Record<JourneyStage, JourneyStageDef>;

// ── Business Blueprint (ผลจากชั้น AI interpretation — ไม่มีตัวเลข metric) ────

export interface BusinessSegment {
  name: string;
  description: string;
  /** USER = ผู้ใช้กรอกเอง, AI_INFERRED = AI สรุปจากบริบท */
  source: 'USER' | 'AI_INFERRED';
}

export interface ProblemMapEntry {
  problem: string;
  segment: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  searchBehaviors: string[]; // วลีที่คนน่าจะพิมพ์ค้น (ภาษาไทยจริง)
  relatedProduct: string;
}

export interface JtbdEntry {
  job: string;            // "จ้างให้..." ในมุมลูกค้า
  segment: string;
  triggeredBy: string;    // สถานการณ์ที่จุดชนวน
  desiredOutcome: string;
}

export interface SolutionMapEntry {
  problem: string;
  solutions: string[];     // ทางแก้ (รวมทางเลือกอื่นนอกจากซื้อของเรา)
  ourAnswer: string;       // สินค้า/บริการเราตอบข้อไหน
}

export interface PurchaseFactor {
  factor: string;          // เช่น ราคา ความน่าเชื่อถือ รีวิว ความเร็ว
  weight: 'HIGH' | 'MEDIUM' | 'LOW';
  keywordAngles: string[]; // มุมคีย์เวิร์ดที่สะท้อน factor นี้
}

export interface TaxonomyNode {
  branch: string;              // ชื่อกิ่ง เช่น "ปัญหา-อาการ", "เทียบแบรนด์"
  journeyStages: JourneyStage[];
  product: string;             // ผูกกับสินค้า/บริการตัวไหน
  seedKeywords: string[];      // seed จริงที่ใช้ยิง discovery
}

export interface BusinessBlueprint {
  businessSummary: string;
  segments: BusinessSegment[];
  problemMap: ProblemMapEntry[];
  jtbd: JtbdEntry[];
  solutionMap: SolutionMapEntry[];
  purchaseFactors: PurchaseFactor[];
  taxonomy: TaxonomyNode[];
  /** สินค้า/อุปกรณ์/บริการที่ธุรกิจ "ไม่ได้ขาย-ไม่ได้ให้บริการ" แต่เสี่ยงติดมากับคำค้นหมวดใกล้กัน — ใช้กรองคำหลุดธุรกิจ */
  negativeEntities: string[];
  /** ชื่อแบรนด์/ร้านคู่แข่ง — คำค้นที่เป็นแบรนด์คนอื่นถูกคัดออก (checkpoint เก่าอาจไม่มี ให้ guard ?? []) */
  competitorBrands: string[];
  customerSource: 'USER' | 'AI_INFERRED';
}

// ── Website context (สแกนบริบทธุรกิจเท่านั้น — ไม่ใช่ technical audit) ───────

export interface WebsiteContext {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  navLabels: string[];
  /** path ภายในที่เจอ — ใช้เรียนรู้ slug convention + เช็ค slug ซ้ำ */
  existingPaths: string[];
  slugConvention: 'latin' | 'thai' | 'mixed' | 'unknown';
  fetchedAt: string;
  status: 'ok' | 'failed' | 'skipped';
  error?: string;
}

// ── System Scores (0–100 — ป้ายกำกับ "System Score" ห้ามอ้างว่ามาจาก Google/DFS) ──

export interface SystemScores {
  businessRelevance: number;
  problemRelevance: number;
  revenueProximity: number;
  seoOpportunity: number;
  aeoOpportunity: number;
  geoOpportunity: number;
  businessScore: number;
  finalScore: number;
  cannibalizationPenalty: number;
}

// ── Cluster / cannibalization / sitemap ─────────────────────────────────────

export type CannibalizationAction = 'KEEP' | 'MERGE' | 'USE_AS_SECONDARY' | 'OPTIMIZE_EXISTING' | 'DROP';
export type SlugStatus = 'NEW' | 'EXISTING' | 'CONFLICT' | 'REVIEW';
export type TopicRole = 'PILLAR' | 'CLUSTER' | 'SUPPORTING' | 'MONEY_PAGE';
export type PageType = 'LANDING_PAGE' | 'PRODUCT_PAGE' | 'CATEGORY_PAGE' | 'ARTICLE' | 'COMPARISON_PAGE' | 'FAQ_PAGE' | 'CASE_STUDY';
export type HandoffStatus = 'RESEARCHED' | 'SELECTED' | 'SENT_TO_KEYWORDS' | 'REVIEW';

export interface SitemapPlacement {
  section: string;
  parentTopic: string | null;
  topicRole: TopicRole;
  suggestedPath: string;
  /** URL จริงจากเว็บลูกค้า (site scan) เท่านั้น — ไม่มีข้อมูลจริง = null ห้ามแต่ง */
  internalLinkTarget: string | null;
}

// ── Canonical keyword row ────────────────────────────────────────────────────

export interface OnlineKeywordResult {
  rank: number;
  keyword: string;
  rawKeyword: string;
  seedKeyword: string | null;
  sources: string[];  // ai_taxonomy | dfs_ideas | competitor:<domain> | pattern | user
  serviceOrProduct: string;
  cluster: string;
  clusterId: number;
  clusterRole: 'PRIMARY' | 'SECONDARY';
  secondaryKeywords: string[];
  problemGroup: string | null;

  // Volume Trust Layer — reuse โครงเดียวกับโหมด local ทุกช่อง
  google: GoogleMetricData;
  dfs: DfsMetricData;
  reference: ReferenceVolume;
  confidence: VolumeConfidence;

  searchIntent: SearchIntentData;
  businessIntent: 'INFORMATIONAL' | 'EVALUATIVE' | 'TRANSACTIONAL';
  journeyStage: JourneyStage;
  journeyOrder: number;
  funnelStage: FunnelStage;
  objective: Objective;

  serp: SerpSignals;
  scores: SystemScores;

  pageType: PageType;
  cannibalizationAction: CannibalizationAction;
  cannibalizationTarget: string | null;

  recommendedTitle: string | null;
  suggestedSlug: string | null;
  slugStatus: SlugStatus;
  whyThisKeyword: string | null;

  sitemap: SitemapPlacement;
  priorityWave: 1 | 2 | 3;
  handoffStatus: HandoffStatus;
}

// ── Progress steps (~24 ขั้น ให้ UI แสดง checklist จริง ไม่มี blank loading) ──

export interface OnlineStepDef { index: number; key: string; label: string }

export const ONLINE_STEPS: OnlineStepDef[] = [
  { index: 1,  key: 'validate',        label: 'ตรวจข้อมูลธุรกิจที่กรอก' },
  { index: 2,  key: 'site_scan',       label: 'สแกนบริบทจากเว็บไซต์ (ถ้าให้มา)' },
  { index: 3,  key: 'business_map',    label: 'สร้าง Business Map' },
  { index: 4,  key: 'segments',        label: 'วิเคราะห์กลุ่มลูกค้า (Segments)' },
  { index: 5,  key: 'problem_map',     label: 'สร้าง Problem Map' },
  { index: 6,  key: 'jtbd',            label: 'วิเคราะห์ Jobs-to-be-Done' },
  { index: 7,  key: 'solution_map',    label: 'สร้าง Solution Map' },
  { index: 8,  key: 'purchase',        label: 'วิเคราะห์ Purchase Factors' },
  { index: 9,  key: 'journey',         label: 'วาง Customer Journey 19 ขั้น' },
  { index: 10, key: 'taxonomy',        label: 'สร้าง Keyword Taxonomy' },
  { index: 11, key: 'seeds',           label: 'สร้าง Seed Keywords' },
  { index: 12, key: 'discovery_dfs',   label: 'ขยายคำจาก DataForSEO' },
  { index: 13, key: 'discovery_comp',  label: 'ขุดคำจากคู่แข่ง' },
  { index: 14, key: 'normalize',       label: 'ทำความสะอาด/รวมคำซ้ำ' },
  { index: 15, key: 'kp_volume',       label: 'ดึง Volume จาก Google Keyword Planner' },
  { index: 16, key: 'dfs_volume',      label: 'Cross-check Volume กับ DataForSEO' },
  { index: 17, key: 'intent',          label: 'ตรวจ Search Intent (DataForSEO)' },
  { index: 18, key: 'kd',              label: 'ตรวจ Keyword Difficulty' },
  { index: 19, key: 'classify',        label: 'จัด Journey / Funnel / Objective' },
  { index: 20, key: 'serp',            label: 'ตรวจ SERP คำสำคัญ (คัดเฉพาะที่จำเป็น)' },
  { index: 21, key: 'scoring',         label: 'คำนวณ System Scores' },
  { index: 22, key: 'clusters',        label: 'จัด Cluster + กันคำกินกันเอง' },
  { index: 23, key: 'titles',          label: 'เขียน Title / Slug / เหตุผล' },
  { index: 24, key: 'finalize',        label: 'จัด Wave + Sitemap + สรุปผล' },
];

// ── Response ────────────────────────────────────────────────────────────────

export interface OnlineSourceStatus {
  googleKeywordPlanner: { status: string; coverage: number; geo: string; fetchedAt: string | null; message?: string };
  dataForSeo: { status: string; coverage: number; fetchedAt: string | null; message?: string };
  serp: { status: string; checkedCount: number; fetchedAt: string | null; message?: string };
  ai: { provider: string; role: string };
}

export interface OnlineClusterSummary {
  clusterId: number;
  name: string;
  primaryKeyword: string;
  keywordCount: number;
  totalReferenceVolume: number;
  topicRole: TopicRole;
  section: string;
}

export interface OnlineResearchResponse {
  meta: {
    mode: 'online_business';
    researchId: string | null;
    generatedAt: string;
    businessType: OnlineBusinessType;
    businessTypeOther: string | null;
    brandName: string | null;
    websiteUrl: string | null;
    strategyGoal: StrategyGoal;
    weights: { traffic: number; sales: number };
    finalWeights: { business: number; seo: number; aeoGeo: number };
    country: string;
    language: string;
    targetCount: number;
    candidateCount: number;
    qualifiedCount: number;
    clientReady: boolean;
    verifiedVolumeCoverage: number;
    customerSource: 'USER' | 'AI_INFERRED';
    warnings: string[];
    shortfallReason: string | null;
  };
  blueprint: BusinessBlueprint;
  websiteContext: WebsiteContext | null;
  results: OnlineKeywordResult[];
  clusters: OnlineClusterSummary[];
  sourceStatus: OnlineSourceStatus;
}

// ── ค่าคงที่ระบบ ────────────────────────────────────────────────────────────

export const ONLINE_TARGET_MIN = 50;
export const ONLINE_TARGET_MAX = 1000;
export const ONLINE_TARGET_PRESETS = [50, 100, 200, 300, 500, 550, 750, 1000];
/** pool ต้องใหญ่กว่า target หลายเท่า (สเปก: 8–16×) */
export const POOL_MULTIPLIER_MIN = 8;
export const POOL_MULTIPLIER_MAX = 16;

export function clampTargetCount(n: number): number {
  if (!Number.isFinite(n)) return 300;
  return Math.min(ONLINE_TARGET_MAX, Math.max(ONLINE_TARGET_MIN, Math.round(n)));
}
