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
