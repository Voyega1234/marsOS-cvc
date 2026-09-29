/**
 * Keyword Intent Skill — ชนิดข้อมูลกลาง (ใช้ร่วมกันทั้งโหมด online_business และ local_storefront)
 *
 * ขั้นตอน: intent รายคีย์เวิร์ด → เช็คความเข้ากับธุรกิจจริง → ตัดสินประเภทหน้า
 *          → จัดกลุ่ม (1 กลุ่ม = 1 URL) → Topic Cluster → intent mix/ช่องว่าง → Remark/Approve/Quota
 * prompt ของ skill เขียนในโค้ด (ข้อยกเว้นเฉพาะ keyword research ที่ผู้ใช้อนุญาต)
 * ทุกฟิลด์ที่ไปติดกับผลเก่าเป็น optional — ผลรุ่นเก่าที่ไม่มี skill ต้องแสดงได้เหมือนเดิม
 */

/** I = Informational, C = Commercial, T = Transactional, N = Navigational */
export type IntentCode = 'I' | 'C' | 'T' | 'N';
/** ป้าย intent (ผสมได้) — ป้ายไม่บอกลำดับ ดู intent หลักที่ KeywordIntent.primary */
export type IntentMix = IntentCode | 'I/C' | 'I/T' | 'C/T';

export interface IntentEvidence {
  source: 'cue' | 'serp' | 'dfs' | 'llm' | 'profile';
  detail: string;
}

export interface KeywordIntent {
  primary: IntentCode;
  mix: IntentMix;
  /** 0–1 */
  confidence: number;
  evidence: IntentEvidence[];
  /** true = หลักฐานขัดกันหรือไม่ชัด ให้คนตรวจ */
  needsReview: boolean;
}

/** ข้อมูลธุรกิจจริงที่ผู้ใช้กรอกในหน้า Keyword Research (ว่างได้ทุกช่อง) */
export interface BusinessProfile {
  /** บริการ/สินค้าที่ทำจริง */
  servicesOffered: string[];
  /** บริการที่ไม่ได้ทำ — คีย์เวิร์ดกลุ่มนี้ทำได้แค่บทความ */
  servicesNotOffered: string[];
  /** มีร้านขายของออนไลน์/หน้าร้านที่ขายสินค้าจริงไหม */
  hasShop: boolean;
  /** สินค้าที่ขาย (ถ้ามีร้าน) */
  shopProducts: string[];
  /** สาขา/พื้นที่ให้บริการจริง */
  branches: string[];
  /** ชื่อแบรนด์คู่แข่ง — คีย์เวิร์ดที่มีชื่อเหล่านี้ไม่แนะนำ */
  competitorBrands: string[];
  /** ชื่อแบรนด์ของเราเอง (ถ้ามี) — คีย์เวิร์ดแบรนด์ตัวเองเป็น N และเข้าหน้าแรก */
  ownBrand?: string;
}

export type FitVerdict = 'FIT' | 'ARTICLE_ONLY' | 'NOT_RECOMMENDED';

export type FitReasonCode =
  | 'no_profile'
  | 'offered_service'
  | 'service_not_offered'
  | 'product_without_shop'
  | 'location_without_branch'
  | 'competitor_brand'
  | 'translation_seeking'
  | 'own_brand';

export interface FitResult {
  verdict: FitVerdict;
  reasons: FitReasonCode[];
  /** หมายเหตุภาษาไทยที่แสดงในคอลัมน์ Remark */
  remarkTh: string;
}

export type UnifiedPageType = 'HOMEPAGE' | 'SERVICE' | 'CATEGORY' | 'LOCATION' | 'COMPARISON' | 'TOOL' | 'BLOG';
export type PageTier = 'PRIMARY' | 'SECONDARY' | 'BLOG';

/** ข้อมูลต่อคีย์เวิร์ดที่ adapter ของแต่ละโหมดส่งเข้า skill */
export interface IntentSkillInputRow {
  /** คีย์อ้างอิงแถว = keyword ตามที่อยู่ในผลลัพธ์ (ใช้ map กลับ) */
  key: string;
  keyword: string;
  volume: number | null;
  /** intent จาก DataForSEO (informational | navigational | commercial | transactional) */
  dfsIntent?: string | null;
  dfsProbability?: number | null;
  /** URL top 10 ของ SERP (ใช้วัด overlap ตอนจัดกลุ่ม) */
  serpTopUrls?: string[];
  /** โหมด local: service | mixed | informational */
  serpIntent?: string | null;
  serpServicePageCount?: number;
  serpArticleCount?: number;
  hasLocalPack?: boolean;
  /** พื้นที่ที่ตรวจพบในคีย์เวิร์ด (โหมด local) */
  location?: string | null;
  /** บริการ/สินค้าที่ pipeline เดิมจับคู่ให้ */
  service?: string | null;
  /** cluster เดิมของ pipeline — ใช้เป็น hint ตอนทำ Topic Cluster */
  legacyCluster?: string | null;
  /** page type เดิม (online PageType / local SuggestedPageType) */
  legacyPageType?: string | null;
  title?: string | null;
  slug?: string | null;
}

/** ฟิลด์ที่ skill ติดกลับไปบนแถวผลลัพธ์ (row.isk) */
export interface IntentSkillRowFields {
  intent: KeywordIntent;
  fit: FitResult;
  pageType: UnifiedPageType;
  tier: PageTier;
  groupId: string;
  isGroupHead: boolean;
  clusterId: string;
  /** ชื่อ Topic Cluster (ตั้งโดย AI หรือ fallback) */
  clusterName: string;
  section: string;
  /** slug ของกลุ่มแบบซ้อน เช่น /pest-control/termite/ */
  nestedSlug: string;
  remark: string;
  approved: boolean;
}

export interface KeywordGroup {
  id: string;
  /** คีย์เวิร์ดหลัก = volume สูงสุดในกลุ่ม */
  head: string;
  keywords: string[];
  intent: IntentMix;
  pageType: UnifiedPageType;
  tier: PageTier;
  /** volume สูงสุดในกลุ่ม (null = ไม่มีข้อมูล volume ทั้งกลุ่ม) */
  highestSv: number | null;
  /** volume รวมของทุกคีย์เวิร์ดที่มีข้อมูล */
  totalSv: number | null;
  slug: string;
  nestedSlug: string;
  pageTitle: string;
  clusterId: string;
  fit: FitVerdict;
  approved: boolean;
  remark: string;
  needsReview: boolean;
}

export interface ClusterLink {
  fromGroupId: string;
  toGroupId: string;
  /** เช่น I→C, C→T, spoke→hub */
  kind: string;
}

export interface TopicCluster {
  id: string;
  name: string;
  section: string;
  slugBase: string;
  /** % ของแต่ละ intent ในคลัสเตอร์ (นับตามจำนวนกลุ่ม) รวม = 100 */
  mix: Record<IntentCode, number>;
  /** ข้อความภาษาไทย เช่น "มีแต่บทความ ยังไม่มีหน้าขาย" */
  gaps: string[];
  pillarGroupId: string;
  groupIds: string[];
  /** แผน internal link hub-spoke I → C → T */
  links: ClusterLink[];
  /** หน้า Pillar Intent = intent ของกลุ่ม pillar */
  pillarIntent: IntentMix;
}

export interface IntentSkillStats {
  rows: number;
  groups: number;
  clusters: number;
  needsReview: number;
  fit: number;
  articleOnly: number;
  notRecommended: number;
}

/** ผลรวมที่เก็บใน resultData.intentSkill */
export interface IntentSkillResult {
  version: 1;
  generatedAt: string;
  profileUsed: boolean;
  profile?: BusinessProfile;
  groups: KeywordGroup[];
  clusters: TopicCluster[];
  quota: { requested: number | null; approved: number };
  stats: IntentSkillStats;
  /** ข้อความเตือน เช่น AI ตั้งชื่อ cluster ไม่สำเร็จ ใช้ชื่อสำรอง */
  warnings: string[];
}

/** ฟังก์ชันเรียก LLM — คืน JSON ที่ parse แล้ว (production ใช้ callGemini) */
export type IntentSkillLlm = (prompt: string, functionLabel: string) => Promise<unknown>;

export interface IntentSkillContext {
  mode: 'online' | 'local';
  profile?: BusinessProfile;
  /** ชื่อ/ประเภท/คำอธิบายธุรกิจสั้น ๆ สำหรับใส่ใน prompt */
  businessContext: string;
  language?: 'th' | 'en' | 'both';
  /** จำนวนกลุ่มที่ให้ auto-approve (null/undefined = อนุมัติทุกกลุ่มที่ FIT/ARTICLE_ONLY) */
  quota?: number | null;
  /** ไม่ส่ง = ใช้ rule ล้วน ไม่เรียก AI (ใช้ในเทสต์ / fallback) */
  llm?: IntentSkillLlm;
}

export interface IntentSkillOutput {
  /** key = IntentSkillInputRow.key */
  rowFields: Record<string, IntentSkillRowFields>;
  result: IntentSkillResult;
}
