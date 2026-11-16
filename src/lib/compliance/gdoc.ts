/** Google Docs helpers (pure) — ใช้ทั้งฝั่ง route และ client */

export const GDOC_MIME = 'application/vnd.google-apps.document'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const GDOC_MAX_BYTES = 3 * 1024 * 1024
export const GDOC_TOO_BIG = 'เอกสารใหญ่เกิน 3 MB — แบ่งเอกสารก่อนตรวจ'

const ID_RE = /^[A-Za-z0-9_-]{20,}$/

/** ดึง fileId จากลิงก์ docs.google.com/document/d/<id>/... หรือรับ id เปล่า; ไม่ถูกต้อง = null */
export function parseGdocId(input: string): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  if (ID_RE.test(s)) return s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.port) return null
  const m = u.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})(?:\/|$)/)
  return m ? m[1] : null
}

/** แปลง error ของ Drive API เป็นข้อความไทย */
export function gdocErrorMessage(e: unknown, serviceEmail: string): string {
  const err = e as { code?: unknown; status?: unknown; message?: unknown; response?: { status?: unknown } } | null
  const msg = typeof err?.message === 'string' ? err.message : ''
  const code = Number(err?.code ?? err?.status ?? err?.response?.status)
  if (msg.includes('has not been used in project') || msg.includes('is disabled') || msg.includes('accessNotConfigured')) {
    return 'ยังไม่ได้เปิด Google Drive API ใน Google Cloud project ของ service account'
  }
  if (code === 403 || code === 404 || msg.includes('does not have permission')) {
    return `เปิด Google Doc ไม่ได้ — แชร์ไฟล์ให้ ${serviceEmail || 'อีเมลของระบบ (service account)'} เป็น Editor ก่อน`
  }
  return (msg || 'เชื่อมต่อ Google Doc ไม่สำเร็จ').slice(0, 200)
}
