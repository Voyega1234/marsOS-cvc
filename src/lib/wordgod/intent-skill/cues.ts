/**
 * Keyword Intent Skill — ตาราง cue (คำ/วลีสัญญาณ intent) ภาษาไทย + อังกฤษ
 *
 * ทุกการเทียบใช้ normalizeThaiKey เพื่อกัน "ล้างแอร์ ราคา" vs "ล้างแอร์ราคา"
 * ไม่ใช่คนละคำ (§ตาม thaiNormalize.ts)
 */
import type { IntentCode } from './types';
import { normalizeThaiKey } from './thaiNormalize';

export interface IntentCueHit {
  code: IntentCode;
  cue: string;
}

// ── C = Commercial ────────────────────────────────────────────────────────────
const C_TERMS = [
  'ราคา', 'กี่บาท', 'ต่อตร.ม.', 'ต่อตารางเมตร', 'ค่าใช้จ่าย', 'ค่าบริการ',
  'ยี่ห้อไหนดี', 'ยี่ห้อ', 'รุ่นไหนดี', 'ตัวไหนดี', 'ที่ไหนดี', 'เจ้าไหนดี',
  'แนะนำ', 'รีวิว', 'vs', 'เทียบ', 'เปรียบเทียบ', 'ดีไหม', 'ดีที่สุด',
  'price', 'cost', 'best', 'review', 'compare',
];

// ── T = Transactional — เช็คจากจุดเริ่มต้นคีย์เวิร์ด ─────────────────────────
const T_PREFIX_TERMS = [
  'รับ', 'บริษัท', 'บริการ', 'ใกล้ฉัน', 'ใกล้บ้าน', 'ช่าง', 'ร้าน',
  'ซื้อ', 'สั่งซื้อ', 'สั่ง', 'จอง', 'ติดต่อ', 'เบอร์', 'โทร', 'ด่วน',
  '24ชั่วโมง', 'buy', 'order', 'nearme', 'service', 'company', 'hire',
];

// ── I = Informational ─────────────────────────────────────────────────────────
const I_TERMS = [
  'วิธี', 'คืออะไร', 'คือ', 'ทำไม', 'อย่างไร', 'ยังไง', 'เกิดจาก', 'สาเหตุ',
  'อาการ', 'ข้อดี', 'ข้อเสีย', 'ประโยชน์', 'how', 'what', 'why',
];

const I_ENDINGS = ['ไหม', 'มั้ย'];
/** ลงท้ายด้วยคำเหล่านี้ = C ไม่ใช่ I (เช่น "ดีไหม") */
const I_ENDING_EXCEPTIONS = ['ดีไหม', 'ดีมั้ย'];

/** เครื่องคำนวณ/เครื่องมือ */
const TOOL_TERMS = ['คำนวณ', 'calculator', 'เครื่องคิด', 'สูตรคำนวณ', 'โปรแกรม'];

/** ซื้อ/ขายสินค้า */
const PRODUCT_TERMS = [
  'ซื้อ', 'ขาย', 'สั่งซื้อ', 'ร้านขาย', 'ยี่ห้อ', 'รุ่น', 'shopee', 'lazada',
  'ตัวไหนดี', 'ยี่ห้อไหนดี',
];

/** ค้นหาคำแปล ไม่ใช่ลูกค้าจริง */
const TRANSLATION_TERMS = [
  'ภาษาอังกฤษ', 'ภาษาไทย', 'แปลว่า', 'แปล', 'english', 'คำอ่าน', 'สะกด',
];

/** เปรียบเทียบ (subset ของ C ที่แรงพอจะดัน pageType ไปหน้า Comparison) */
const COMPARISON_TERMS = [
  'vs', 'เทียบ', 'เปรียบเทียบ', 'ยี่ห้อไหนดี', 'รุ่นไหนดี', 'ตัวไหนดี',
  'ที่ไหนดี', 'เจ้าไหนดี', 'compare',
];

const PRICE_TERMS = ['ราคา', 'กี่บาท', 'ต่อตร.ม.', 'ต่อตารางเมตร', 'ค่าใช้จ่าย', 'ค่าบริการ', 'price', 'cost'];

function includesTerm(normalizedKw: string, term: string): boolean {
  return normalizedKw.includes(normalizeThaiKey(term));
}

/** ตรวจ cue ทั้งหมดที่เจอในคีย์เวิร์ด (ไม่ตัดสินลำดับ ให้ classifyIntent ผสมเอง) */
export function detectIntentCues(kw: string): IntentCueHit[] {
  const norm = normalizeThaiKey(kw);
  const hits: IntentCueHit[] = [];

  for (const term of C_TERMS) {
    if (includesTerm(norm, term)) hits.push({ code: 'C', cue: term });
  }

  for (const term of T_PREFIX_TERMS) {
    const t = normalizeThaiKey(term);
    if (t && norm.startsWith(t)) hits.push({ code: 'T', cue: term });
  }

  for (const term of I_TERMS) {
    if (includesTerm(norm, term)) hits.push({ code: 'I', cue: term });
  }

  for (const ending of I_ENDINGS) {
    const e = normalizeThaiKey(ending);
    if (!norm.endsWith(e)) continue;
    const isException = I_ENDING_EXCEPTIONS.some(exc => norm.endsWith(normalizeThaiKey(exc)));
    if (!isException) hits.push({ code: 'I', cue: ending });
  }

  return hits;
}

export function isComparisonCue(kw: string): boolean {
  const norm = normalizeThaiKey(kw);
  return COMPARISON_TERMS.some(term => includesTerm(norm, term));
}

export function isPriceCue(kw: string): boolean {
  const norm = normalizeThaiKey(kw);
  return PRICE_TERMS.some(term => includesTerm(norm, term));
}

export function isToolCue(kw: string): boolean {
  const norm = normalizeThaiKey(kw);
  return TOOL_TERMS.some(term => includesTerm(norm, term));
}

export function isProductCue(kw: string): boolean {
  const norm = normalizeThaiKey(kw);
  return PRODUCT_TERMS.some(term => includesTerm(norm, term));
}

export function isTranslationCue(kw: string): boolean {
  const norm = normalizeThaiKey(kw);
  return TRANSLATION_TERMS.some(term => includesTerm(norm, term));
}

// ── พื้นที่ (จังหวัดทั้งหมด + เขตกรุงเทพที่พบบ่อย) ────────────────────────────

const THAI_PROVINCES = [
  'กรุงเทพมหานคร', 'กรุงเทพ', 'กทม', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร',
  'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร',
  'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม',
  'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน',
  'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี',
  'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี',
  'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร',
  'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน',
  'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม',
  'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี',
  'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ',
  'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี',
];

const BANGKOK_DISTRICTS = [
  'พระนคร', 'ดุสิต', 'หนองจอก', 'บางรัก', 'บางเขน', 'บางกะปิ', 'ปทุมวัน',
  'ป้อมปราบศัตรูพ่าย', 'พระโขนง', 'มีนบุรี', 'ลาดกระบัง', 'ยานนาวา', 'สัมพันธวงศ์',
  'พญาไท', 'ธนบุรี', 'บางกอกใหญ่', 'ห้วยขวาง', 'คลองสาน', 'ตลิ่งชัน', 'บางกอกน้อย',
  'บางขุนเทียน', 'ภาษีเจริญ', 'หนองแขม', 'ราษฎร์บูรณะ', 'บางพลัด', 'ดินแดง',
  'บึงกุ่ม', 'สาทร', 'บางซื่อ', 'จตุจักร', 'บางคอแหลม', 'ประเวศ', 'คลองเตย',
  'สวนหลวง', 'จอมทอง', 'ดอนเมือง', 'ราชเทวี', 'ลาดพร้าว', 'วัฒนา', 'บางแค',
  'หลักสี่', 'สายไหม', 'คันนายาว', 'สะพานสูง', 'วังทองหลาง', 'คลองสามวา',
  'บางนา', 'ทวีวัฒนา', 'ทุ่งครุ', 'บางบอน',
];

// เรียงยาว → สั้น กันจับคำย่อยผิด (เช่น "นคร" ไปกิน "นครปฐม")
const ALL_AREAS = [...THAI_PROVINCES, ...BANGKOK_DISTRICTS].sort((a, b) => b.length - a.length);

/** ตรวจว่าคีย์เวิร์ดมีชื่อจังหวัด/เขตกรุงเทพอยู่ไหม — คืนชื่อที่ตรวจพบ (รูปแบบเดิม) หรือ null */
export function detectThaiProvince(kw: string): string | null {
  const norm = normalizeThaiKey(kw);
  for (const area of ALL_AREAS) {
    if (includesTerm(norm, area)) return area;
  }
  return null;
}
