/**
 * Keyword Guard — ชั้นกันคีย์เวิร์ดกินกันเอง (cannibalization) ที่ใช้ร่วมกัน
 * ระหว่างหน้า Keyword Research (wordgod local/online) และ Competitor Gap
 *
 * หลักการ (คำสั่งเจ้าของระบบ 2026-08-31):
 *  - CANNIBALIZATION-FIRST: ก่อนจะสร้างกลุ่ม/คลัสเตอร์/หัวข้อ/หน้าใหม่ ต้องเทียบกับ
 *    คีย์เวิร์ดเดิม หัวข้อเดิม หน้าเดิม กลุ่มเดิม candidate ในรอบเดียวกัน และ exclude list ก่อน
 *  - ไม่แน่ใจ = MERGE หรือ REVIEW ห้ามเดาว่า CREATE NEW
 *  - Search Intent เป็นตัวตัดสินหลัก: token ซ้ำกันแต่เจตนาต่างกัน ห้ามรวม
 *  - ทุกการตัดออกต้องอธิบายเหตุผลได้ (traceable) — ไม่มีการตัดเงียบ
 *
 * ไฟล์นี้เป็น type ล้วน ไม่มี I/O
 */

/** เจตนาการค้นหาหลัก */
export type PrimaryIntent = 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL' | 'NAVIGATIONAL';

/** เจตนาย่อย — ตัวคุมว่าคำที่ token ซ้ำกันเป็นคนละหน้าไหม */
export type SubIntent =
  | 'DEFINITION' | 'HOW_TO' | 'CAUSE' | 'GENERAL_INFO'
  | 'PRICE' | 'COMPARISON' | 'REVIEW' | 'RECOMMENDATION'
  | 'HIRE_SERVICE' | 'BUY' | 'CONTACT' | 'LOCATION' | 'BRAND';

export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU';

export interface IntentSignals {
  primaryIntent: PrimaryIntent;
  subIntent: SubIntent;
  /** สิ่งที่คำนี้พูดถึงจริง ๆ (หัวเรื่อง) — null = แยกไม่ออกจากคำเดียว */
  mainEntity: string | null;
  /** หัวข้อระดับกลุ่ม = entity + เจตนาย่อย ใช้จับว่าเป็นหน้าเดียวกันไหม */
  topic: string;
  /** คำขยายที่ตรวจพบ (ราคา/ใกล้ฉัน/รีวิว/ด่วน ฯลฯ) */
  modifiers: string[];
  /** ปัญหาของลูกค้าที่อยู่เบื้องหลังคำค้น (เดาจาก pattern ที่ชัดเจนเท่านั้น) */
  customerProblem: string | null;
  /** สิ่งที่ผู้ค้นอยากได้จากหน้าเว็บ */
  desiredOutcome: string | null;
  funnelStage: FunnelStage;
  /** ประเภทเนื้อหาที่ควรรองรับคำนี้ */
  recommendedContentType: string;
}

/**
 * ลายนิ้วมือคีย์เวิร์ด — คีย์เปรียบเทียบทุกชั้น (ชื่อฟิลด์ยืดหยุ่นได้ แต่พฤติกรรมตายตัว)
 *  exactKey    : ตัดช่องว่าง/วรรคตอน/ตัวพิมพ์ — "รับทำ seo" = "รับทำseo" = "รับทำ SEO"
 *  orderKey    : ตัดคำแล้วเรียง — "seo agency thailand" = "thailand seo agency"
 *  semanticKey : map คำพ้องความหมาย — "ราคา SEO" = "ค่าบริการ SEO" = "แพ็กเกจ SEO"
 *  intentKey   : primary+sub intent — ตัวกันไม่ให้คำคนละเจตนาถูกรวมกัน
 */
export interface KeywordFingerprint {
  raw: string;
  display: string;
  exactKey: string;
  orderKey: string;
  semanticKey: string;
  intentKey: string;
  tokens: string[];
  head: string | null;
  intent: IntentSignals;
}

/** ที่มาของสิ่งที่ candidate ไปชนเข้า */
export type MatchSource =
  | 'EXISTING_KEYWORD' | 'EXISTING_TOPIC' | 'EXISTING_PAGE' | 'EXISTING_GROUP'
  | 'APPROVED_KEYWORD' | 'COMPETITOR_GAP' | 'RUN_CANDIDATE' | 'EXCLUDE_LIST' | 'NONE';

/** วิธีที่ชน — ต้องระบุได้เสมอเพื่อให้เหตุผลตรวจสอบย้อนกลับได้ */
export type MatchType =
  | 'EXACT' | 'SPACING' | 'WORD_ORDER' | 'SEMANTIC' | 'TOKEN_OVERLAP'
  | 'URL_PATH' | 'PHRASE' | 'NONE';

export type RiskBand = 'LOW' | 'REVIEW' | 'LIKELY' | 'STRONG';

/** สิ่งที่ระบบแนะนำให้ทำกับ candidate ตัวนี้ */
export type GuardDecision =
  | 'CREATE_NEW'
  | 'MERGE'
  | 'ADD_AS_SECONDARY'
  | 'MAP_TO_EXISTING_TOPIC'
  | 'MAP_TO_EXISTING_PAGE'
  | 'NEEDS_REVIEW'
  | 'EXCLUDE';

export interface GuardMatch {
  keyword: string;
  url: string | null;
  source: MatchSource;
  type: MatchType;
  /** 0–1 ความใกล้เคียงที่วัดได้จริงของชั้นที่ทำให้ชน */
  similarity: number;
  sameIntent: boolean;
}

export interface GuardVerdict {
  keyword: string;
  fingerprint: KeywordFingerprint;
  decision: GuardDecision;
  /** 0–100 ตามสเปก: 0–39 Low · 40–59 Review · 60–79 Likely · 80–100 Strong */
  risk: number;
  band: RiskBand;
  match: GuardMatch | null;
  /** เหตุผลที่มนุษย์อ่านรู้เรื่อง — ทุกใบตัดสินต้องมีอย่างน้อย 1 บรรทัด */
  reasons: string[];
}

// ── หน่วยความจำระดับโปรเจกต์ (ใช้ร่วมกันสองโมดูล) ────────────────────────────

export type ExistingKind = 'keyword' | 'topic' | 'page' | 'group' | 'approved';

export interface ExistingEntry {
  keyword: string;
  /** URL ของหน้าที่รองรับคำนี้อยู่แล้ว (ถ้ามี) */
  url: string | null;
  kind: ExistingKind;
  /** มาจากไหน: manual | competitor_gap | keyword_research | site_scan */
  source: string;
  addedAt: string;
}

export type ExcludeMode = 'exact' | 'phrase';

export interface ExcludeEntry {
  keyword: string;
  mode: ExcludeMode;
  reason: string | null;
  source: string;
  addedAt: string;
}

export interface KeywordMemory {
  existing: ExistingEntry[];
  exclude: ExcludeEntry[];
  updatedAt: string | null;
}

/** คำที่ส่งจาก Competitor Gap ไปหน้า Keyword Research */
export interface HandoffItem {
  keyword: string;
  source: 'competitor_gap';
  competitor: string | null;
  intent: string | null;
  topic: string | null;
  suggestedAction: string | null;
  existingMatch: string | null;
  existingUrl: string | null;
  cannibalizationScore: number | null;
  volume: number | null;
  sentAt: string;
}

export const RISK_BANDS: Array<{ band: RiskBand; min: number; max: number; labelTh: string }> = [
  { band: 'LOW', min: 0, max: 39, labelTh: 'เสี่ยงต่ำ — สร้างใหม่ได้' },
  { band: 'REVIEW', min: 40, max: 59, labelTh: 'ต้องตรวจก่อน' },
  { band: 'LIKELY', min: 60, max: 79, labelTh: 'น่าจะกินกันเอง' },
  { band: 'STRONG', min: 80, max: 100, labelTh: 'กินกันเองแน่' },
];

export function bandOf(risk: number): RiskBand {
  if (risk >= 80) return 'STRONG';
  if (risk >= 60) return 'LIKELY';
  if (risk >= 40) return 'REVIEW';
  return 'LOW';
}

export const DECISION_LABEL_TH: Record<GuardDecision, string> = {
  CREATE_NEW: 'สร้างกลุ่ม/หน้าใหม่',
  MERGE: 'รวมกับคำเดิม',
  ADD_AS_SECONDARY: 'ใส่เป็นคำรอง',
  MAP_TO_EXISTING_TOPIC: 'ผูกกับหัวข้อเดิม',
  MAP_TO_EXISTING_PAGE: 'ผูกกับหน้าเดิม',
  NEEDS_REVIEW: 'ต้องให้คนตรวจ',
  EXCLUDE: 'ตัดออก',
};

export const MATCH_SOURCE_LABEL_TH: Record<MatchSource, string> = {
  EXISTING_KEYWORD: 'คีย์เวิร์ดที่มีอยู่แล้ว',
  EXISTING_TOPIC: 'หัวข้อที่มีอยู่แล้ว',
  EXISTING_PAGE: 'หน้าที่มีอยู่แล้ว',
  EXISTING_GROUP: 'กลุ่มคีย์เวิร์ดเดิม',
  APPROVED_KEYWORD: 'คีย์เวิร์ดที่อนุมัติแล้ว',
  COMPETITOR_GAP: 'คำจาก Competitor Gap',
  RUN_CANDIDATE: 'คำในรอบนี้เอง',
  EXCLUDE_LIST: 'รายการคำที่ไม่เอา',
  NONE: '—',
};

export const MATCH_TYPE_LABEL_TH: Record<MatchType, string> = {
  EXACT: 'ตรงกันทุกตัวอักษร',
  SPACING: 'ต่างแค่การเว้นวรรค',
  WORD_ORDER: 'คำเดียวกันสลับตำแหน่ง',
  SEMANTIC: 'ความหมายเดียวกัน',
  TOKEN_OVERLAP: 'คำซ้ำกันเป็นส่วนใหญ่',
  URL_PATH: 'ตรงกับ URL ที่มีอยู่',
  PHRASE: 'มีวลีที่สั่งห้ามอยู่ในคำ',
  NONE: '—',
};

// ── รูปย่อที่แนบไปกับผลลัพธ์ของทั้งสองหน้า (optional เสมอ — ผลรุ่นเก่าไม่มีก็ยังอ่านได้) ──

export interface KeywordGuardInfo {
  decision: GuardDecision;
  risk: number;
  band: RiskBand;
  existingMatch: string | null;
  existingUrl: string | null;
  matchSource: MatchSource | null;
  matchType: MatchType | null;
  primaryIntent: PrimaryIntent;
  subIntent: SubIntent;
  topic: string;
  mainEntity: string | null;
  funnelStage: FunnelStage;
  recommendedContentType: string;
  reasons: string[];
}

/** คำที่ถูกตัดออก พร้อมเหตุผลที่ตรวจสอบย้อนกลับได้ (§11) */
export interface ExcludedKeyword {
  keyword: string;
  decision: GuardDecision;
  risk: number;
  matchType: MatchType;
  matchSource: MatchSource;
  matchedKeyword: string | null;
  matchedUrl: string | null;
  reason: string;
}

export interface GuardSummary {
  existingCount: number;
  excludeCount: number;
  checked: number;
  createNew: number;
  merged: number;
  secondary: number;
  mappedExisting: number;
  needsReview: number;
  excluded: number;
}
