/**
 * WordGod — Local + High-Intent Keyword Research (SME)
 *
 * ชุด type กลางของโหมด "Local SME" บนหน้า Keyword Research
 * โหมดนี้จัดลำดับความสำคัญใหม่: Local Intent → Commercial Intent →
 * Service Relevance → Search Volume → Competition
 * (ตรงข้ามกับโหมด Standard เดิมที่ให้น้ำหนัก Volume มากที่สุด)
 *
 * ทุกอย่างในไฟล์นี้เป็น data shape ล้วน ไม่มี I/O — ทำให้ทดสอบได้โดยไม่ต้องยิง API
 */

// ─── พื้นที่ (Location) ────────────────────────────────────────────────────────

export type LocalAreaType =
  | 'district'      // เขต / อำเภอ
  | 'subdistrict'   // แขวง / ตำบล
  | 'province'      // จังหวัด
  | 'road'          // ถนน
  | 'bts'
  | 'mrt'
  | 'arl'
  | 'landmark';

export interface LocalArea {
  id: string;
  name: string;
  type: LocalAreaType;
  /** เขต/จังหวัดแม่ เช่น แขวงบางหว้า → parent = "ภาษีเจริญ" */
  parent?: string;
  latitude?: number;
  longitude?: number;
}

/** รูปแบบธุรกิจ — มีผลต่อการถ่วงน้ำหนัก Hyper-Local */
export type LocalBusinessType =
  | 'service_area'  // ออกไปหาลูกค้า (ช่าง, ทีมบริการ) — ไม่มีหน้าร้าน
  | 'storefront'    // ลูกค้าเดินเข้ามา (คลินิก, ร้าน)
  | 'hybrid';

export type LocalLanguage = 'th' | 'th_en';

// ─── Intent ───────────────────────────────────────────────────────────────────

export type LocalIntentTag =
  | 'local'             // ระบุพื้นที่ตรง ๆ
  | 'near_me'           // ใกล้ฉัน / ใกล้บ้าน
  | 'commercial'        // แนะนำ / เจ้าไหนดี
  | 'price'             // ราคา / กี่บาท
  | 'comparison'        // เปรียบเทียบ / รีวิว / ดีไหม
  | 'service_provider'  // รับ / บริการ / ช่าง / ร้าน / บริษัท
  | 'urgency'           // ด่วน / วันนี้ / 24 ชั่วโมง
  | 'property_type'     // บ้าน / คอนโด / ออฟฟิศ
  | 'informational'
  | 'question';

/** กลุ่ม Modifier ตามสเปก (A–H) */
export type ModifierGroup =
  | 'local_exact'
  | 'near_me'
  | 'commercial'
  | 'price'
  | 'service_provider'
  | 'urgency'
  | 'property_context'
  | 'nearby_location';

// ─── คะแนน ────────────────────────────────────────────────────────────────────

/** คะแนนย่อยทุกตัว normalize 0–100 แล้ว ก่อนถ่วงน้ำหนัก */
export interface KeywordScore {
  total: number;
  localIntent: number;
  commercialIntent: number;
  volume: number;
  competitionOpportunity: number;
  relevance: number;
}

export type PriorityLevel = 'high' | 'medium' | 'low';

/** ประเภทหน้าเว็บที่แนะนำให้รองรับคีย์เวิร์ดนี้ */
export type SuggestedPageType =
  | 'main_service'
  | 'location'
  | 'service_area'
  | 'pricing'
  | 'faq'
  | 'blog'
  | 'gbp'
  | 'existing';

/** ที่มาของข้อมูล — Generated = สร้างจาก rule engine (ไม่ใช่ metric จริง) */
export type LocalKeywordSource =
  | 'generated'
  | 'keyword_planner'
  | 'dataforseo'
  | 'search_console'
  | 'suggest';

// ─── ผลลัพธ์ ──────────────────────────────────────────────────────────────────

export interface KeywordResearchResult {
  keyword: string;
  /** ยอดค้นหาย้อนหลังรายเดือน (เก่า → ใหม่) สำหรับ sparkline */
  trend?: number[];
  /** SEO title ภาษาไทยที่ AI เขียนให้ (แบบเดียวกับโหมดไม่มีหน้าร้าน) */
  suggestedTitle?: string;
  /** English slug สำหรับหน้า/บทความของคีย์เวิร์ดนี้ */
  slug?: string;
  /** null = Keyword Planner ไม่มีข้อมูลพอ (ต่างจาก 0 ที่แปลว่า "มีข้อมูลและเป็นศูนย์") */
  volume?: number | null;
  /** ป้ายของ Google Ads: LOW | MEDIUM | HIGH — ไม่ใช่ SEO Difficulty */
  adsCompetition?: string | null;
  competitionIndex?: number | null;
  bidLow?: number | null;
  bidHigh?: number | null;
  intents: LocalIntentTag[];
  /** ชื่อพื้นที่ที่ตรวจพบในคีย์เวิร์ด (null = ไม่ระบุพื้นที่) */
  location?: string | null;
  locationRole: 'primary' | 'nearby' | 'none';
  service: string;
  score: KeywordScore;
  priority: PriorityLevel;
  cluster?: string;
  suggestedPage?: SuggestedPageType;
  sources: LocalKeywordSource[];
  /** กลุ่ม modifier ที่ประกอบเป็นคีย์เวิร์ดนี้ (ใช้เป็น filter/อธิบายที่มา) */
  modifierGroups: ModifierGroup[];
  /**
   * ข้อมูล Local SEO Intelligence Engine (โหมดมีหน้าร้าน) — Google/DFS แยกแหล่ง,
   * confidence, SERP, Sales/Traffic/Final score, wave, คำรอง ฯลฯ
   * optional เพื่อ backward compatibility กับผลลัพธ์รุ่นเก่า
   */
  intel?: import('./intelligence').KeywordIntel;
}

export interface LocalClusterSummary {
  name: string;
  mainKeyword: string;
  keywordCount: number;
  avgPriority: number;
  maxPriority: number;
  /** รวม volume ที่ "มีข้อมูลจริง" เท่านั้น; null = ทั้งคลัสเตอร์ไม่มีข้อมูล */
  searchDemand: number | null;
  keywordsWithVolume: number;
  intents: LocalIntentTag[];
  suggestedPage: SuggestedPageType;
  contentRecommendations: string[];
  /** คำแนะนำเรื่องหน้าเฉพาะพื้นที่ (§16) */
  locationPageAdvice?: string;
  keywords: string[];
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface LocalResearchInput {
  /** บริการ/คีย์เวิร์ดหลัก — รองรับหลายบริการ */
  services: string[];
  primaryLocation: LocalArea;
  nearbyLocations?: LocalArea[];
  businessType?: LocalBusinessType;
  serviceRadiusKm?: number | null;
  language?: LocalLanguage;
  /** บริบทธุรกิจเพิ่มเติม ใช้คิด Relevance (ชื่อแบรนด์/คำอธิบาย) */
  businessContext?: string;
}

export interface LocalResearchMeta {
  generatedCount: number;
  enrichedCount: number;
  /** ok = ได้ metric ครบ, partial = ได้บางส่วน, unavailable = ดึงไม่ได้เลย */
  keywordPlannerStatus: 'ok' | 'partial' | 'unavailable' | 'skipped';
  keywordPlannerMessage?: string;
  /** พื้นที่ที่ใช้ target จริงกับ Keyword Planner + ระดับที่ fallback ลงมา */
  locationTarget: {
    requested: string;
    resolved: string;
    level: 'district' | 'province' | 'bangkok' | 'country';
  };
  weights: Record<keyof Omit<KeywordScore, 'total'>, number>;
  warnings: string[];
  generatedAt: string;

  // ── ส่วนขยาย Local SEO Intelligence Engine (optional — backward compatible) ──
  /** id ของ research run ที่บันทึกไว้ (null = บันทึกไม่สำเร็จ แต่ผลลัพธ์ยังใช้ได้) */
  researchId?: string | null;
  /** จำนวน candidate ทั้งหมดที่วิเคราะห์ก่อนคัดเหลือ qualified opportunities */
  candidateCount?: number;
  /** จำนวน SEO Opportunity สุดท้าย (นับเฉพาะคำหลัก ไม่นับคำรอง) */
  qualifiedCount?: number;
  /** น้ำหนัก Sales/Traffic ที่ใช้จริง (normalize เป็นผลรวม 1 แล้ว) */
  opportunityWeights?: { sales: number; traffic: number };
  /** สถานะรายแหล่งข้อมูล สำหรับ Data Source Status bar */
  sourceStatus?: {
    googleKeywordPlanner: { status: string; coverage: number; geo: string; message?: string; fetchedAt: string | null };
    dataForSeo: { status: string; coverage: number; message?: string; fetchedAt: string | null };
    localSerp: { status: string; checkedCount: number; message?: string; fetchedAt: string | null };
  };
  /** พร้อมส่งลูกค้าไหม — false เมื่อ volume coverage ต่ำกว่าเกณฑ์ (ดู warnings) */
  clientReady?: boolean;
  /** สัดส่วนคำที่มี volume ตรวจสอบแล้ว (LOCAL zero-volume ที่มีหลักฐานไม่นับว่าขาด) */
  verifiedVolumeCoverage?: number;
}

export interface LocalResearchResponse {
  results: KeywordResearchResult[];
  clusters: LocalClusterSummary[];
  meta: LocalResearchMeta;
}
