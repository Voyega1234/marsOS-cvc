// ─── Upload Article — ทำความสะอาด HTML ต้นฉบับให้เหลือ semantic tag ล้วน ───────
// ใช้ตอน import (docx/html/gdoc) เพื่อตัด style/class/span ของ Word หรือ Google Docs
// ออกทั้งหมด โดยห้าม เพิ่ม/ลบ/แก้คำ ของผู้เขียนเด็ดขาด (เก็บ text node ทุกตัวไว้ครบ)
//
// ระวัง XSS: ต้อง parse ด้วย blockTextElements: {} เสมอ ไม่งั้น node-html-parser จะเก็บเนื้อหาใน
// <pre>/<script>/<style>/<noscript> เป็น raw text (ไม่ parse เป็น element) — พอ unwrap แท็กที่ไม่รู้จัก
// ด้วยการ serialize เป็น string แล้ว replaceWith(string) มันจะถูก reparse ใหม่โดยไม่ผ่านการ clean เลย
// (เช่น <pre><img src=x onerror=alert(1)></pre> จะกลายเป็น <img onerror> ที่ทำงานจริง) — ฟังก์ชันนี้จึง
// ย้าย child node ที่ clean แล้วออกมาตรง ๆ (replaceWith(...nodes)) แทนการ reparse string เสมอ

import { parse, HTMLElement, Node, NodeType, TextNode } from 'node-html-parser'
import { decodeTextEntities } from './entities'

export { decodeTextEntities }

const BLOCK_PASSTHROUGH = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'blockquote', 'figure', 'figcaption',
  'strong', 'em', 'br', 'hr',
])

/** แท็กอันตราย/ไม่จำเป็น — ตัดทิ้งทั้งก้อนพร้อมเนื้อหาข้างใน ไม่ unwrap */
const DROP_TAGS = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'template'])

/** ให้ parse ไม่เก็บเนื้อหาของแท็กไหนเป็น raw text เลย — ทุก element ต้องถูก parse/clean จริง */
const PARSE_OPTIONS = { blockTextElements: {} }

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

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

/** ถอด HTML entity (ตัวเลข/ชื่อ) กัน obfuscation แบบ "&#106;avascript:" */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X'
      const code = parseInt(ent.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    const named = NAMED_ENTITIES[ent.toLowerCase()]
    return named ?? m
  })
}

/** ถอด entity แล้วตัด control char/ช่องว่างทั้งหมดออก — ใช้ตรวจ scheme เท่านั้น กัน obfuscation แบบ "java\tscript:" */
function normalizeForSchemeCheck(raw: string): string {
  return decodeEntities(raw).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, '')
}

const SAFE_HREF_SCHEME_RE = /^(https?:|mailto:|tel:)/i

/** ลิงก์ที่ชี้ไป bookmark/heading ภายในไฟล์ต้นฉบับ เช่น #bookmark=id.xxx, #heading=h.xxx, #_Toc123 */
const DOC_INTERNAL_ANCHOR_RE = /^#(bookmark=|heading=|h\.|id\.|_)/i

/** allowlist ของ a[href]: http/https/mailto/tel หรือขึ้นต้นด้วย # หรือ / เท่านั้น — อื่น ๆ ตัด href ทิ้ง */
export function sanitizeHref(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  const normalized = normalizeForSchemeCheck(trimmed)
  if (normalized.startsWith('#') || normalized.startsWith('/')) return trimmed
  if (SAFE_HREF_SCHEME_RE.test(normalized)) return trimmed
  return ''
}

const SAFE_IMG_HTTP_RE = /^https?:/i
const SAFE_IMG_DATA_RE = /^data:image\/(png|jpe?g|gif|webp|avif)[;,]/i

/** allowlist ของ img[src]: http(s): หรือ data:image/(png|jpeg|jpg|gif|webp|avif) เท่านั้น — อื่น ๆ ตัดทั้ง img ทิ้ง */
export function sanitizeImgSrc(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  const normalized = normalizeForSchemeCheck(trimmed)
  if (SAFE_IMG_HTTP_RE.test(normalized) || SAFE_IMG_DATA_RE.test(normalized)) return trimmed
  return ''
}

// Google Docs (export?format=html) ใส่ตัวหนา/เอียงเป็น class ที่ประกาศใน <style> ไม่ใช่ inline style
// cleanSemanticHtml อ่าน class พวกนี้เก็บไว้ก่อนตัด <style> ทิ้ง (ทำงานแบบ sync ในการเรียกครั้งเดียว)
let boldClasses = new Set<string>()
let italicClasses = new Set<string>()

function collectFormatClasses(rawHtml: string): void {
  boldClasses = new Set()
  italicClasses = new Set()
  const styles = rawHtml.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []
  for (const block of styles) {
    const re = /((?:\.[\w-]+\s*,?\s*)+)\{([^}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(block))) {
      const names = (m[1].match(/\.[\w-]+/g) || []).map((n: string) => n.slice(1))
      const bold = /font-weight\s*:\s*(bold|[6-9]00)/i.test(m[2])
      const italic = /font-style\s*:\s*italic/i.test(m[2])
      for (const n of names) {
        if (bold) boldClasses.add(n)
        if (italic) italicClasses.add(n)
      }
    }
  }
}

function hasClassIn(el: HTMLElement, set: Set<string>): boolean {
  if (set.size === 0) return false
  return (el.getAttribute('class') || '').split(/\s+/).some(c => set.has(c))
}

function isBoldStyle(el: HTMLElement): boolean {
  const style = el.getAttribute('style') || ''
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) return true
  if (hasClassIn(el, boldClasses)) return true
  const tag = el.tagName.toLowerCase()
  return tag === 'b'
}

function isItalicStyle(el: HTMLElement): boolean {
  const style = el.getAttribute('style') || ''
  if (/font-style\s*:\s*italic/i.test(style)) return true
  if (hasClassIn(el, italicClasses)) return true
  const tag = el.tagName.toLowerCase()
  return tag === 'i'
}

/** สร้าง element ห่อ (strong/em) เปล่า ๆ แล้วใส่ child node ที่ clean ไว้แล้วเข้าไปตรง ๆ (ไม่ reparse เนื้อหา) */
function wrapNodes(tag: 'strong' | 'em', nodes: Node[]): HTMLElement {
  const shell = parse(`<${tag}></${tag}>`, PARSE_OPTIONS).childNodes[0] as HTMLElement
  shell.childNodes = nodes
  return shell
}

/** ทำความสะอาด element หนึ่งตัวแบบ bottom-up (mutate in place ผ่าน node-html-parser API) */
function cleanElement(el: HTMLElement): void {
  const tag = el.tagName.toLowerCase()

  // แท็กอันตราย — ตัดทิ้งทั้งก้อนก่อนเลย ไม่ลงไป clean ข้างในให้เสียเวลา (เนื้อหาจะถูกตัดทิ้งทั้งหมด)
  if (DROP_TAGS.has(tag)) {
    el.remove()
    return
  }

  for (const child of [...el.childNodes]) {
    if (child.nodeType === NodeType.ELEMENT_NODE) cleanElement(child as HTMLElement)
  }

  if (tag === 'a') {
    const href = sanitizeHref(unwrapGoogleRedirect(el.getAttribute('href') || ''))
    // ลิงก์ภายในเอกสาร Google Doc/Word (bookmark/heading) ใช้ไม่ได้บนเว็บ — เหลือแค่ข้อความ (คำไม่หาย)
    if (DOC_INTERNAL_ANCHOR_RE.test(href)) {
      const nodes: Node[] = [...el.childNodes]
      if (nodes.length > 0) el.replaceWith(...nodes)
      else el.remove()
      return
    }
    el.setAttributes(href ? { href } : {})
    return
  }
  if (tag === 'img') {
    const src = sanitizeImgSrc(el.getAttribute('src') || '')
    if (!src) {
      el.remove()
      return
    }
    const alt = el.getAttribute('alt') || ''
    el.setAttributes({ src, alt })
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

  // แท็กที่ไม่รู้จัก (span/font/div/section/u/sub/sup/...) → unwrap แต่รักษา bold/italic ที่มาจาก
  // inline style ไว้ (ไม่ลบ/ไม่เพิ่มคำ เปลี่ยนแค่โครงสร้าง tag ห่อ) — ย้าย child node ที่ clean แล้วจริง ๆ
  // ออกมาแทน el (ไม่ serialize เป็น string แล้ว reparse ซึ่งจะข้าม clean ของเนื้อหาข้างใน)
  const bold = isBoldStyle(el)
  const italic = isItalicStyle(el)
  let nodes: Node[] = [...el.childNodes]
  if (italic) nodes = [wrapNodes('em', nodes)]
  if (bold) nodes = [wrapNodes('strong', nodes)]
  if (nodes.length > 0) el.replaceWith(...nodes)
  else el.remove()
}

/**
 * ตัดคอมเมนต์ของ Google Docs ทิ้ง — ไม่แตะเชิงอรรถ (#ftnt)
 * - marker อินไลน์ในเนื้อหา: <a href="#cmnt1" id="cmnt_ref1">[a]</a> (href ขึ้นต้น #cmnt แต่ไม่ใช่ #cmnt_ref)
 *   ลบตัว <a> เอง — ถ้าถูกห่อด้วย <sup> ที่มีแค่ marker นี้ตัวเดียว ลบ <sup> ทั้งก้อนไปด้วย
 * - บล็อกเนื้อหาคอมเมนต์ท้ายเอกสาร: <div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a>ข้อความคอมเมนต์</p></div>
 *   หา <a href="#cmnt_ref..."> แล้วลบ <div>/<p> ที่ใกล้ที่สุดซึ่งห่อ anchor นี้อยู่ทิ้งทั้งก้อน
 */
function stripGoogleDocsComments(root: HTMLElement): void {
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href') || ''
    if (/^#cmnt(?!_ref)/.test(href)) {
      const parent = a.parentNode
      if (parent && parent.tagName?.toLowerCase() === 'sup' && parent.childNodes.length === 1) {
        parent.remove()
      } else {
        a.remove()
      }
    }
  }
  for (const a of root.querySelectorAll('a[href^="#cmnt_ref"]')) {
    const block = a.closest('div, p')
    if (block) block.remove()
    else a.remove()
  }
}

/**
 * ตัดคอมเมนต์ Google Docs ออกจาก HTML ที่ clean แล้ว — บทความที่นำเข้าก่อนมี stripGoogleDocsComments
 * ยังเก็บ marker [a]/[b] (href #cmnt) กับข้อความคอมเมนต์ไว้ในต้นฉบับ — ใช้ตอน Generate, บันทึกจาก editor และ push
 * (ด่านสุดท้าย) เพื่อไม่ให้หลุดออกไปบนเว็บลูกค้าไม่ว่าจะเข้ามาทางไหน
 */
export function stripGoogleDocsCommentsHtml(html: string): string {
  if (!html || !/href=["']?#cmnt/i.test(html)) return html
  // ใช้ blockTextElements ค่าตั้งต้น — <style>/<script> (CSS + schema) ของ HTML เต็มต้องคงเป็นข้อความดิบ
  const root = parse(html, { comment: true })
  stripGoogleDocsComments(root)
  return root.toString()
}

/** ครอบ text node เดี่ยว ๆ ที่หลุดอยู่ระดับบนสุด (ไม่มี <p> ห่อ) ให้เป็น <p> */
function wrapStrayTextAtRoot(root: HTMLElement): void {
  const next: (typeof root.childNodes) = []
  for (const child of root.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE && !(child as TextNode).isWhitespace) {
      const wrapped = parse(`<p>${(child as TextNode).rawText}</p>`, PARSE_OPTIONS)
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
  collectFormatClasses(String(rawHtml || ''))
  const stripped = String(rawHtml || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<o:p>[\s\S]*?<\/o:p>/gi, '')
    .replace(/<xml>[\s\S]*?<\/xml>/gi, '')

  const root = parse(stripped, { comment: false, ...PARSE_OPTIONS })
  stripGoogleDocsComments(root)
  for (const child of [...root.childNodes]) {
    if (child.nodeType === NodeType.ELEMENT_NODE) cleanElement(child as HTMLElement)
  }
  wrapStrayTextAtRoot(root)

  return mergeSplitInline(stripEmptyParagraphs(decodeTextEntities(root.innerHTML))).trim()
}

/** รวมตัวหนา/เอียงที่ Google Docs แตกเป็นหลายก้อนติดกัน และเอา <strong> ที่มีแต่ช่องว่างออก (ข้อความคงเดิมทุกตัวอักษร) */
function mergeSplitInline(html: string): string {
  let out = html
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/<(strong|em)>(\s*)<\/\1>/g, '$2')
      .replace(/<\/(strong|em)>(\s*)<\1>/g, '$2')
  }
  // หัวข้อทั้งบรรทัดที่ถูกห่อ <strong> (Google Docs ใส่ class ตัวหนาให้หัวข้อ) — หัวข้อหนาอยู่แล้ว ตัดตัวห่อออก
  out = out.replace(/<(h[1-6])>\s*<strong>((?:(?!<\/?strong>)[\s\S])*)<\/strong>\s*<\/\1>/g, '<$1>$2</$1>')
  return out
}
