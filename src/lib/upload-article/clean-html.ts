// ─── Upload Article — ทำความสะอาด HTML ต้นฉบับให้เหลือ semantic tag ล้วน ───────
// ใช้ตอน import (docx/html/gdoc) เพื่อตัด style/class/span ของ Word หรือ Google Docs
// ออกทั้งหมด โดยห้าม เพิ่ม/ลบ/แก้คำ ของผู้เขียนเด็ดขาด (เก็บ text node ทุกตัวไว้ครบ)

import { parse, HTMLElement, NodeType, TextNode } from 'node-html-parser'

const BLOCK_PASSTHROUGH = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'blockquote', 'figure', 'figcaption',
  'strong', 'em', 'br', 'hr',
])

function unwrapGoogleRedirect(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'google.com' && u.pathname === '/url') {
      const real = u.searchParams.get('q')
      if (real) return real
    }
  } catch {
    // ไม่ใช่ URL ที่ parse ได้ — คืนค่าเดิม
  }
  return url
}

function isBoldStyle(el: HTMLElement): boolean {
  const style = el.getAttribute('style') || ''
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) return true
  const tag = el.tagName.toLowerCase()
  return tag === 'b'
}

function isItalicStyle(el: HTMLElement): boolean {
  const style = el.getAttribute('style') || ''
  if (/font-style\s*:\s*italic/i.test(style)) return true
  const tag = el.tagName.toLowerCase()
  return tag === 'i'
}

/** ทำความสะอาด element หนึ่งตัวแบบ bottom-up (mutate in place ผ่าน node-html-parser API) */
function cleanElement(el: HTMLElement): void {
  for (const child of [...el.childNodes]) {
    if (child.nodeType === NodeType.ELEMENT_NODE) cleanElement(child as HTMLElement)
  }

  const tag = el.tagName.toLowerCase()

  if (tag === 'a') {
    const href = unwrapGoogleRedirect(el.getAttribute('href') || '')
    el.setAttributes(href ? { href } : {})
    return
  }
  if (tag === 'img') {
    const src = el.getAttribute('src') || ''
    const alt = el.getAttribute('alt') || ''
    el.setAttributes(src ? { src, alt } : { alt })
    return
  }
  if (BLOCK_PASSTHROUGH.has(tag)) {
    el.setAttributes({})
    return
  }
  if (tag === 'b') {
    el.tagName = 'strong'
    el.setAttributes({})
    return
  }
  if (tag === 'i') {
    el.tagName = 'em'
    el.setAttributes({})
    return
  }

  // แท็กที่ไม่รู้จัก (span/font/div/section/u/sub/sup/...) → unwrap แต่รักษา bold/italic
  // ที่มาจาก inline style ไว้ (ไม่ลบ/ไม่เพิ่มคำ เปลี่ยนแค่โครงสร้าง tag ห่อ)
  const bold = isBoldStyle(el)
  const italic = isItalicStyle(el)
  let inner = el.childNodes.map((n) => n.toString()).join('')
  if (italic) inner = `<em>${inner}</em>`
  if (bold) inner = `<strong>${inner}</strong>`
  el.replaceWith(inner)
}

/** ครอบ text node เดี่ยว ๆ ที่หลุดอยู่ระดับบนสุด (ไม่มี <p> ห่อ) ให้เป็น <p> */
function wrapStrayTextAtRoot(root: HTMLElement): void {
  const next: (typeof root.childNodes) = []
  for (const child of root.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE && !(child as TextNode).isWhitespace) {
      const wrapped = parse(`<p>${(child as TextNode).rawText}</p>`)
      next.push(...wrapped.childNodes)
    } else {
      next.push(child)
    }
  }
  root.childNodes = next
}

/** ลบ <p> ว่างเปล่า (ไม่มีตัวอักษรจริง) ที่หลงเหลือหลัง clean */
function stripEmptyParagraphs(html: string): string {
  return html.replace(/<p>(?:\s|&nbsp;|&#160;)*<\/p>/gi, '')
}

/**
 * ทำความสะอาด HTML ดิบ (จาก docx/Google Docs/paste) ให้เหลือ semantic tag ล้วน
 * ไม่มี style/class/id/span/font แปลกปลอม — คงเนื้อหาข้อความทุกตัวอักษรไว้ครบ
 */
export function cleanSemanticHtml(rawHtml: string): string {
  const stripped = String(rawHtml || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<o:p>[\s\S]*?<\/o:p>/gi, '')
    .replace(/<xml>[\s\S]*?<\/xml>/gi, '')

  const root = parse(stripped, { comment: false })
  for (const child of [...root.childNodes]) {
    if (child.nodeType === NodeType.ELEMENT_NODE) cleanElement(child as HTMLElement)
  }
  wrapStrayTextAtRoot(root)

  return stripEmptyParagraphs(root.innerHTML).trim()
}
