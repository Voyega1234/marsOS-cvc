/**
 * WordGod Local SME — Thai keyword normalization
 *
 * ภาษาไทยเขียนติดกันได้ทั้ง "ล้างแอร์บางแค" และ "ล้างแอร์ บางแค"
 * ซึ่งเป็นคีย์เวิร์ดเดียวกันในสายตาผู้ค้นหา แต่คนละสตริงในสายตาโปรแกรม
 * ฟังก์ชันในไฟล์นี้ทำให้ทั้งสองรูปแฮชตรงกัน (§5, §33, §43E)
 *
 * หมายเหตุ: ใช้เป็น "คีย์เปรียบเทียบ" เท่านั้น — ข้อความที่แสดงผลและที่ส่งไป
 * Keyword Planner ยังใช้รูปเดิมที่อ่านเป็นธรรมชาติ
 */

const THAI_RUN = /([฀-๿]+)\s+(?=[฀-๿])/g;

/** ตัดช่องว่างระหว่างอักษรไทย + ยุบช่องว่างซ้ำ + ตัดหัวท้าย */
export function normalizeThaiSpacing(value: string): string {
  let out = value.replace(/\s+/g, ' ').trim();
  // วนซ้ำจนกว่าจะไม่มีช่องว่างระหว่างอักษรไทยเหลือ (รองรับ ≥3 ก้อน)
  let previous = '';
  while (previous !== out) {
    previous = out;
    out = out.replace(THAI_RUN, '$1');
  }
  return out;
}

/**
 * คีย์สำหรับ dedupe — ตัดช่องว่างทั้งหมด ตัดอักขระวรรคตอน และ lowercase
 * ทำให้ "ล้างแอร์ บางแค" / "ล้างแอร์บางแค" / "ล้างแอร์  บางแค" เป็นตัวเดียวกัน
 */
export function dedupeKey(value: string): string {
  return normalizeThaiSpacing(value)
    .toLowerCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/[·•|,]/g, '');
}

/** ข้อความที่ใช้แสดงผล/ส่งไป API — เว้นวรรคเฉพาะรอยต่อไทย–อังกฤษ/ตัวเลข */
export function displayForm(value: string): string {
  return normalizeThaiSpacing(value)
    .replace(/([฀-๿])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([฀-๿])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ตรวจว่าวลี `needle` โผล่ในคีย์เวิร์ดเกินหนึ่งครั้งไหม
 * ใช้กันเคส "ล้างแอร์บางแคล้างแอร์" ที่เกิดจากการต่อ modifier ซ้อนกันเอง
 * (เทียบแบบตัดช่องว่าง เพราะไทยเขียนติดกันได้)
 */
export function containsTwice(keyword: string, needle: string): boolean {
  const hay = dedupeKey(keyword);
  const pin = dedupeKey(needle);
  if (!pin || pin.length < 2) return false;
  const first = hay.indexOf(pin);
  return first !== -1 && hay.indexOf(pin, first + pin.length) !== -1;
}

/**
 * ตรวจคำซ้ำติดกันแบบยาว (≥4 อักขระ) เช่น "ล้างแอร์ล้างแอร์"
 * ตั้งขั้นต่ำไว้ 4 เพื่อไม่ให้ไปโดนคำไทยปกติที่มีพยางค์ซ้ำ เช่น "นานาชาติ"
 */
export function hasImmediateRepeat(value: string): boolean {
  const s = dedupeKey(value);
  for (let len = 4; len <= Math.floor(s.length / 2); len++) {
    for (let i = 0; i + len * 2 <= s.length; i++) {
      if (s.slice(i, i + len) === s.slice(i + len, i + len * 2)) return true;
    }
  }
  return false;
}

// ── Order-free key: จับคำสลับตำแหน่ง/คำพ้อง (feedback HRC 2026-08) ──────────
//
// "ล้างแอร์ บางนา ราคาถูก" กับ "บางนา ล้างแอร์ ราคาถูก" คือคำค้นเดียวกัน
// dedupeKey เดิมจับไม่ได้เพราะเทียบตามลำดับอักขระ — key ตัวนี้ตัดคำ (Intl.Segmenter)
// map คำพ้องที่ชัวร์ แล้วเรียง token ก่อน join จึงไม่สนลำดับคำ
// ใช้เป็น "คีย์เปรียบเทียบชั้นที่สอง" เท่านั้น ข้อความจริงยังเก็บรูปเดิมเสมอ

import { segmentWords } from '../text/thai';

/** normalize ก่อนตัดคำ — สระอำสองแบบ (U+0E33 vs U+0E4D+U+0E32) + รูปเขียน wifi */
function preCanonical(value: string): string {
  return value
    .toLowerCase()
    .replace(/ํา/g, 'ำ')
    .replace(/wi[\s\-]?fi/g, 'wifi')
    .replace(/ไวไฟ|ไวเลส/g, 'wifi')
    // คำที่ตัวตัดคำจัดการไม่ได้ (สะกดผิด/ติดกันหลายพยางค์) — map ระดับสตริงก่อนตัดคำ
    .replace(/โน๊ตบุ๊ค|โน้ตบุ๊ค|โน๊ตบุ๊ก|notebook/g, 'โน้ตบุ๊ก')
    .replace(/เชื่อมต่อ/g, 'เชื่อม')
    .replace(/แก้ไข/g, 'แก้');
}

/**
 * คำพ้องที่เจตนาค้นหาเดียวกันแน่ ๆ เท่านั้น — map ในคีย์ ไม่แตะข้อความแสดงผล
 * ('' = ตัดทิ้งจากคีย์ เช่น "วิธี" ที่ไม่เปลี่ยนหน้าที่ต้องทำ)
 */
const TOKEN_SYNONYM: Record<string, string> = {
  'เชื่อมต่อ': 'เชื่อม',
  'แก้ไข': 'แก้',
  'ปัญหา': 'แก้',
  'วิธี': '',
  'ยังไง': 'อย่างไร',
  'เท่าไร': 'เท่าไหร่',
  'โน๊ตบุ๊ค': 'โน้ตบุ๊ก',
  'โน้ตบุ๊ค': 'โน้ตบุ๊ก',
  'โน๊ตบุ๊ก': 'โน้ตบุ๊ก',
  'notebook': 'โน้ตบุ๊ก',
};

/**
 * คีย์แบบไม่สนลำดับคำ: ตัดคำ → map คำพ้อง → unique → sort → join
 * คำที่ตัดคำไม่ได้ (token เดียว/สคริปต์แปลก) จะเทียบเท่า dedupeKey เดิม
 */
export function orderFreeKey(value: string): string {
  const pre = preCanonical(normalizeThaiSpacing(value))
    // Intl.Segmenter ตัด run ไทยผสมละติน ("บ้านwifiหลุด") ไม่ออก — เว้นวรรครอยต่อสคริปต์ก่อน
    .replace(/([฀-๿])([a-z0-9])/g, '$1 $2')
    .replace(/([a-z0-9])([฀-๿])/g, '$1 $2');
  const tokens = segmentWords(pre)
    .map(t => (t in TOKEN_SYNONYM ? TOKEN_SYNONYM[t] : t))
    .filter(Boolean);
  if (tokens.length === 0) return dedupeKey(value);
  return Array.from(new Set(tokens)).sort().join('|');
}

/**
 * คำต้องห้ามในผล keyword research (คำสั่งเจ้าของระบบ 2026-08-27):
 * คำค้นที่พ่วงชื่อเว็บบอร์ด/พอร์ทัล เช่น "... pantip" ไม่เอาเข้าตารางเด็ดขาด
 * (ระวัง: "พันธุ์ทิพย์" ห้างพลาซ่า สะกดต่าง ไม่โดนตัด)
 */
const FORBIDDEN_TERMS = ['pantip', 'พันทิป', 'พันทิพ'];

export function hasForbiddenTerm(value: string): boolean {
  const key = dedupeKey(value);
  return FORBIDDEN_TERMS.some(t => key.includes(t));
}
