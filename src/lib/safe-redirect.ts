// ─── ปลายทางหลัง login (?next=) — รับเฉพาะ path ภายในเว็บนี้ กัน open redirect ──
// URL parser ตัด tab/ขึ้นบรรทัดทิ้งเงียบ ๆ: "/\t/evil.com" จะกลายเป็น "//evil.com" (ไปเว็บอื่น)
// และ "/a/../..//evil.com" ก็ normalize เป็น "//evil.com" ได้ — จึงต้องเช็คทั้งก่อนและหลัง parse

const BASE = 'http://internal.invalid'

const isProtocolRelative = (p: string) => p.startsWith('//') || p.startsWith('/\\')

/** path ภายในที่ปลอดภัย (normalize แล้ว) หรือ null ถ้าพาออกนอกเว็บได้ */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || next.length > 2048) return null
  if (!next.startsWith('/') || isProtocolRelative(next)) return null
  // ตัวอักษรควบคุม / ช่องว่าง / backslash — path ปกติของระบบไม่มี
  if (/[\u0000-\u001F\u007F\s\\]/.test(next)) return null
  try {
    const u = new URL(next, BASE)
    if (u.origin !== BASE) return null
    const out = u.pathname + u.search + u.hash
    return isProtocolRelative(out) ? null : out
  } catch {
    return null
  }
}
