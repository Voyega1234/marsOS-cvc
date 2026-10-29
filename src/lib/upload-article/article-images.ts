// ─── Upload Article — วางรูปที่ AI สร้างลงในบทความ (ฟังก์ชันล้วน เรียกจาก unit test ได้) ─────
// การสร้างรูปจริงใช้ callGeminiImage ตัวเดียวกับหน้า Clients (โมเดลเดียวกัน + Image Prompt/ภาพตัวอย่างจาก Content Engine)
// ที่นี่ทำแค่: หา H2 ที่จะวางรูป, แทรก <figure> หลัง H2, ลบรูปที่ระบบสร้างไว้รอบก่อน — ไม่แตะถ้อยคำของบทความ

import { UPLOAD_MAX_INLINE_IMAGES, DEFAULT_UPLOAD_IMAGE_DEFAULTS, type UploadImageDefaults } from './types'
import { TAKEAWAYS_HEADING_RE } from '@/lib/article-structure'

/** ป้ายบน <figure> ที่ระบบสร้าง — ใช้หาแล้วลบ/แทนที่ตอนสร้างใหม่ (รูปของผู้เขียนไม่มีป้ายนี้ ไม่โดนแตะ) */
export const GEN_FIGURE_ATTR = 'data-ua-gen'

/**
 * ป้ายบนรูปที่ต้นฉบับแปะไว้ติดหัวเรื่องเอง แล้ว Generate ใช้เป็นปกในเนื้อหาแทนกล่องปกของระบบ
 * push ไม่ตัดรูปนี้ (อยู่เหมือนเดิมทั้งติ๊ก/ไม่ติ๊ก "ใส่ปกในเนื้อหาด้วย") · export ไม่ใส่ปกซ้ำด้านบน
 */
export const SOURCE_COVER_ATTR = 'data-ua-src-cover'

/** เนื้อหามีปกอยู่แล้ว (กล่องปกระบบ หรือรูปปกของต้นฉบับ) — export ไม่ต้องแปะปกเพิ่มด้านบน */
export function htmlHasBodyCover(html: string): boolean {
  return html.includes('content-cover') || html.includes(SOURCE_COVER_ATTR)
}

const H2_RE = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi
const FAQ_HEADING_RE = /(faq|frequently asked|คำถามที่พบบ่อย|คำถามยอดฮิต|ถาม\s*-?\s*ตอบ)/i
/** หัวข้อสารบัญที่ผู้เขียน/AI เขียนมาในเนื้อหา — ระบบใส่สารบัญเอง ไม่ใช่หัวข้อเนื้อหา (ไม่วางรูป/ไม่ขึ้นปก) */
export const TOC_HEADING_RE = /^\s*(?:สารบัญ(?:บทความ|เนื้อหา)?|table of contents|contents|in this article)\s*:?\s*$/i

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface H2Slot {
  /** ลำดับ H2 ในเอกสาร (0-based) */
  index: number
  text: string
}

/** H2 ทั้งหมดในเอกสาร ตามลำดับ */
export function listH2(html: string): H2Slot[] {
  const out: H2Slot[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(H2_RE.source, 'gi')
  let i = 0
  while ((m = re.exec(html))) {
    out.push({ index: i, text: textOf(m[1]) })
    i++
  }
  return out
}

/** H2 ที่ใช้เป็นหัวข้อบนปกได้ (ตัด FAQ ออก) — สูงสุด 3 ข้อ */
export function coverBulletsFromHtml(html: string): string[] {
  return listH2(html).filter((h) => h.text && !FAQ_HEADING_RE.test(h.text) && !TOC_HEADING_RE.test(h.text) && !TAKEAWAYS_HEADING_RE.test(h.text)).map((h) => h.text).slice(0, 3)
}

/** เลือก H2 ที่จะวางรูปประกอบ กระจายให้ทั่วบทความ (ไม่วางใต้หัวข้อ FAQ) */
export function pickInlineSlots(html: string, count: number): H2Slot[] {
  const n = Math.max(0, Math.min(UPLOAD_MAX_INLINE_IMAGES, Math.floor(count)))
  const candidates = listH2(html).filter((h) => h.text && !FAQ_HEADING_RE.test(h.text) && !TOC_HEADING_RE.test(h.text) && !TAKEAWAYS_HEADING_RE.test(h.text))
  if (n === 0 || candidates.length === 0) return []
  if (candidates.length <= n) return candidates
  const picked: H2Slot[] = []
  const step = candidates.length / n
  for (let k = 0; k < n; k++) picked.push(candidates[Math.floor(k * step)])
  return picked
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function generatedFigureHtml(src: string, alt: string): string {
  return `<figure class="content-figure" ${GEN_FIGURE_ATTR}="1"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"></figure>`
}

/** ลบ <figure> ที่ระบบสร้างไว้ทั้งหมด (รูปจากไฟล์ต้นฉบับไม่โดน) */
export function removeGeneratedFigures(html: string): string {
  return html.replace(new RegExp(`\\s*<figure\\b[^>]*\\b${GEN_FIGURE_ATTR}="1"[^>]*>[\\s\\S]*?<\\/figure>`, 'gi'), '')
}

export function countGeneratedFigures(html: string): number {
  return (html.match(new RegExp(`<figure\\b[^>]*\\b${GEN_FIGURE_ATTR}="1"`, 'gi')) || []).length
}

/** แทรกรูปต่อท้าย H2 ตามลำดับ index — ตำแหน่งไหนไม่เจอ H2 ก็ข้าม */
export function insertFiguresAfterH2(html: string, figures: { h2Index: number; html: string }[]): string {
  if (figures.length === 0) return html
  const byIndex = new Map<number, string>()
  for (const f of figures) byIndex.set(f.h2Index, (byIndex.get(f.h2Index) || '') + f.html)
  let i = 0
  return html.replace(new RegExp(H2_RE.source, 'gi'), (whole) => {
    const add = byIndex.get(i)
    i++
    return add ? `${whole}\n${add}` : whole
  })
}

/** ค่าเริ่มต้นการสร้างรูปจาก pushPrefs.imageDefaults (ค่าเพี้ยน = ใช้ค่าตั้งต้น) */
export function readImageDefaults(raw: unknown): UploadImageDefaults {
  const d = raw && typeof raw === 'object' ? (raw as Partial<UploadImageDefaults>) : {}
  const count = Number(d.inlineCount)
  return {
    cover: typeof d.cover === 'boolean' ? d.cover : DEFAULT_UPLOAD_IMAGE_DEFAULTS.cover,
    coverWithText: typeof d.coverWithText === 'boolean' ? d.coverWithText : DEFAULT_UPLOAD_IMAGE_DEFAULTS.coverWithText,
    inlineCount: Number.isFinite(count) ? Math.max(0, Math.min(UPLOAD_MAX_INLINE_IMAGES, Math.floor(count))) : DEFAULT_UPLOAD_IMAGE_DEFAULTS.inlineCount,
    inlineWithText: typeof d.inlineWithText === 'boolean' ? d.inlineWithText : DEFAULT_UPLOAD_IMAGE_DEFAULTS.inlineWithText,
  }
}

/**
 * แทรกรูปต่อท้าย H2 ที่ข้อความตรงกัน — ใช้กับ htmlContent ที่ Generate แล้ว (มี TOC/การ์ดแทรก ลำดับ H2 อาจไม่ตรงต้นฉบับ)
 * H2 ซ้ำชื่อกัน = ใช้ตัวแรกที่ยังไม่ถูกใช้
 */
export function insertFiguresAfterH2Text(html: string, figures: { text: string; html: string }[]): string {
  if (figures.length === 0) return html
  const pending = figures.map((f) => ({ ...f, done: false }))
  return html.replace(new RegExp(H2_RE.source, 'gi'), (whole, inner: string) => {
    const t = textOf(inner)
    const hit = pending.filter((f) => !f.done && f.text === t)
    if (hit.length === 0) return whole
    for (const f of hit) f.done = true
    return `${whole}\n${hit.map((f) => f.html).join('')}`
  })
}

const COVER_BOX_RE = /<figure\b[^>]*\bcontent-cover\b[^>]*>[\s\S]*?<\/figure>/i

/**
 * ปกโหมด text: <figure> (หรือ <p>) ที่มีแค่รูป src เดียวกับ coverImageUrl — โหมดนี้ไม่มี class content-cover ให้จับ
 * คืนช่วง [start, end) ของตัวแรก (end รวมช่องว่างที่ตามมา) หรือ null
 */
function plainCoverRange(html: string, coverSrc: string | null | undefined): { start: number; end: number } | null {
  if (!coverSrc) return null
  const wanted = new Set([coverSrc, escapeAttr(coverSrc)])
  const re = /<(figure|p)\b[^>]*>\s*(?:<a\b[^>]*>\s*)?<img\b[^>]*\bsrc="([^"]*)"[^>]*>\s*(?:<\/a>\s*)?(?:<figcaption\b[\s\S]*?<\/figcaption>\s*)?<\/\1>\s*/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    // รูปปกของผู้เขียนเอง (ป้าย SOURCE_COVER_ATTR) ไม่ใช่ปกที่ระบบใส่ — ไม่ตัด/ไม่แทนที่
    if (wanted.has(m[2]) && !m[0].slice(0, m[0].indexOf('>')).includes(SOURCE_COVER_ATTR)) return { start: m.index, end: m.index + m[0].length }
  }
  return null
}

/**
 * ตัดกล่องปก (figure.content-cover) ออกจาก HTML — ไม่มีกล่องปก = คืนค่าเดิม
 * ส่ง coverSrc มาด้วย = ไม่มีกล่องปกแต่เจอรูป src เดียวกับปก (บทความโหมด text) ก็ตัดตัวนั้นแทน
 */
export function removeCoverFromHtml(html: string, coverSrc?: string | null): string {
  const out = html.replace(/<figure\b[^>]*\bcontent-cover\b[^>]*>[\s\S]*?<\/figure>\s*/gi, '')
  if (out !== html) return out
  const r = plainCoverRange(html, coverSrc)
  return r ? html.slice(0, r.start) + html.slice(r.end) : html
}

/**
 * ใส่รูปปกในกล่องปก (figure.content-cover) ของ htmlContent ที่ Generate แล้ว ให้ preview เห็นปกใหม่ในบทความ
 * มีกล่องปก = เปลี่ยนรูป · ไม่มี (บทความที่ Generate ก่อนมีปก) = ใส่ต่อจาก H1 ตำแหน่งเดียวกับ buildUploadArticleHtml
 * ส่ง oldSrc มา = ปกเดิมแบบโหมด text (ไม่มีกล่องปก) ถูกแทนที่ตรงจุดเดิม ไม่ใส่เพิ่มเป็น 2 รูป
 * ตอน push กล่องปกถูกตัดออกอยู่แล้วถ้าไม่ได้เปิด "ใส่ปกในเนื้อหาด้วย" (bodyCover) — ไม่เกิดปกซ้อน
 * ไม่มีทั้งกล่องปกและ H1 = คืนค่าเดิม
 */
export function replaceCoverInHtml(html: string, src: string, alt: string, oldSrc?: string | null): string {
  const fig = `<figure class="content-figure content-cover"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"></figure>`
  if (COVER_BOX_RE.test(html)) return html.replace(COVER_BOX_RE, () => fig)
  const r = plainCoverRange(html, oldSrc)
  if (r) {
    const trail = html.slice(r.start, r.end).match(/\s*$/)?.[0] || ''
    return html.slice(0, r.start) + fig + trail + html.slice(r.end)
  }
  return html.replace(/<\/h1>/i, (end) => `${end}\n${fig}`)
}
