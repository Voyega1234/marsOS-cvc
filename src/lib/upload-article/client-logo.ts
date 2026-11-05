// ─── Upload Article — โลโก้ลูกค้า (pushPrefs.clientLogo เป็น data URL ของรูปที่ย่อแล้วในเบราว์เซอร์) ──
// ฟังก์ชันล้วน ใช้ทั้งใน PATCH, serialize และ unit test — render ผ่าน <img src> เท่านั้น

export const CLIENT_LOGO_KEY = 'clientLogo'
/** เพดานความยาว string (ตัวอักษร) ที่รับ */
export const CLIENT_LOGO_MAX_CHARS = 40 * 1024
const LOGO_RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/

/** อ่านโลโก้จากค่าที่เก็บไว้ — ค่าเพี้ยน/ไม่ผ่านกฎ = null */
export function readClientLogo(v: unknown): string | null {
  return typeof v === 'string' && v.length <= CLIENT_LOGO_MAX_CHARS && LOGO_RE.test(v) ? v : null
}

/** ตรวจค่าที่ส่งมาใน PATCH: null = ล้างโลโก้, string ที่ผ่านกฎ = ตั้งค่า, อย่างอื่น = ไม่ผ่าน */
export function validateClientLogoInput(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'โลโก้ต้องเป็นรูปที่ย่อแล้ว (data URL)' }
  if (v.length > CLIENT_LOGO_MAX_CHARS) return { ok: false, error: 'โลโก้ใหญ่เกิน 40KB' }
  if (!LOGO_RE.test(v)) return { ok: false, error: 'โลโก้รองรับเฉพาะ webp/png/jpeg' }
  return { ok: true, value: v }
}
