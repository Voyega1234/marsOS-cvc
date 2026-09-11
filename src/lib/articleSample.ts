// ─────────────────────────────────────────────────────────────────────────────
//  บทความตัวอย่าง (Project.sampleArticle / "บันทึกเป็น Pattern" ใน Article Lab)
//
//  HTML ที่ /api/article/write คืนมามีรูปประกอบ + รูปผู้เขียนฝังเป็น base64
//  และมี <script ld+json> + <style> ก้อนใหญ่อยู่หัวบทความ
//  - เก็บลง DB ทั้งก้อน = body หลาย MB ชนเพดาน request 4.5MB ของ Vercel → บันทึกไม่ลง
//  - ส่งเข้า prompt ทั้งก้อน = 6000 ตัวอักษรแรกเป็นแค่ JSON-LD กับ CSS ไม่ใช่เนื้อบทความ
// ─────────────────────────────────────────────────────────────────────────────

const DATA_URI_RE = /data:[a-z]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi

/** ตัดรูปที่ฝังเป็น base64 ออก เหลือโครง HTML เดิม — ใช้ก่อนเก็บลง DB */
export function stripInlineImages(html: string): string {
  if (!html) return html
  return html.replace(DATA_URI_RE, '')
}

/** เหลือเฉพาะเนื้อบทความ ไม่มี script / style / comment / รูป base64 — ใช้ก่อนใส่ prompt */
export function sampleForPrompt(html: string): string {
  if (!html) return ''
  return stripInlineImages(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}
