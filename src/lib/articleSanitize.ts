/**
 * Sanitizer ขาออกของบทความ — กันข้อความ AI หลุด (feedback PSEO ข้อ 3)
 * ตัดแบบ deterministic ก่อน save และก่อน push:
 * - markdown code fence
 * - ประโยคเกริ่น/ปิดท้ายของ AI ที่ไม่ใช่ HTML ("แน่นอนครับ นี่คือบทความ...", "Here is...")
 * - เอกสารเต็มรูป (<!DOCTYPE>, <html>, <head>, <body>) → เหลือเฉพาะเนื้อใน body
 */

const META_COMMENT = /<!--\s*CONVERT_CAKE_SEO_META[\s\S]*?-->/i

export function sanitizeArticleHtml(raw: string): string {
  let html = raw.trim()

  // 1) markdown fences ทั้งเปิดและปิด (รวมกรณีอยู่กลางข้อความ)
  html = html.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '')
  html = html.replace(/\n```[a-z]*\s*\n/gi, '\n')

  // 2) เอกสารเต็มรูป → เอาเฉพาะใน <body>
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) {
    const meta = html.match(META_COMMENT)?.[0] ?? ''
    html = (meta && !bodyMatch[1].includes('CONVERT_CAKE_SEO_META') ? meta + '\n' : '') + bodyMatch[1]
  }
  html = html.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')

  // 3) ข้อความเกริ่นก่อน HTML จริง — ตัดทุกอย่างก่อนจุดเริ่มที่ยอมรับ
  //    (META comment / ld+json / แท็ก HTML ตัวแรก)
  const startMatch = html.match(/<!--\s*CONVERT_CAKE_SEO_META|<script\s+type="application\/ld\+json"|<(?:h[1-6]|p|div|section|article|nav|figure|ul|ol|table|blockquote)\b/i)
  if (startMatch && startMatch.index && startMatch.index > 0) {
    const preface = html.slice(0, startMatch.index)
    // ตัดเฉพาะกรณี preface เป็นข้อความล้วน (ไม่มีแท็ก) — กันตัดเนื้อหาจริงพลาด
    if (!/</.test(preface.trim())) html = html.slice(startMatch.index)
  }

  // 4) ข้อความปิดท้ายหลังแท็กสุดท้าย ("หวังว่าบทความนี้...", "Let me know...")
  const lastClose = html.lastIndexOf('>')
  if (lastClose !== -1 && lastClose < html.length - 1) {
    const tail = html.slice(lastClose + 1)
    if (!/</.test(tail) && tail.trim().length > 0) html = html.slice(0, lastClose + 1)
  }

  // 5) ประโยค AI ที่โผล่เป็น paragraph แรก/สุดท้าย
  const AI_PHRASES = /^(?:แน่นอน|นี่คือบทความ|ได้เลย|ต่อไปนี้คือ|Here (?:is|'s)|Sure|Certainly|Below is|I have (?:written|created))/i
  html = html.replace(/<p>([^<]{0,160})<\/p>\s*/i, (m, txt) => (AI_PHRASES.test(txt.trim()) ? '' : m))

  return html.trim()
}
