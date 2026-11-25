/**
 * ตัวปรับผลสแกนสำหรับเว็บ Wix (ตัวแสดงบทความ Ricos) — เรียกเฉพาะหน้าที่ isWixPage() เป็นจริง
 * เว็บอื่น (WordPress ฯลฯ) ไม่ผ่านไฟล์นี้เลย ผลสแกนเดิมไม่เปลี่ยน
 *
 * ทำไมต้องมี: Wix ไม่ได้จัดหน้าด้วย CSS แบบเว็บทั่วไป วัดจาก CSS ตรง ๆ จึงได้ค่าที่ไม่ใช่ของจริง
 *  - ระยะห่างระหว่างบล็อก: margin ของ p/h2/h3 เป็น 0 ทั้งหมด ช่องว่างที่เห็นคือ "บรรทัดว่าง" (บล็อก type="empty-line") ที่คนเขียนกด Enter
 *  - จุดนำหน้ารายการและระยะเยื้อง: อยู่ใน style="" ของ <li> แต่ละตัว ไม่ได้อยู่ใน stylesheet
 *  - ลิงก์: บทความที่ไม่มีลิงก์ในย่อหน้า ตัววัดไปหยิบปุ่มมาแทน ได้สีปุ่มไม่ใช่สีลิงก์
 *  - ตัวหนาในหัวข้อ: บน Wix ใช้ฟอนต์ของหัวข้อ ไม่ใช่ฟอนต์ตัวหนาของย่อหน้า
 */
import type { UploadArticleStyle, UploadTextStyle } from './types'
import { articleFontStacks, fontCoverage, fontFaceCss, fontFaceLoadable, primaryFontFamilies, usedFontFaces } from './font-faces'

/** ชนิดบล็อกของ Ricos ตามลำดับที่อยู่ในบทความ (อ่านจาก <div type="…" data-hook="rcv-blockN">) */
type WixBlock = 'paragraph' | 'heading' | 'list' | 'empty' | 'other'

const MARKER_RE = /<div\b[^>]*\bdata-hook="rcv-block\d+"[^>]*>/gi
const LIST_STYLES = ['disc', 'circle', 'square', 'decimal'] as const

function blockKind(tag: string): WixBlock {
  // (?<![\w-]) กัน data-type="…" ถูกอ่านเป็น type
  const type = (/(?<![\w-])type="([^"]+)"/i.exec(tag)?.[1] || '').toLowerCase()
  if (type === 'empty-line') return 'empty'
  if (type === 'paragraph') return 'paragraph'
  if (type === 'heading') return 'heading'
  if (/^(?:bulleted|ordered|numbered)[_-]list$/.test(type)) return 'list'
  return 'other'
}

export interface WixBlockStats {
  /** บล็อกที่ตามด้วยบรรทัดว่าง / ตามด้วยข้อความทันที แยกตามชนิด */
  paragraph: { spaced: number; tight: number }
  heading: { spaced: number; tight: number }
  list: { spaced: number; tight: number }
  /** ย่อหน้าที่ตามด้วยรายการทันที (ประโยคนำ + รายการ) เทียบกับรายการที่มีบรรทัดว่างคั่นก่อน */
  listLead: { tight: number; spaced: number }
  emptyLines: number
}

/** นับว่าบล็อกแต่ละชนิดเว้นบรรทัดหลังตัวเองหรือไม่ — html คือเนื้อบทความ (ช่วง post-description) */
export function wixBlockStats(html: string): WixBlockStats {
  const seq = Array.from(html.matchAll(MARKER_RE), (m) => blockKind(m[0]))
  const stats: WixBlockStats = {
    paragraph: { spaced: 0, tight: 0 },
    heading: { spaced: 0, tight: 0 },
    list: { spaced: 0, tight: 0 },
    listLead: { tight: 0, spaced: 0 },
    emptyLines: 0,
  }
  const isText = (k: WixBlock | undefined) => k === 'paragraph' || k === 'heading' || k === 'list'
  seq.forEach((kind, i) => {
    if (kind === 'empty') stats.emptyLines++
    const next = seq[i + 1]
    if (kind === 'list') {
      const prev = seq[i - 1]
      if (prev === 'paragraph') stats.listLead.tight++
      else if (prev === 'empty') stats.listLead.spaced++
    }
    if (kind !== 'paragraph' && kind !== 'heading' && kind !== 'list') return
    // ย่อหน้าที่ตามด้วยรายการนับแยก (listLead) ไม่เอามาตัดสินระยะหลังย่อหน้าทั่วไป
    if (kind === 'paragraph' && next === 'list') return
    if (next === 'empty') stats[kind].spaced++
    else if (isText(next)) stats[kind].tight++
  })
  return stats
}

/** ค่า margin ที่วัดได้เป็น 0 หรือไม่มีค่า = ยังไม่มีระยะจริงให้ใช้ */
function isZero(v: string | undefined): boolean {
  return v === undefined || /^0(?:\.0+)?(?:px|em|rem|%)?$/.test(v.trim())
}

/** ความสูงของบรรทัดว่างหนึ่งบรรทัด = ขนาดตัวอักษรย่อหน้า × line-height (px) */
function emptyLineHeight(p: UploadTextStyle | undefined): string | undefined {
  const size = /^([\d.]+)px$/.exec((p?.fontSize || '').trim())
  if (!size) return undefined
  const fontPx = parseFloat(size[1])
  const lh = (p?.lineHeight || '').trim()
  let px: number
  if (/^[\d.]+px$/.test(lh)) px = parseFloat(lh)
  else if (/^[\d.]+$/.test(lh)) px = fontPx * parseFloat(lh)
  else if (/^[\d.]+%$/.test(lh)) px = (fontPx * parseFloat(lh)) / 100
  else px = fontPx * 1.5
  if (!Number.isFinite(px) || px <= 0 || px > 200) return undefined
  return `${Math.round(px * 10) / 10}px`
}

/** style="" ของ <li> ตัวแรกใน <ul> — Wix เก็บจุดนำหน้าและระยะเยื้องไว้ตรงนี้ */
function firstBulletStyle(html: string): { listStyle?: string; indent?: string } {
  const li = /<ul\b[^>]*>\s*<li\b[^>]*(?<![\w-])style="([^"]*)"/i.exec(html)
  if (!li) return {}
  const decl = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(li[1])?.[1].trim().toLowerCase()
  const type = decl('list-style-type')
  const indent = decl('margin-inline-start') || decl('margin-left')
  return {
    listStyle: (LIST_STYLES as readonly string[]).includes(type || '') ? type : undefined,
    indent: indent && /^\d+(?:\.\d+)?(?:em|rem|px)$/.test(indent) && parseFloat(indent) > 0 ? indent : undefined,
  }
}

/** บทความมีลิงก์อยู่ในย่อหน้าจริงไหม (ไม่ใช่ปุ่ม) — มี = ค่าที่ตัววัดได้เป็นของจริงแล้ว */
function hasParagraphLink(html: string): boolean {
  return /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<a\b[^>]*\bhref=/i.test(html)
}

export interface WixAdaptInput {
  article: UploadArticleStyle
  /** HTML ของเนื้อบทความ (ช่วง post-description) */
  html: string
  /** HTML ทั้งหน้า — ใช้อ่านตัวแปร --ricos-* ที่ Wix ฝังไว้ */
  page?: string
  /** สีลิงก์ที่อ่านจากตัวแปรธีมของ Wix (--ricos-custom-link-color) */
  linkColor?: string | null
}

/**
 * ปรับผลสแกนของหน้า Wix ให้ตรงกับที่เห็นบนเว็บจริง — คืน object ใหม่ ไม่แก้ของเดิม
 * แตะเฉพาะค่าที่ตัววัดอ่านไม่ได้ (0 / none / ไม่มีค่า) ค่าที่วัดได้จริงคงไว้
 */
export function adaptWixArticleStyle(input: WixAdaptInput): UploadArticleStyle {
  const { html } = input
  const a: UploadArticleStyle = { ...input.article }
  const stats = wixBlockStats(html)
  const gap = emptyLineHeight(a.p)

  // 1) ระยะห่างระหว่างบล็อก = บรรทัดว่าง 1 บรรทัด เมื่อคนเขียนเว้นบรรทัดเป็นส่วนใหญ่
  const spacedMostly = (s: { spaced: number; tight: number }) => s.spaced >= 2 && s.spaced >= s.tight
  if (gap) {
    if (spacedMostly(stats.paragraph) && isZero(a.p?.marginBottom)) a.p = { ...a.p, marginBottom: gap }
    if (spacedMostly(stats.heading)) {
      if (isZero(a.h2?.marginBottom)) a.h2 = { ...a.h2, marginBottom: gap }
      if (isZero(a.h3?.marginBottom)) a.h3 = { ...a.h3, marginBottom: gap }
      if (isZero(a.h4?.marginBottom)) a.h4 = { ...a.h4, marginBottom: gap }
    }
    if (spacedMostly(stats.list) && isZero(a.ul?.margin)) a.ul = { ...a.ul, margin: `0 0 ${gap}` }
  }

  // 2) รายการ: จุดนำหน้า + ระยะเยื้องจาก style ของ <li>
  const bullet = firstBulletStyle(html)
  if (bullet.listStyle && (!a.li?.listStyle || a.li.listStyle === 'none')) a.li = { ...a.li, listStyle: bullet.listStyle }
  if (bullet.indent && isZero(a.li?.marginLeft) && isZero(a.li?.paddingLeft)) a.li = { ...a.li, marginLeft: bullet.indent }

  // 3) ประโยคนำติดกับรายการ (ไม่มีบรรทัดว่างคั่น) — ย่อหน้าที่อยู่ก่อนรายการไม่เว้นระยะ
  if (stats.listLead.tight >= 1 && stats.listLead.tight >= stats.listLead.spaced && !isZero(a.p?.marginBottom)) a.listTight = true

  // 4) ตัวหนาในหัวข้อใช้ฟอนต์ของหัวข้อ
  a.headingStrongInherit = true

  // 5) ลิงก์: บทความตัวอย่างไม่มีลิงก์ในย่อหน้า = ค่าที่วัดได้มาจากปุ่ม ใช้สีลิงก์ของธีม Wix แทน
  if (!hasParagraphLink(html)) {
    const deco = /--ricos-custom-link-text-decoration\s*:\s*([a-z-]+)/i.exec(input.page || html)?.[1].toLowerCase()
    a.link = {
      ...(input.linkColor ? { color: input.linkColor } : {}),
      decoration: deco === 'underline' ? 'underline' : 'none',
    }
  }
  return a
}

/**
 * ฟอนต์สำหรับบทความที่ push เข้า Wix — บทความลงเป็น HTML embed บล็อกเดียว CSS/ฟอนต์ของเว็บเข้าไม่ถึง
 * จึงต้องแนบ @font-face (ลิงก์ไฟล์ตรงจากเว็บลูกค้า/Google Fonts) ไปกับเนื้อหา
 * คืน style = แท็ก <style> ที่วางหน้าเนื้อหา · warning = ฟอนต์หลักที่ยังไม่มีไฟล์ (บทความจะแสดงด้วยตัวสำรอง)
 */
export function wixFontPrelude(article: UploadArticleStyle | undefined): { style: string; warning?: string } | null {
  if (!article) return null
  try {
    const stacks = articleFontStacks(article)
    // เฉพาะไฟล์ที่เบราว์เซอร์โหลดได้จริง (https + นามสกุลฟอนต์) และเฉพาะ family ที่บทความใช้
    const css = fontFaceCss(usedFontFaces(article.fontFaces, stacks).filter(fontFaceLoadable), (url) => url)
    const primary = new Set(primaryFontFamilies(stacks).map((n) => n.toLowerCase()))
    const missing = fontCoverage(stacks, article.fontFaces)
      .filter((c) => c.status === 'missing' && primary.has(c.family.toLowerCase()))
      .map((c) => c.family)
    return {
      style: css ? `<style>${css}</style>` : '',
      ...(missing.length
        ? { warning: `ยังไม่มีไฟล์ฟอนต์: ${missing.join(', ')} — บทความบน Wix จะแสดงด้วยตัวสำรอง ดาวน์โหลดไฟล์ฟอนต์ (.woff2) แล้ววางลิงก์ที่ส่วนฟอนต์ของบทความ จากนั้น Push ใหม่` }
        : {}),
    }
  } catch {
    // ค่าธีมที่เก็บไว้ผิดรูป (ไม่ได้ผ่านตัวกรอง) ต้องไม่ทำให้ push ล้ม — ส่งบทความโดยไม่แนบฟอนต์
    return null
  }
}
