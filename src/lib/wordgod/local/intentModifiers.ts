/**
 * WordGod Local SME — Intent Modifier Engine
 *
 * config กลางของ "คำขยายเจตนา" ทั้ง 8 กลุ่ม (A–H ตามสเปก)
 * ทั้งฝั่ง "สร้างคีย์เวิร์ด" และฝั่ง "ตรวจจับเจตนาจากข้อความ" ใช้ตารางเดียวกันนี้
 * ห้าม hardcode คำเหล่านี้ซ้ำใน component หรือ API route
 */

import type { LocalIntentTag, ModifierGroup } from './types';

/**
 * รูปแบบของคำบริการ — ตัดสินว่า modifier ไหน "พูดแล้วเป็นภาษาไทยจริง"
 *  - action  : ขึ้นต้นด้วยกริยา เช่น "ล้างแอร์", "ซ่อมท่อ" → "รับล้างแอร์" ฟังขึ้น
 *  - entity  : เป็นสถานที่/กิจการ เช่น "คลินิกทันตกรรม" → "รับคลินิกทันตกรรม" ผิดภาษา
 *  - generic : ไม่แน่ใจ → อนุญาตเฉพาะคำขยายที่ปลอดภัยกับทุกแบบ
 */
export type ServiceShape = 'action' | 'entity' | 'generic';

/** คำนำหน้าที่บ่งว่าเป็นสถานที่/กิจการ (ไม่ใช่การกระทำ) */
const ENTITY_PREFIXES = [
  'คลินิก', 'ร้าน', 'โรงแรม', 'โรงพยาบาล', 'โรงเรียน', 'ศูนย์', 'สถาบัน', 'บริษัท',
  'สำนักงาน', 'อู่', 'ฟิตเนส', 'ยิม', 'สปา', 'คาเฟ่', 'ร้านกาแฟ', 'หอพัก', 'อพาร์ทเม้นท์',
  'สนาม', 'ตลาด', 'ห้าง', 'โกดัง', 'ปั๊ม', 'ผับ', 'บาร์', 'ที่พัก', 'รีสอร์ท', 'ห้องพัก',
];

/** กริยานำหน้าที่บ่งว่าเป็นงานบริการที่ "รับ/ช่าง" ประกอบได้ */
const ACTION_PREFIXES = [
  'ล้าง', 'ซ่อม', 'ติดตั้ง', 'ย้าย', 'ถอด', 'เติม', 'ทำ', 'รับทำ', 'รับ', 'ดูด', 'สูบ',
  'กำจัด', 'ขน', 'ส่ง', 'ตัด', 'ทาสี', 'ปู', 'เดิน', 'ต่อ', 'เปลี่ยน', 'ตรวจ', 'เช็ค',
  'ล้างแอร์', 'ซัก', 'รีด', 'ดูแล', 'จัด', 'ออกแบบ', 'สร้าง', 'รื้อ', 'เจาะ', 'เชื่อม',
  'พ่น', 'อัด', 'ขัด', 'เคลือบ', 'ฉีด', 'บำรุง', 'แก้', 'ปรับ', 'ล้างท่อ',
];

/** คำที่บอกว่าเป็น "ปัญหา/อาการ" เช่น "ท่อตัน" — ใช้ช่าง/รับ ได้เหมือน action */
const PROBLEM_SUFFIXES = ['ตัน', 'รั่ว', 'เสีย', 'พัง', 'ร้าว', 'อุดตัน', 'ไม่เย็น', 'ไม่ไหล', 'สะดุด'];

export function classifyServiceShape(service: string): ServiceShape {
  const s = service.trim();
  if (!s) return 'generic';
  if (ENTITY_PREFIXES.some(p => s.startsWith(p))) return 'entity';
  if (ACTION_PREFIXES.some(p => s.startsWith(p))) return 'action';
  if (PROBLEM_SUFFIXES.some(p => s.endsWith(p))) return 'action';
  return 'generic';
}

// ─── ตาราง Modifier ───────────────────────────────────────────────────────────

export interface ModifierDefinition {
  id: string;
  group: ModifierGroup;
  tag: LocalIntentTag;
  /** ป้ายภาษาไทยแบบที่เจ้าของธุรกิจอ่านเข้าใจ (§41) */
  label: string;
  /** สร้างคีย์เวิร์ดจากวลีฐาน — คืน null ถ้ารูปประโยคไม่เป็นธรรมชาติกับ shape นี้ */
  render: (base: string, shape: ServiceShape) => string | null;
  /** ตรวจจับ modifier นี้จากข้อความคีย์เวิร์ด */
  detect: RegExp;
  /** ลำดับความสำคัญตอนต้องตัดจำนวน (มากไปน้อย) */
  weight: number;
}

/** เฉพาะ shape ที่ประกอบคำว่า "รับ / ช่าง" แล้วยังเป็นภาษาไทยที่ใช้จริง */
const providerOk = (shape: ServiceShape) => shape === 'action';

export const MODIFIER_DEFINITIONS: ModifierDefinition[] = [
  // ── C. Commercial / Comparison ───────────────────────────────────────────
  { id: 'which_good', group: 'commercial', tag: 'commercial', label: 'ที่ไหนดี',
    render: base => `${base}ที่ไหนดี`, detect: /ที่ไหนดี|ร้านไหนดี|\bwhich\b/i, weight: 96 },
  { id: 'which_vendor', group: 'commercial', tag: 'commercial', label: 'เจ้าไหนดี',
    render: (base, shape) => (shape === 'entity' ? null : `${base}เจ้าไหนดี`),
    detect: /เจ้าไหนดี|ยี่ห้อไหนดี/, weight: 88 },
  { id: 'recommend', group: 'commercial', tag: 'commercial', label: 'แนะนำ',
    render: base => `${base}แนะนำ`, detect: /แนะนำ|\brecommend/i, weight: 84 },
  { id: 'review', group: 'commercial', tag: 'comparison', label: 'รีวิว',
    render: base => `รีวิว${base}`, detect: /รีวิว|\breview\b/i, weight: 82 },
  { id: 'is_it_good', group: 'commercial', tag: 'comparison', label: 'ดีไหม',
    render: base => `${base}ดีไหม`, detect: /ดีไหม|ดีมั้ย|ดีรึเปล่า/, weight: 78 },

  // ── D. Price ─────────────────────────────────────────────────────────────
  { id: 'price', group: 'price', tag: 'price', label: 'ราคา',
    render: base => `${base}ราคา`, detect: /ราคา|\bprice\b/i, weight: 98 },
  { id: 'how_much_baht', group: 'price', tag: 'price', label: 'กี่บาท',
    render: base => `${base}กี่บาท`, detect: /กี่บาท/, weight: 95 },
  { id: 'how_much', group: 'price', tag: 'price', label: 'เท่าไหร่',
    render: base => `${base}เท่าไหร่`, detect: /เท่าไหร่|เท่าไร/, weight: 90 },
  { id: 'cost_of', group: 'price', tag: 'price', label: 'ค่าใช้จ่าย',
    render: base => `${base}ค่าใช้จ่าย`, detect: /ค่าใช้จ่าย|ค่าบริการ/, weight: 80 },
  { id: 'cheap', group: 'price', tag: 'price', label: 'ราคาถูก',
    render: base => `${base}ราคาถูก`, detect: /ราคาถูก|ถูกที่สุด|\bcheap\b/i, weight: 76 },
  { id: 'not_expensive', group: 'price', tag: 'price', label: 'ราคาไม่แพง',
    render: base => `${base}ราคาไม่แพง`, detect: /ไม่แพง/, weight: 70 },

  // ── E. Service Provider ──────────────────────────────────────────────────
  { id: 'accept_job', group: 'service_provider', tag: 'service_provider', label: 'รับ…',
    render: (base, shape) => (providerOk(shape) ? `รับ${base}` : null),
    detect: /(^|[\s|])รับ/, weight: 99 },
  { id: 'service_of', group: 'service_provider', tag: 'service_provider', label: 'บริการ…',
    render: (base, shape) => (shape === 'entity' ? null : `บริการ${base}`),
    detect: /บริการ|\bservice\b/i, weight: 92 },
  { id: 'technician', group: 'service_provider', tag: 'service_provider', label: 'ช่าง…',
    render: (base, shape) => (providerOk(shape) ? `ช่าง${base}` : null),
    detect: /ช่าง/, weight: 90 },
  { id: 'shop', group: 'service_provider', tag: 'service_provider', label: 'ร้าน…',
    render: (base, shape) => (shape === 'entity' ? null : `ร้าน${base}`),
    detect: /(^|[\s|])ร้าน/, weight: 74 },
  { id: 'company', group: 'service_provider', tag: 'service_provider', label: 'บริษัท…',
    render: (base, shape) => (shape === 'entity' ? null : `บริษัท${base}`),
    detect: /บริษัท/, weight: 68 },

  // ── F. Urgency ───────────────────────────────────────────────────────────
  { id: 'urgent', group: 'urgency', tag: 'urgency', label: 'ด่วน',
    render: base => `${base}ด่วน`, detect: /ด่วน|\burgent\b/i, weight: 86 },
  { id: 'today', group: 'urgency', tag: 'urgency', label: 'วันนี้',
    render: base => `${base}วันนี้`, detect: /วันนี้/, weight: 80 },
  { id: 'right_now', group: 'urgency', tag: 'urgency', label: 'ตอนนี้',
    render: base => `${base}ตอนนี้`, detect: /ตอนนี้/, weight: 72 },
  { id: 'h24', group: 'urgency', tag: 'urgency', label: '24 ชั่วโมง',
    render: base => `${base}24 ชั่วโมง`, detect: /24\s?(ชั่วโมง|ชม\.?)|\b24h\b/i, weight: 78 },
  { id: 'after_hours', group: 'urgency', tag: 'urgency', label: 'นอกเวลา',
    render: base => `${base}นอกเวลา`, detect: /นอกเวลา|กลางคืน/, weight: 62 },

  // ── G. Property / Context ────────────────────────────────────────────────
  { id: 'ctx_home', group: 'property_context', tag: 'property_type', label: 'บ้าน',
    render: (base, shape) => (shape === 'entity' ? null : `${base}บ้าน`), detect: /บ้าน(?!เลข)/, weight: 66 },
  { id: 'ctx_condo', group: 'property_context', tag: 'property_type', label: 'คอนโด',
    render: (base, shape) => (shape === 'entity' ? null : `${base}คอนโด`), detect: /คอนโด|condo/i, weight: 70 },
  { id: 'ctx_office', group: 'property_context', tag: 'property_type', label: 'ออฟฟิศ',
    render: (base, shape) => (shape === 'entity' ? null : `${base}ออฟฟิศ`), detect: /ออฟฟิศ|สำนักงาน|office/i, weight: 64 },
  { id: 'ctx_shop', group: 'property_context', tag: 'property_type', label: 'ร้านค้า',
    render: (base, shape) => (shape === 'entity' ? null : `${base}ร้านค้า`), detect: /ร้านค้า/, weight: 58 },
  { id: 'ctx_company', group: 'property_context', tag: 'property_type', label: 'บริษัท (สถานที่)',
    render: () => null, detect: /บริษัท/, weight: 40 },
];

/** modifier กลุ่ม "ใกล้ฉัน" (B) — ต่อท้ายคำบริการ ไม่ผูกกับชื่อพื้นที่ */
export const NEAR_ME_MODIFIERS: ModifierDefinition[] = [
  { id: 'near_me', group: 'near_me', tag: 'near_me', label: 'ใกล้ฉัน',
    render: base => `${base}ใกล้ฉัน`, detect: /ใกล้ฉัน|near me/i, weight: 100 },
  { id: 'near_home', group: 'near_me', tag: 'near_me', label: 'ใกล้บ้าน',
    render: base => `${base}ใกล้บ้าน`, detect: /ใกล้บ้าน/, weight: 88 },
  { id: 'near_work', group: 'near_me', tag: 'near_me', label: 'ใกล้ที่ทำงาน',
    render: base => `${base}ใกล้ที่ทำงาน`, detect: /ใกล้ที่ทำงาน/, weight: 70 },
  { id: 'nearby', group: 'near_me', tag: 'near_me', label: 'ใกล้ ๆ',
    render: base => `${base}ใกล้ๆ`, detect: /ใกล้ๆ|ใกล้ ๆ/, weight: 60 },
];

/** รูปแบบการวางชื่อพื้นที่ (A/H) */
export const LOCATION_PATTERNS: Array<{
  id: string;
  label: string;
  render: (service: string, location: string) => string;
  weight: number;
}> = [
  { id: 'suffix', label: '[บริการ][พื้นที่]', render: (s, l) => `${s}${l}`, weight: 100 },
  { id: 'prefix', label: '[พื้นที่][บริการ]', render: (s, l) => `${l}${s}`, weight: 80 },
  { id: 'thaeo', label: 'แถว[พื้นที่]', render: (s, l) => `${s}แถว${l}`, weight: 72 },
  { id: 'klai', label: 'ใกล้[พื้นที่]', render: (s, l) => `${s}ใกล้${l}`, weight: 68 },
];

// ─── ตรวจจับเจตนาจากข้อความ ───────────────────────────────────────────────────

const QUESTION_PATTERN = /อย่างไร|ยังไง|ทำไม|คืออะไร|วิธี|ไหม|มั้ย|กี่|เท่าไหร่|เท่าไร|\?|^how |^what |^why /i;
const INFORMATIONAL_PATTERN = /วิธี|ขั้นตอน|คืออะไร|ประโยชน์|สาเหตุ|ควร|แนวทาง|ดูแล|บ่อยแค่ไหน/;

const ALL_MODIFIERS = [...MODIFIER_DEFINITIONS, ...NEAR_ME_MODIFIERS];

export function detectModifierTags(keyword: string): LocalIntentTag[] {
  const tags = new Set<LocalIntentTag>();
  for (const def of ALL_MODIFIERS) {
    if (def.detect.test(keyword)) tags.add(def.tag);
  }
  if (QUESTION_PATTERN.test(keyword)) tags.add('question');
  if (INFORMATIONAL_PATTERN.test(keyword) && !tags.has('price') && !tags.has('service_provider')) {
    tags.add('informational');
  }
  return Array.from(tags);
}

export function detectModifierGroups(keyword: string): ModifierGroup[] {
  const groups = new Set<ModifierGroup>();
  for (const def of ALL_MODIFIERS) {
    if (def.detect.test(keyword)) groups.add(def.group);
  }
  return Array.from(groups);
}

/** modifier ที่ใช้ได้จริงกับคำบริการรูปแบบนี้ (กรองตัวที่ render แล้วเป็น null ออก) */
export function usableModifiers(shape: ServiceShape): ModifierDefinition[] {
  return MODIFIER_DEFINITIONS.filter(def => def.render('X', shape) !== null);
}

/** ป้ายกลุ่มภาษาไทยสำหรับ UI (§41) */
export const MODIFIER_GROUP_LABELS: Record<ModifierGroup, string> = {
  local_exact: 'ระบุพื้นที่',
  near_me: 'ใกล้ฉัน',
  commercial: 'กำลังเลือกเจ้า',
  price: 'ถามราคา',
  service_provider: 'หาผู้ให้บริการ',
  urgency: 'ต้องการด่วน',
  property_context: 'ระบุประเภทสถานที่',
  nearby_location: 'พื้นที่ใกล้เคียง',
};

export const INTENT_TAG_LABELS: Record<LocalIntentTag, string> = {
  local: 'ระบุพื้นที่',
  near_me: 'ใกล้ฉัน',
  commercial: 'กำลังเลือกเจ้า',
  price: 'ถามราคา',
  comparison: 'เปรียบเทียบ/รีวิว',
  service_provider: 'หาผู้ให้บริการ',
  urgency: 'ต้องการด่วน',
  property_type: 'ระบุสถานที่',
  informational: 'หาความรู้',
  question: 'ตั้งคำถาม',
};
