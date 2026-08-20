/**
 * WordGod Local SME — ค่าคงที่ทั้งหมดอยู่ที่นี่ที่เดียว
 *
 * ห้ามกระจายตัวเลขถ่วงน้ำหนัก/เกณฑ์ไปตาม component หรือ API route
 * ถ้าจะปรับสูตร ให้แก้ไฟล์นี้ไฟล์เดียว
 */

import type { KeywordScore, LocalBusinessType } from './types';

export type ScoreDimension = keyof Omit<KeywordScore, 'total'>;

/**
 * น้ำหนักของสูตร Priority Score — ต้องรวมกันได้ 1 เสมอ
 * เจตนา: Local + Commercial = 70% ของคะแนน, Volume แค่ 15%
 */
export const LOCAL_KEYWORD_WEIGHTS: Record<ScoreDimension, number> = {
  localIntent: 0.4,
  commercialIntent: 0.3,
  volume: 0.15,
  competitionOpportunity: 0.1,
  relevance: 0.05,
};

/** ผลรวมน้ำหนัก — ใช้ตรวจใน test และ assert ตอน import */
export function weightsSum(): number {
  return Object.values(LOCAL_KEYWORD_WEIGHTS).reduce((sum, w) => sum + w, 0);
}

if (Math.abs(weightsSum() - 1) > 1e-9) {
  throw new Error(`LOCAL_KEYWORD_WEIGHTS must sum to 1, got ${weightsSum()}`);
}

/** เกณฑ์แบ่งระดับความสำคัญ (§13) — ปรับได้จากที่นี่ */
export const PRIORITY_THRESHOLDS = {
  high: 75,
  medium: 50,
};

/**
 * กันคีย์เวิร์ดระเบิด (§7) — ไม่มีการคูณไขว้แบบไร้ขอบเขต
 * MAX_MODIFIERS_PER_KEYWORD นับ "modifier เชิงเจตนา" ไม่นับตัวพื้นที่
 */
export const GENERATION_LIMITS = {
  maxModifiersPerKeyword: 2,
  maxCandidatesPerBase: 26,
  maxCandidatesPerService: 120,
  maxTotalCandidates: 400,
  maxNearbyLocations: 12,
  maxServices: 8,
  /** ความยาวคีย์เวิร์ดที่ยอมรับ (คำ) — ยาวเกินนี้ไม่เป็นธรรมชาติในภาษาไทย */
  maxKeywordWords: 9,
};

/** เพดานจำนวนคีย์เวิร์ดที่ส่งไป Keyword Planner ต่อหนึ่งครั้ง (คุมค่าใช้จ่าย/เวลา) */
export const KP_LOOKUP_LIMIT = 400;

/**
 * คะแนน Local Intent ตามสัญญาณที่เจอ (§11, §25)
 * ไม่มีสัญญาณพื้นที่เลยไม่ได้แปลว่า 0 — คำบริการล้วนยังมีค่ากับ SME อยู่บ้าง
 */
export const LOCAL_INTENT_SCORES = {
  primaryLocationExact: 100,
  nearbyLocation: 85,
  nearMe: 80,
  transitOrRoad: 92,
  landmark: 88,
  broaderArea: 55,
  none: 10,
};

/** โบนัส Hyper-Local ตามรูปแบบธุรกิจ (§25) — บวกทับคะแนน Local แล้ว cap ที่ 100 */
export const HYPER_LOCAL_BONUS: Record<LocalBusinessType, Partial<Record<string, number>>> = {
  // ช่าง/ทีมบริการ: ยิ่งพื้นที่ละเอียด ยิ่งปิดงานได้จริง
  service_area: { subdistrict: 10, road: 10, bts: 6, mrt: 6, arl: 6, near_me: 10, district: 4 },
  // หน้าร้าน: จุดสังเกต/รถไฟฟ้าช่วยให้ลูกค้าเดินทางมาถูก
  storefront: { landmark: 10, bts: 10, mrt: 10, arl: 8, road: 6, near_me: 6 },
  hybrid: { subdistrict: 6, road: 6, bts: 6, mrt: 6, landmark: 6, near_me: 8 },
};

/** คะแนน Commercial Intent ต่อ tag (§11) — ใช้ค่าสูงสุดของ tag ที่เจอเป็นฐาน */
export const COMMERCIAL_INTENT_SCORES: Record<string, number> = {
  price: 95,
  service_provider: 90,
  urgency: 90,
  comparison: 85,
  commercial: 85,
  property_type: 70,
  near_me: 78,
  local: 60,
  question: 40,
  informational: 25,
};

/** คีย์เวิร์ดบริการล้วน ๆ (ไม่มี modifier) ยังถือเป็นคำ money อยู่ */
export const BARE_SERVICE_COMMERCIAL_SCORE = 60;

/**
 * "บริการ + ชื่อพื้นที่" ล้วน ๆ เช่น "ล้างแอร์บางแค" คือคำ money หลักของ SME —
 * คนที่พิมพ์ชื่อเขตต่อท้ายบริการคือคนที่พร้อมจ้างในพื้นที่นั้นแล้ว จึงต้องมีพื้น
 * เจตนาเชิงพาณิชย์สูงกว่าคำบริการลอย ๆ ที่ไม่ระบุพื้นที่
 * (ไม่ยกพื้นให้คำที่สัญญาณหลักเป็นการหาความรู้ — ดู INFORMATIONAL_INTENT_TAGS)
 */
export const LOCAL_EXACT_COMMERCIAL_SCORE = 85;

/** tag ที่บอกว่า "กำลังหาข้อมูล" ไม่ใช่ "พร้อมจ้าง" — ไม่ได้รับพื้นของคำระบุพื้นที่ */
export const INFORMATIONAL_INTENT_TAGS: readonly string[] = ['informational', 'question'];

/** โบนัสเมื่อมี commercial tag หลายตัวพร้อมกัน (ต่อ tag ที่เกินตัวแรก) */
export const COMMERCIAL_STACK_BONUS = 5;

/** ไม่มีข้อมูล Competition → ให้กลาง ๆ ไม่ให้ได้เปรียบหรือเสียเปรียบ */
export const NEUTRAL_COMPETITION_OPPORTUNITY = 50;

/** เกณฑ์แนะนำ "สร้างหน้าเฉพาะพื้นที่" (§16) — ต่ำกว่านี้ให้รวมเป็นหน้า Service Area */
export const LOCATION_PAGE_RULES = {
  minKeywordsForDedicatedPage: 3,
  minPriorityForDedicatedPage: 70,
  /** เกินจำนวนนี้ให้เตือนเรื่อง doorway page */
  doorwayWarningThreshold: 5,
};

/**
 * ค่าเริ่มต้นของการคัดคำสุดท้าย (§ selection) — ไม่แตะสูตรคะแนน/badge
 * salesRatio: สัดส่วนคำเชิงขาย vs คำเชิง traffic ในผลลัพธ์สุดท้าย
 * maxPerCluster: กันคลัสเตอร์เดียวยึดตารางทั้งหมด
 */
export const SELECTION_DEFAULTS = { salesRatio: 0.5, maxPerCluster: 2 } as const;
