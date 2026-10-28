// ─── SME Article — จัดการรูปที่ระบบ (Mars) สร้างในบทความ (ฟังก์ชันล้วน ใช้ได้ทั้งฝั่ง client/server) ─────
// บทความ SME ไม่มีไฟล์ต้นฉบับ → รูปประกอบที่ writer สร้างเองทั้งหมดถือเป็นรูปของ Mars (ลบ/สร้างใหม่ได้)

import { GEN_FIGURE_ATTR } from '@/lib/upload-article/article-images'

const FIGURE_RE = /\s*<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi

/** figure ที่ Mars สร้าง = มี data-ua-gen หรือเป็นรูป writer เก่า (content-figure + img เป็น data:image/ ไม่ใช่กล่องปก) */
function isMarsFigure(attrs: string, inner: string): boolean {
  if (new RegExp(`\\b${GEN_FIGURE_ATTR}="1"`, 'i').test(attrs)) return true
  const cls = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''
  const tokens = cls.split(/\s+/)
  if (!tokens.includes('content-figure') || tokens.includes('content-cover')) return false
  return /<img\b[^>]*\bsrc\s*=\s*["']data:image\//i.test(inner)
}

export function countSmeGeneratedFigures(html: string): number {
  let n = 0
  html.replace(FIGURE_RE, (whole, attrs: string, inner: string) => {
    if (isMarsFigure(attrs, inner)) n++
    return whole
  })
  return n
}

export function removeSmeGeneratedFigures(html: string): string {
  return html.replace(FIGURE_RE, (whole, attrs: string, inner: string) => (isMarsFigure(attrs, inner) ? '' : whole))
}

const META_BLOCK_RE = /<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i

/** alt ปก — ตัดขึ้นบรรทัดใหม่/--> ออก เหลือไม่เกิน 200 ตัวอักษร */
function cleanAlt(alt: string): string {
  return alt.replace(/-->/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** อ่าน cover_image_alt จากบล็อก CONVERT_CAKE_SEO_META (ตัวอ่านเดียวกับ extractSeoMeta ตอน push) — ไม่มี = '' */
export function getCoverAltFromHtml(html: string): string {
  const block = html.match(META_BLOCK_RE)?.[1] ?? ''
  const m = block.match(/cover_image_alt\s*[:=]\s*([^\n]+)/i)
  return m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
}

/** ตั้ง cover_image_alt ในบล็อก SEO_META — แทนบรรทัดเดิม / เพิ่มบรรทัดใหม่ในบล็อก / ไม่มีบล็อกก็ต่อท้ายบทความ */
export function setCoverAltInHtml(html: string, alt: string): string {
  const clean = cleanAlt(alt)
  const line = `cover_image_alt: ${clean}`
  const m = html.match(META_BLOCK_RE)
  if (!m) return `${html}\n<!-- CONVERT_CAKE_SEO_META\n${line}\n-->`
  const body = m[1]
  const lineRe = /^([ \t]*)cover_image_alt[ \t]*[:=].*$/im
  const nextBody = lineRe.test(body)
    ? body.replace(lineRe, (_w, indent: string) => `${indent}${line}`)
    : `${body.replace(/\s*$/, '')}\n${line}\n`
  return html.replace(META_BLOCK_RE, () => `<!-- CONVERT_CAKE_SEO_META${nextBody}-->`)
}
