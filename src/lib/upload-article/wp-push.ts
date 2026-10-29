// ─── Upload Article — push บทความขึ้น WordPress ─────────────────────────────
// คัดลอก/ปรับจากตรรกะใน src/app/api/push/publish/route.ts (ห้ามแก้ไฟล์เดิม)
// เป็น pure function ล้วน — ไม่แตะ prisma/session, รับ credentials ตรงจากผู้เรียก

import { safeFetch, safeFetchHtml } from './safe-fetch'
import { syncSeoPluginMeta } from './seo-plugins'
import { flattenEmbeddedNewlines } from '@/lib/articleComponents'
import { findOrUploadWpMedia, replaceInlineDataImages } from '@/lib/wp-media'
import { SITE_TOC_ID_TOKEN } from './types'

export interface WpPushInput {
  wpUrl: string
  wpUser: string
  wpPass: string
  title: string
  html: string
  slug?: string
  metaTitle?: string
  metaDescription?: string
  focusKeyword?: string
  coverBase64?: string // base64 ล้วน (ไม่มี data: prefix)
  coverMimeType?: string
  coverAlt?: string
  publishMode: 'draft' | 'publish'
  /** วัน-เวลาเผยแพร่ (ISO UTC) — ส่งเป็น date_gmt และขึ้นเป็น Draft เสมอ (ทีมกด Publish เองใน WordPress) */
  publishAt?: string
  useElementor?: boolean
  wpPostType?: 'post' | 'page'
  /** post/page ที่เคย push ไว้แล้ว — re-push ต้องอัพเดตตัวนี้ ไม่ใช่สร้างใหม่ */
  existingPostId?: number
  /** ปลั๊กอิน SEO จากผลสแกนเว็บ — ใช้เมื่ออ่าน /wp-json/ ไม่ได้ */
  seoPlugins?: string[]
  /** สารบัญของเว็บ (ผลสแกน) — push แบบ Elementor วางแทนสารบัญของเรา */
  siteToc?: SiteTocWidget | null
  /** ตำแหน่งสารบัญ (toc-position.ts) — ใช้เมื่อบทความไม่มีสารบัญของเรา ไม่ส่ง = จุดเดิม */
  tocPosition?: number
}

export interface WpPushResult {
  ok: boolean
  postUrl?: string
  postId?: number
  slug?: string
  status?: string
  error?: string
  /** push สำเร็จ แต่ตรวจซ้ำแล้วหน้าเว็บอาจยังไม่แสดงเวอร์ชันนี้ */
  warning?: string
}

export function normalizeWpUrl(raw: string): string {
  return raw.trim().replace(/\/(wp-admin|wp-login\.php)(\/.*)?$/, '').replace(/\/$/, '')
}

/** ปรับ URL ตอนบันทึก: บังคับ https:// (Application Password ใช้ได้เฉพาะ https) แล้วตัด /wp-admin, /wp-login.php, / ท้าย */
export function normalizeSavedWpUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  return normalizeWpUrl(/^https?:\/\//i.test(t) ? t.replace(/^http:\/\//i, 'https://') : `https://${t}`)
}

/** id แบบที่ Elementor ใช้ (hex 7 ตัว) */
const elementorId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0')

type HtmlNode =
  | { kind: 'el'; tag: string; attrs: string; html: string; inner: string }
  | { kind: 'text' | 'comment'; html: string }

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

/** ตำแหน่ง '>' ที่ปิด tag (ข้าม '>' ในค่า attribute ที่มีเครื่องหมายคำพูด) | -1 = ไม่ปิด */
function tagEnd(s: string, from: number): number {
  let quote = ''
  for (let j = from; j < s.length; j++) {
    const c = s[j]
    if (quote) { if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return j
  }
  return -1
}

/**
 * แยก HTML เป็นโหนดชั้นบนสุด (ไม่ลงลึก) — null = โครงสร้างไม่ชัด (tag ไม่ปิด / tag ปิดลอย ๆ) ให้ผู้เรียกถอยไปแบบเดิม
 * ข้ามเนื้อหาใน script/style/comment ไม่นับ tag ข้างใน
 */
function topLevelNodes(s: string): HtmlNode[] | null {
  const nodes: HtmlNode[] = []
  let i = 0
  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      if (end < 0) return null
      nodes.push({ kind: 'comment', html: s.slice(i, end + 3) })
      i = end + 3
      continue
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(s.slice(i, i + 64))
    if (!open) {
      if (s[i] === '<' && s[i + 1] === '/') return null
      const next = s.indexOf('<', i + 1)
      const end = next < 0 ? s.length : next
      nodes.push({ kind: 'text', html: s.slice(i, end) })
      i = end
      continue
    }
    const tag = open[1].toLowerCase()
    const startEnd = tagEnd(s, i)
    if (startEnd < 0) return null
    const attrs = s.slice(i + 1 + open[1].length, startEnd).replace(/\/\s*$/, '')
    if (VOID_TAGS.has(tag) || s[startEnd - 1] === '/') {
      nodes.push({ kind: 'el', tag, attrs, html: s.slice(i, startEnd + 1), inner: '' })
      i = startEnd + 1
      continue
    }
    // เดินหา tag ปิดคู่กัน — นับซ้อนทุก tag, tag ปิดที่ข้ามชั้น (ลืมปิด <p>/<li>) ปิดตัวในให้ไปด้วย
    const stack = [tag]
    let j = startEnd + 1
    let closeStart = -1
    while (j < s.length && stack.length) {
      const lt = s.indexOf('<', j)
      if (lt < 0) return null
      if (s.startsWith('<!--', lt)) {
        const end = s.indexOf('-->', lt + 4)
        if (end < 0) return null
        j = end + 3
        continue
      }
      const close = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(s.slice(lt, lt + 64))
      if (close) {
        const name = close[1].toLowerCase()
        const at = stack.lastIndexOf(name)
        if (at >= 0) {
          stack.length = at
          if (!stack.length) closeStart = lt
        }
        j = lt + close[0].length
        continue
      }
      const inner = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(s.slice(lt, lt + 64))
      if (!inner) { j = lt + 1; continue }
      const name = inner[1].toLowerCase()
      const end = tagEnd(s, lt)
      if (end < 0) return null
      j = end + 1
      if (VOID_TAGS.has(name) || s[end - 1] === '/') continue
      if (RAW_TEXT_TAGS.has(name)) {
        const rawClose = s.toLowerCase().indexOf(`</${name}`, j)
        if (rawClose < 0) return null
        j = rawClose
        continue
      }
      stack.push(name)
    }
    if (closeStart < 0) return null
    const closeEnd = s.indexOf('>', closeStart) + 1
    nodes.push({ kind: 'el', tag, attrs, html: s.slice(i, closeEnd), inner: s.slice(startEnd + 1, closeStart) })
    i = closeEnd
  }
  return nodes
}

const classOf = (attrs: string): string[] => {
  const m = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs)
  return (m ? (m[1] ?? m[2] ?? m[3] ?? '') : '').split(/\s+/).filter(Boolean)
}

// tag ที่ Text Editor (TinyMCE) แก้แล้วเพี้ยน/ถูกตัด — มีอยู่ข้างในเมื่อไหร่ต้องเป็น HTML widget
const NOT_TEXT_SAFE = /<(details|summary|script|style|iframe|form|input|button|svg|video|audio|noscript|object|embed|select|textarea|canvas|pre|template|math|nav|aside|section)\b|\son[a-z]+\s*=/i
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'figure', 'table', 'hr'])
// inline ที่หลุดมาอยู่ชั้นบน (แก้ในหน้า Review แล้วพิมพ์นอกย่อหน้า) — Text Editor ครอบ <p> ให้เอง
const INLINE_TAGS = new Set(['a', 'strong', 'b', 'em', 'i', 'u', 'span', 'br', 'img', 'sub', 'sup', 'mark', 'small', 'code'])
// content-faq__item = FAQ แบบเปิดตลอด (div + h3 + คำตอบ) — ไม่มี details จึงแก้เป็นข้อความได้
const TEXT_DIV_CLASSES = ['content-takeaways', 'content-table-wrap', 'content-highlight', 'content-notice', 'content-quote', 'content-figure', 'content-faq__item']

/** บล็อกนี้แก้เป็นข้อความใน Text Editor ได้โดยไม่เพี้ยน */
function isTextSafe(node: HtmlNode): boolean {
  if (node.kind === 'text') return true
  if (node.kind !== 'el') return false
  if (NOT_TEXT_SAFE.test(node.html)) return false
  if (TEXT_TAGS.has(node.tag) || INLINE_TAGS.has(node.tag)) return true
  return node.tag === 'div' && classOf(node.attrs).some((c) => TEXT_DIV_CLASSES.includes(c))
}

/** div ที่มีแต่ class (ไม่มี id/style/data-*) — ย้าย class ไปไว้ที่ section ได้ */
function isClassOnlyDiv(node: HtmlNode): node is Extract<HtmlNode, { kind: 'el' }> {
  if (node.kind !== 'el' || node.tag !== 'div' || !classOf(node.attrs).length) return false
  return !node.attrs.replace(/(?:^|\s)class\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i, '').trim()
}

/**
 * CSS ที่ทำให้ widget ของ Elementor ไม่ไปเปลี่ยนหน้าตาบทความ — ผูกกับ .mars-article ของ section นี้เท่านั้น
 * - widget-wrap ของ Elementor เป็น flex → margin ระหว่างบล็อกไม่ยุบรวมกัน ช่องไฟจะห่างกว่าปกติ → block
 * - ช่องไฟระหว่าง widget (20px) → 0
 * - สี/ฟอนต์ global ของ Text Editor → สืบทอดจาก .content-article เหมือน post_content
 *   ไม่ใส่ !important — ทีมยังตั้งสี/ฟอนต์ราย widget ในแท็บ Style ได้
 */
const ELEMENTOR_RESET_CSS =
  '.mars-article{--kit-widget-spacing:0px;--widgets-spacing:0px;--widgets-spacing-row:0px;--widgets-spacing-column:0px}' +
  '.mars-article .elementor-widget-wrap{display:block!important}' +
  '.mars-article .elementor-widget,.mars-article .elementor-widget:not(:last-child){margin-bottom:0!important;margin-block-end:0!important}' +
  '.mars-article .elementor-widget-container{margin:0;padding:0}' +
  '.mars-article .elementor-widget-text-editor,.mars-article .elementor-widget-html{color:inherit;font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;letter-spacing:inherit}'

type ElementorWidget = {
  id: string
  elType: 'widget'
  widgetType: 'html' | 'text-editor' | 'table-of-contents'
  settings: Record<string, unknown>
  elements: []
}

/** widget สารบัญของเว็บ (จากผลสแกน) — settings ของ Elementor + CSS ที่ id แทนด้วย SITE_TOC_ID_TOKEN */
export interface SiteTocWidget {
  settings: Record<string, unknown>
  css?: string
}
// รีเซ็ตด้านบนตัดระยะห่างของ widget ทิ้ง — สารบัญต้องเว้นระยะจากย่อหน้าก่อน/หลัง
const SITE_TOC_SPACING_CSS =
  '.mars-article .elementor-widget.elementor-widget-table-of-contents,.mars-article .elementor-widget.elementor-widget-table-of-contents:not(:last-child)' +
  '{margin:1.6em 0!important;margin-block:1.6em!important}'

/**
 * จุดวางสารบัญของเว็บ: แทน nav.content-toc ของเรา ตรงตำแหน่งเดิม
 * บทความไม่มีสารบัญของเรา (โหมดข้อความ) → จุดเดียวกับที่ build-html วาง: หลัง H1 → หลังรูปปก → หลังย่อหน้าแรก (ไม่เลย H2 แรก)
 * ส่ง tocPosition (≥ 0) มา = ก่อน H2 ตัวที่ tocPosition+1 แบบเดียวกับ build-html (เกินจำนวนหัวข้อ = ท้ายบทความ)
 * H2 ไม่ถึง 3 = ไม่วาง (เกณฑ์เดียวกับสารบัญของเรา) · คืน -1 = ไม่วาง
 */
function siteTocSlot(children: HtmlNode[], isHead: (n: HtmlNode) => boolean, tocPosition?: number): { at: number; replace: boolean } {
  const isEl = (n: HtmlNode | undefined, tag: string) => !!n && n.kind === 'el' && n.tag === tag
  const nav = children.findIndex((n) => isEl(n, 'nav') && n.kind === 'el' && classOf(n.attrs).includes('content-toc'))
  if (nav >= 0) return { at: nav, replace: true }
  if (children.filter((n) => isEl(n, 'h2')).length < 3) return { at: -1, replace: false }
  if (tocPosition !== undefined && tocPosition >= 0) {
    let seen = 0
    for (let k = 0; k < children.length; k++) {
      if (!isEl(children[k], 'h2')) continue
      if (seen === tocPosition) return { at: k, replace: false }
      seen++
    }
    return { at: children.length, replace: false }
  }
  const content = (n: HtmlNode) => !(n.kind === 'text' && !n.html.trim()) && !isHead(n)
  let i = -1
  const next = () => {
    i++
    while (i < children.length && !content(children[i])) i++
  }
  next()
  if (isEl(children[i], 'h1')) next()
  if (isEl(children[i], 'figure')) next()
  if (isEl(children[i], 'p')) i++
  return { at: i, replace: false }
}

/**
 * แยกบทความเป็น widget ให้ทีมแก้ใน Elementor ได้ทั้งแบบข้อความ (Text Editor) และ HTML
 * - script/style/link/comment ชั้นบน (ทุกตำแหน่ง) → widget แรก (markerId) = HTML widget ถือ schema + style บทความ
 *   + CSS กันหน้าตาเพี้ยน — ใช้ id นี้ตรวจหน้าเว็บ
 * - ตัวครอบเนื้อหา = <div class="..."> ตัวเดียว หรือ div.content-article (มีของหลุดนอกตัวครอบได้ เช่นพิมพ์เพิ่มในหน้า Review)
 *   class ของตัวครอบย้ายไปที่ section → CSS แบบ .content-article p ยังจับได้เหมือนเดิม
 *   ไม่มีตัวครอบ (บทความ SME รุ่นเก่า/โหมด clean) → แยกโหนดชั้นบนตรง ๆ
 * - บล็อกข้อความ (p/h2/h3/ul/ol/table/figure/กล่องสรุป/FAQ แบบเปิด) → Text Editor ตัดใหม่ทุก <h2>
 * - บล็อกซับซ้อน (FAQ details/summary, CTA, ผู้เขียน, สารบัญ) ที่ติดกัน → HTML widget เดียว
 * null = HTML ไม่ปิด tag หรือไม่มีส่วนไหนแก้เป็นข้อความได้ → ใช้ HTML widget ก้อนเดียวแบบเดิม
 */
function splitArticleWidgets(
  html: string,
  markerId: string,
  siteToc?: SiteTocWidget | null,
  tocPosition?: number,
): { sectionClasses: string; widgets: ElementorWidget[] } | null {
  const top = topLevelNodes(html)
  if (!top) return null
  const blank = (n: HtmlNode) => n.kind === 'text' && !n.html.trim()
  const isHead = (n: HtmlNode) => n.kind === 'comment' || (n.kind === 'el' && (n.tag === 'script' || n.tag === 'style' || n.tag === 'link'))
  const first = top.findIndex((n) => !blank(n) && !isHead(n))
  if (first < 0) return null
  let last = top.length - 1
  while (blank(top[last]) || isHead(top[last])) last--
  // head ก่อน/หลังเนื้อหา → widget แรก/ท้าย (เหมือนเดิม) — style/script ที่แทรกกลางเนื้อหาอยู่ตำแหน่งเดิมเป็น HTML widget
  const lead = top.slice(0, first).filter((n) => !blank(n))
  const tailNodes = top.slice(last + 1).filter((n) => !blank(n))
  const body = top.slice(first, last + 1).filter((n) => !blank(n))
  const isArticleDiv = (n: HtmlNode) => isClassOnlyDiv(n) && classOf(n.attrs).includes('content-article')
  const wrapper = body.length === 1 && isClassOnlyDiv(body[0])
    ? body[0]
    : body.filter(isArticleDiv).length === 1 ? body.find(isArticleDiv) : undefined
  let classes = ['mars-article']
  let children = body
  if (wrapper && wrapper.kind === 'el') {
    const inner = topLevelNodes(wrapper.inner)
    if (!inner) return null
    classes = [...classOf(wrapper.attrs), 'mars-article']
    children = body.flatMap((n) => (n === wrapper ? inner : [n]))
  }

  // สารบัญของเว็บ (ผลสแกน) แทนของเรา — ไม่มีผลสแกน = เหมือนเดิมทุกไบต์
  const slot = siteToc ? siteTocSlot(children, isHead, tocPosition) : { at: -1, replace: false }
  const tocId = slot.at >= 0 ? elementorId() : ''
  const tocCss = tocId && siteToc ? `${(siteToc.css || '').split(SITE_TOC_ID_TOKEN).join(tocId)}${SITE_TOC_SPACING_CSS}` : ''

  const widgets: ElementorWidget[] = []
  const headHtml = lead.map((n) => n.html).join('\n')
  widgets.push({ id: markerId, elType: 'widget', widgetType: 'html', settings: { html: `${headHtml}${headHtml ? '\n' : ''}<style>${ELEMENTOR_RESET_CSS}${tocCss}</style>` }, elements: [] })

  let group: { type: 'text' | 'html'; parts: string[] } | null = null
  const flush = () => {
    if (!group?.parts.length) { group = null; return }
    const joined = group.parts.join(group.type === 'text' ? '' : '\n')
    widgets.push(group.type === 'text'
      // Text Editor เปิดแก้แล้ว wpautop แปลงขึ้นบรรทัดเป็น <br>/<p> — บีบเหลือเว้นวรรค (หน้าเว็บแสดงเหมือนกัน)
      ? { id: elementorId(), elType: 'widget', widgetType: 'text-editor', settings: { editor: joined.replace(/\s*\n\s*/g, ' ') }, elements: [] }
      : { id: elementorId(), elType: 'widget', widgetType: 'html', settings: { html: joined }, elements: [] })
    group = null
  }
  children.forEach((node, i) => {
    if (i === slot.at && siteToc) {
      flush()
      widgets.push({ id: tocId, elType: 'widget', widgetType: 'table-of-contents', settings: { ...siteToc.settings }, elements: [] })
      if (slot.replace) return
    }
    if (blank(node)) return
    const type = isTextSafe(node) ? 'text' : 'html'
    const startsSection = node.kind === 'el' && node.tag === 'h2'
    if (!group || group.type !== type || (type === 'text' && startsSection)) {
      flush()
      group = { type, parts: [] }
    }
    group.parts.push(node.html)
  })
  flush()
  // ตำแหน่งท้ายบทความ (เกินจำนวนหัวข้อ)
  if (slot.at >= children.length && siteToc) widgets.push({ id: tocId, elType: 'widget', widgetType: 'table-of-contents', settings: { ...siteToc.settings }, elements: [] })
  const tail = tailNodes.map((n) => n.html).join('\n')
  if (tail) widgets.push({ id: elementorId(), elType: 'widget', widgetType: 'html', settings: { html: tail }, elements: [] })
  // ไม่มีบล็อกเนื้อหาเลย = ไม่มีอะไรให้แก้แยก
  if (widgets.length < 2) return null
  // ไม่มีตัวครอบ + ไม่มี Text Editor = แยกไปก็แก้เป็นข้อความไม่ได้ — คง HTML ก้อนเดียวแบบเดิม
  if (!wrapper && !widgets.some((w) => w.widgetType === 'text-editor')) return null
  return { sectionClasses: classes.join(' '), widgets }
}

/**
 * เอกสาร Elementor = 1 section → 1 column → widget ชุดเดียวกับ post_content
 * แยกเป็น Text Editor + HTML widget ตาม splitArticleWidgets (ทีมกดแก้แบบข้อความได้)
 * โครงไม่ตรง = HTML widget ก้อนเดียวถือ HTML ทั้งหมด
 * section เต็มความกว้าง + คอลัมน์ไม่มีช่องไฟ (gap no) → หน้าเว็บออกมาเหมือนตอนไม่ใช้ Elementor
 * widgetId = id ของ widget แรก ใช้ตรวจว่าหน้าเว็บแสดงเอกสารชุดนี้จริง
 */
export function buildElementorData(html: string, widgetId: string = elementorId(), opts: { siteToc?: SiteTocWidget | null; tocPosition?: number } = {}): string {
  const split = splitArticleWidgets(html, widgetId, opts.siteToc, opts.tocPosition)
  const data = [{
    id: elementorId(), elType: 'section',
    settings: {
      layout: 'full_width', gap: 'no', content_width: { unit: '%', size: 100 },
      ...(split ? { css_classes: split.sectionClasses } : {}),
    },
    elements: [{
      id: elementorId(), elType: 'column',
      settings: { _column_size: 100, _inline_size: null },
      elements: split?.widgets ?? [{
        id: widgetId, elType: 'widget', widgetType: 'html',
        settings: { html },
        elements: [],
      }],
    }],
  }]
  return JSON.stringify(data)
}

type WpFetcher = (url: string, init: RequestInit) => Promise<Response>
/** ดึง HTML หน้าเว็บจริงแบบไม่ล็อกอิน — null = ดึงไม่ได้ (บล็อก/timeout/ไม่ใช่ 200) */
type PageFetcher = (url: string) => Promise<string | null>

export const ELEMENTOR_STUCK_WARNING =
  'โพสต์นี้ถูกเปิดแก้ด้วย Elementor — หน้าเว็บอาจยังแสดงเวอร์ชันเก่าจาก Elementor และระบบสลับกลับให้ไม่ได้ ' +
  'ให้กด "กลับไปใช้ตัวแก้ไข WordPress" ในหน้าแก้โพสต์ แล้ว push ใหม่'
export const ELEMENTOR_WRITE_WARNING =
  'เขียนข้อมูล Elementor ไม่สำเร็จ — หน้าเว็บแสดงเวอร์ชันใหม่แล้ว แต่กด "Edit with Elementor" จะเจอเวอร์ชันเก่า'
export const ELEMENTOR_NOT_APPLIED_WARNING =
  'ติ๊ก Elementor ไว้ แต่เว็บไม่ยอมให้เขียนเอกสาร Elementor — หน้าเว็บแสดงเวอร์ชันใหม่แบบปกติ (ไม่ผ่าน Elementor)'
export const ELEMENTOR_STALE_WARNING =
  'ติ๊ก Elementor ไว้ แต่ยืนยันไม่ได้ว่าหน้าเว็บแสดงเอกสาร Elementor ชุดใหม่ (ล้าง cache ของ Elementor ไม่ได้) — ' +
  'ระบบสลับกลับให้หน้าเว็บแสดงเวอร์ชันใหม่แบบปกติแทน ถ้าต้องการเอกสาร Elementor ให้กด Elementor → Tools → Regenerate CSS & Data แล้ว push ใหม่'
export const ELEMENTOR_PLUGIN_STALE_WARNING =
  'เขียนเอกสาร Elementor ผ่านปลั๊กอิน convert-cake แล้ว แต่ยืนยันไม่ได้ว่าหน้าเว็บแสดงชุดใหม่ (ล้าง cache ของ Elementor ไม่ได้) — ' +
  'ให้กด Elementor → Tools → Regenerate CSS & Data แล้วเปิดหน้าเว็บดู'
export const ELEMENTOR_UNSUPPORTED_WARNING =
  'ติ๊ก Elementor ไว้ แต่เว็บนี้ไม่เปิดให้เขียน Elementor ผ่าน REST และไม่มีปลั๊กอิน convert-cake — หน้าเว็บแสดงเวอร์ชันใหม่แบบปกติ (ไม่ผ่าน Elementor)'

export interface ElementorSyncOptions {
  wpUrl: string
  creds: string
  postId: number
  isPage: boolean
  useElementor: boolean
  html: string
  fetcher: WpFetcher
  /** โพสต์เดิม (re-push) — Elementor อาจมี cache ของหน้านี้ค้างอยู่ */
  isUpdate?: boolean
  /** ลิงก์หน้าเว็บ เมื่อโพสต์ publish แล้ว — ใช้ตรวจว่าหน้าเว็บแสดงเวอร์ชันนี้จริง */
  liveUrl?: string
  pageFetcher?: PageFetcher
  /** สารบัญของเว็บ — ใช้เฉพาะตอนเลือก Elementor (โหมดปกติคงสารบัญของเราใน post_content) */
  siteToc?: SiteTocWidget | null
  tocPosition?: number
}

/** คำขอ REST ของ Elementor สำหรับโพสต์เดียว — ใช้ทั้งทาง REST และหลังเรียกปลั๊กอิน convert-cake */
function elementorRest(opts: ElementorSyncOptions) {
  const { creds, postId, isPage, fetcher } = opts
  const postEndpoint = `${opts.wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${postId}`
  const auth = { Authorization: `Basic ${creds}` }

  const readMeta = async (): Promise<Record<string, unknown> | null> => {
    const res = await fetcher(`${postEndpoint}?context=edit&_fields=meta`, {
      headers: auth,
      signal: AbortSignal.timeout(15000),
    }).catch(() => null)
    if (!res?.ok) return null
    const data = await res.json().catch(() => null)
    return data?.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : null
  }
  const update = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetcher(postEndpoint, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null)
    return !!res?.ok
  }
  // ล้าง cache ของ Elementor ทั้งเว็บ (เท่ากับปุ่ม Regenerate CSS & Data) — ต้องเป็นสิทธิ์ admin
  const clearCache = async (): Promise<boolean> => {
    const res = await fetcher(`${opts.wpUrl}/wp-json/elementor/v1/cache`, {
      method: 'DELETE',
      headers: auth,
      signal: AbortSignal.timeout(30000),
    }).catch(() => null)
    return !!res?.ok
  }
  // Elementor ใส่ data-id และ class elementor-element-<id> ให้ทุก element — id ของ widget ชุดนี้ใหม่ทุก push
  // ดูเฉพาะใน attribute class (ไม่นับ selector ใน <style> ที่ Elementor สร้างแยกจาก cache ของ HTML)
  // query string กัน page cache (WP Rocket ไม่ cache URL ที่มี query, Cloudflare แยก key ตาม query)
  const liveShowsWidget = async (widgetId: string): Promise<boolean | null> => {
    if (!opts.liveUrl || !opts.pageFetcher) return null
    const url = `${opts.liveUrl}${opts.liveUrl.includes('?') ? '&' : '?'}mars_v=${widgetId}`
    const page = await opts.pageFetcher(url).catch(() => null)
    if (page == null) return null
    return page.includes(`data-id="${widgetId}"`) || new RegExp(`class="[^"]*\\belementor-element-${widgetId}\\b`).test(page)
  }
  /**
   * หลังเปิด builder ด้วย widget ชุดนี้: หน้าเว็บแสดงชุดนี้จริงไหม
   * ok = แสดงแล้ว / ยังไม่ publish ของโพสต์ใหม่ (ไม่มี cache) / ล้าง cache แล้ว
   * stale = ยังเป็นของเก่า หรือ re-push ที่ตรวจหน้าเว็บไม่ได้และล้าง cache ไม่ได้
   */
  const verifyLive = async (widgetId: string): Promise<'ok' | 'stale'> => {
    const live = await liveShowsWidget(widgetId)
    if (live === true) return 'ok'
    if (live === null) {
      if (!opts.isUpdate) return 'ok'
      if (await clearCache()) {
        await update({})
        return 'ok'
      }
      return 'stale'
    }
    if (!(await clearCache())) return 'stale'
    await update({})
    return (await liveShowsWidget(widgetId)) === false ? 'stale' : 'ok'
  }
  // ออกจากโหมด builder → หน้าเว็บแสดง post_content (ที่เพิ่ง push) | false = ยังติด builder หรืออ่านสถานะไม่ได้
  const exitBuilder = async (): Promise<boolean> => {
    await update({ meta: { _elementor_edit_mode: '' } })
    // meta ถูกเขียนหลัง save_post — แตะโพสต์อีกรอบให้ปลั๊กอิน cache (WP Rocket) ล้างหน้าเว็บตามสถานะใหม่
    await update({})
    const after = await readMeta()
    return after != null && after._elementor_edit_mode !== 'builder'
  }
  return { readMeta, update, clearCache, verifyLive, exitBuilder }
}

/**
 * จัดโหมด Elementor ของโพสต์ให้ตรงกับที่ติ๊ก และให้หน้าเว็บแสดงเนื้อหาที่เพิ่ง push จริง
 * Elementor เปิด meta พวกนี้ให้เขียนผ่าน REST (context=edit) ได้เอง ไม่ต้องมีปลั๊กอิน convert-cake
 * - ไม่ใช้ Elementor: โพสต์ที่ถูกเปิดใน Elementor ไปแล้ว → ออกจากโหมด builder (หน้าเว็บแสดง post_content)
 * - ใช้ Elementor: เขียน HTML widget ชุดใหม่ + โหมด builder → เป็นเอกสาร Elementor จริง ทีมแก้ต่อใน Elementor ได้
 *   Elementor แสดงผลจาก cache ของตัวเอง ซึ่งการเขียน meta ผ่าน REST ไม่ล้าง (mfactors 5248 2026-10-26)
 *   จึงเปิดหน้าเว็บจริงดูว่ามี widget ชุดนี้ไหม — ไม่มี = ล้าง cache ของ Elementor แล้วดูซ้ำ
 *   ยังไม่มีอีก = กลับไปโหมดปกติ หน้าเว็บต้องเป็นเวอร์ชันใหม่เสมอ ห้ามค้างของเก่า
 * supported = false → เว็บไม่เปิด meta ของ Elementor ผ่าน REST (ไม่มี Elementor / รุ่นเก่า / อ่านไม่ได้)
 * builder = true → จบที่เอกสาร Elementor
 */
export async function syncElementorDocument(opts: ElementorSyncOptions): Promise<{ supported: boolean; builder?: boolean; warning?: string }> {
  const { isPage, useElementor, html } = opts
  const { readMeta, update, verifyLive, exitBuilder } = elementorRest(opts)
  const dataHas = (meta: Record<string, unknown> | null, widgetId: string) =>
    JSON.stringify(meta?._elementor_data ?? '').includes(widgetId)
  const templateType = isPage ? 'wp-page' : 'wp-post'

  const before = await readMeta()
  if (!before || !('_elementor_edit_mode' in before)) return { supported: false }
  const wasBuilder = before._elementor_edit_mode === 'builder'

  if (!useElementor) {
    // โพสต์ที่ไม่เคยเปิดใน Elementor และไม่ได้เลือก Elementor = ไม่ต้องแตะ
    if (!wasBuilder) return { supported: true }
    // _elementor_data เขียนเป็น HTML widget ชุดเดียวกัน — กด "Edit with Elementor" แล้วได้เวอร์ชันนี้
    // ไม่ใช่ Text Editor ที่ Elementor แปลงจาก content เอง (TinyMCE ตัด <summary> + ใส่ <br> ใน <style>)
    const widgetId = elementorId()
    // แยกคำขอ — data ใหญ่ถูกปฏิเสธก็ไม่ลากการออกจาก builder (ตัวที่ทำให้หน้าเว็บถูก) ล้มไปด้วย
    await update({ meta: { _elementor_edit_mode: '' } })
    await update({ meta: { _elementor_template_type: templateType, _elementor_data: buildElementorData(html, widgetId) } })
    await update({})
    const after = await readMeta()
    // อ่านสถานะไม่ได้ = ไม่รู้ว่าออกจาก builder แล้วหรือยัง → เตือนให้ตรวจเอง
    if (!after || after._elementor_edit_mode === 'builder') return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
    return dataHas(after, widgetId) ? { supported: true } : { supported: true, warning: ELEMENTOR_WRITE_WARNING }
  }

  // ── ใช้ Elementor ──
  const widgetId = elementorId()
  // data ก่อน แล้วค่อยเปิด builder — เปิด builder ทั้งที่ data ไม่เข้า = หน้าเว็บแสดงของเก่า/หน้าว่าง
  await update({ meta: { _elementor_template_type: templateType, _elementor_data: buildElementorData(html, widgetId, { siteToc: opts.siteToc, tocPosition: opts.tocPosition }) } })
  if (!dataHas(await readMeta(), widgetId)) {
    if (wasBuilder && !(await exitBuilder())) return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
    return { supported: true, builder: false, warning: ELEMENTOR_NOT_APPLIED_WARNING }
  }
  if (!wasBuilder) await update({ meta: { _elementor_edit_mode: 'builder' } })
  await update({})
  const after = await readMeta()
  // อ่านสถานะไม่ได้ = อาจเปิด builder ไปแล้ว → ถอยกลับให้แน่ใจ ไม่ปล่อยค้างโดยไม่ได้ตรวจหน้าเว็บ
  if (!after) {
    if (!(await exitBuilder())) return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
    return { supported: true, builder: false, warning: ELEMENTOR_NOT_APPLIED_WARNING }
  }
  if (after._elementor_edit_mode !== 'builder') {
    // เปิด builder ไม่ได้ — หน้าเว็บยังแสดง post_content ชุดใหม่ ไม่พัง
    return { supported: true, builder: false, warning: ELEMENTOR_NOT_APPLIED_WARNING }
  }

  if ((await verifyLive(widgetId)) === 'ok') return { supported: true, builder: true }
  // หน้าเว็บยังเป็นของเก่า (cache ของ Elementor) หรือยืนยันไม่ได้ → กลับโหมดปกติ
  if (!(await exitBuilder())) return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
  return { supported: true, builder: false, warning: ELEMENTOR_STALE_WARNING }
}

/** หน้าเว็บจริงผ่าน SSRF guard (ไม่ส่งรหัสผ่าน) */
const fetchLivePage: PageFetcher = async (url) => {
  const r = await safeFetchHtml(url)
  return r.ok ? r.html : null
}

/**
 * หลังบันทึกโพสต์: จัดโหมด Elementor ตามที่ติ๊ก — ใช้ร่วมกันทั้ง Upload Article และ SEO/SME push
 * REST ก่อน — เว็บที่ไม่เปิด meta ของ Elementor ผ่าน REST หรือไม่ยอมให้เขียนผ่าน REST ค่อยใช้ปลั๊กอิน convert-cake
 * คืนคำเตือน (ถ้ามี) — push สำเร็จเสมอ เพราะ post_content ใส่เนื้อหาจริงไปตั้งแต่คำขอแรก
 */
export async function applyElementorMode(
  opts: Omit<ElementorSyncOptions, 'pageFetcher'> & { yoastMeta: Record<string, string>; pageFetcher?: PageFetcher },
): Promise<string | undefined> {
  const full: ElementorSyncOptions = { ...opts, pageFetcher: opts.pageFetcher ?? fetchLivePage }
  const sync = await syncElementorDocument(full)
  if (!opts.useElementor) return sync.warning
  // จบทาง REST: เป็นเอกสาร Elementor แล้ว / ถอยกลับเพราะ cache ค้าง (ปลั๊กอินเปิด builder ซ้ำก็เจอ cache เดิม)
  if (sync.supported && (sync.builder || sync.warning === ELEMENTOR_STALE_WARNING)) return sync.warning
  // เหลือ: REST ไม่มี / REST ไม่ยอมเขียน data หรือ builder / ค้าง builder — ปลั๊กอินเขียน data แบบ base64 + เปิด builder
  const widgetId = elementorId()
  const ccRes = await opts.fetcher(`${opts.wpUrl}/wp-json/convert-cake/v1/elementor-meta`, {
    method: 'POST',
    headers: { Authorization: `Basic ${opts.creds}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_id: opts.postId,
      elementor_data_b64: Buffer.from(buildElementorData(opts.html, widgetId, { siteToc: opts.siteToc, tocPosition: opts.tocPosition })).toString('base64'),
      edit_mode: 'builder',
      template_type: opts.isPage ? 'wp-page' : 'wp-post',
      yoast_meta: opts.yoastMeta,
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null)
  if (!ccRes?.ok) return sync.supported ? sync.warning : ELEMENTOR_UNSUPPORTED_WARNING
  // ปลั๊กอินเปิด builder ด้วย widget ชุดนี้แล้ว — ตรวจหน้าเว็บเหมือนทาง REST
  const rest = elementorRest(full)
  if ((await rest.verifyLive(widgetId)) === 'ok') return undefined
  if (!sync.supported) return ELEMENTOR_PLUGIN_STALE_WARNING
  return (await rest.exitBuilder()) ? ELEMENTOR_STALE_WARNING : ELEMENTOR_STUCK_WARNING
}

async function uploadMedia(
  wpUrl: string, creds: string, imageBase64: string, mimeType: string, title: string, altText: string,
): Promise<{ id: number; url: string } | null> {
  const r = await findOrUploadWpMedia({
    wpUrl, creds, base64: imageBase64, mime: mimeType, title, alt: altText,
    fetchFn: (u, i) => safeFetch(u, i, { requireHttps: true, sameHostOnly: true }),
  })
  return r ? { id: r.id, url: r.url } : null
}

/** push บทความหนึ่งชิ้นขึ้น WordPress (สร้างใหม่ หรืออัพเดตถ้ามี slug ชนกัน) */
export async function pushArticleToWordPress(input: WpPushInput): Promise<WpPushResult> {
  const wpUrl = normalizeWpUrl(input.wpUrl)
  const wpUser = input.wpUser.trim()
  const wpPass = input.wpPass
  if (!wpUrl || !wpUser || !wpPass) {
    return { ok: false, error: 'ไม่พบ WordPress credentials' }
  }
  if (!input.html || !input.title) {
    return { ok: false, error: 'html และ title จำเป็น' }
  }

  const creds = Buffer.from(`${wpUser}:${wpPass.replace(/\s+/g, '')}`).toString('base64')
  const isPage = input.wpPostType === 'page'
  const finalMetaTitle = input.metaTitle || input.title
  const finalMetaDesc = input.metaDescription || ''
  const finalSlug = input.slug?.trim() || ''
  const coverAltText = input.coverAlt || finalMetaTitle

  // WordPress แปลงขึ้นบรรทัดใหม่เป็น <br /> แม้ใน <style> — CSS ทั้งก้อนพัง (FAQ ไม่มีการ์ด) ต้องยุบเป็นบรรทัดเดียว
  const htmlWithAlt = flattenEmbeddedNewlines(input.html).replace(
    /<img(?![^>]*\balt=)([^>]*?)(\s*\/?>)/gi,
    `<img alt="${finalMetaTitle.replace(/"/g, '&quot;')}"$1$2`,
  )

  let featuredMediaId: number | null = null
  const uploaded = new Map<string, string>()
  if (input.coverBase64) {
    const mime = input.coverMimeType || 'image/webp'
    const cover = await uploadMedia(wpUrl, creds, input.coverBase64, mime, finalMetaTitle, coverAltText)
    featuredMediaId = cover?.id ?? null
    // ปกในเนื้อหาเป็นรูปเดียวกับ featured image — ใช้ลิงก์ที่อัปแล้ว ไม่อัปซ้ำ
    if (cover?.url) uploaded.set(`data:${mime};base64,${input.coverBase64}`, cover.url)
  }
  const htmlLinked = await replaceInlineDataImages({
    wpUrl, creds, html: htmlWithAlt, title: finalMetaTitle, known: uploaded,
    fetchFn: (u, i) => safeFetch(u, i, { requireHttps: true, sameHostOnly: true }),
  })

  // ใส่เนื้อหาเสมอแม้ใช้ Elementor — เขียน Elementor ไม่สำเร็จ หน้าเว็บก็ยังแสดงเนื้อหาจริง ไม่ใช่หน้าว่าง
  const content = htmlLinked
  const publishDate = input.publishAt ? new Date(input.publishAt) : null
  const dateGmt = publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate.toISOString().slice(0, 19) : ''
  // ตั้งวันเผยแพร่ไว้ = วาง Draft พร้อมวันที่นั้น ไม่ publish/ตั้งเวลาเอง (เจ้าของสั่ง 2026-09-28)
  const wpStatus = dateGmt ? 'draft' : input.publishMode === 'publish' ? 'publish' : 'draft'
  const payload: Record<string, unknown> = {
    title: input.title,
    content,
    excerpt: finalMetaDesc ? finalMetaDesc.slice(0, 160) : undefined,
    status: wpStatus,
    ...(dateGmt && { date_gmt: dateGmt }),
    ...(finalSlug && { slug: finalSlug }),
    ...(featuredMediaId && { featured_media: featuredMediaId }),
  }

  const wpMeta: Record<string, string> = {}
  if (finalMetaTitle) wpMeta['_yoast_wpseo_title'] = finalMetaTitle
  if (finalMetaDesc) wpMeta['_yoast_wpseo_metadesc'] = finalMetaDesc.slice(0, 160)
  if (input.focusKeyword) wpMeta['_yoast_wpseo_focuskw'] = input.focusKeyword

  const wpEndpoint = isPage ? `${wpUrl}/wp-json/wp/v2/pages` : `${wpUrl}/wp-json/wp/v2/posts`
  // โหมด Elementor ตั้งใน syncElementorDocument หลังสร้างโพสต์ — ไม่ปนในคำขอแรก (ล้ม = retry ทิ้ง Yoast meta ไปด้วย)
  if (Object.keys(wpMeta).length > 0) payload.meta = wpMeta

  // หา post ที่มีอยู่แล้ว: re-push ใช้ existingPostId ตรง ๆ ก่อน ถ้าไม่มีค่อยตรวจ slug ชนกัน
  const findBySlug = async (): Promise<number | null> => {
    if (!finalSlug) return null
    const checkUrl = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}?slug=${encodeURIComponent(finalSlug)}&status=any&context=edit&_fields=id,content&per_page=1`
    const checkRes = await safeFetch(checkUrl, {
      headers: { Authorization: `Basic ${creds}` },
      signal: AbortSignal.timeout(10000),
    }, { requireHttps: true, sameHostOnly: true }).catch(() => null)
    if (checkRes?.ok) {
      const found = await checkRes.json().catch(() => [])
      if (Array.isArray(found) && found.length > 0) {
        // รับเป็นโพสต์เดิมเฉพาะที่ Mars สร้าง (มี wrapper content-article ที่ build-html ใส่ทุกบทความ) — โพสต์ที่คนเขียนเองห้ามทับ
        const c = found[0].content as { raw?: unknown; rendered?: unknown } | undefined
        const text = `${typeof c?.raw === 'string' ? c.raw : ''}${typeof c?.rendered === 'string' ? c.rendered : ''}`
        if (text.includes('content-article')) return found[0].id
      }
    }
    return null
  }

  let existingPostId: number | null = input.existingPostId ?? null
  if (!existingPostId) existingPostId = await findBySlug()

  try {
    let endpoint = existingPostId
      ? `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${existingPostId}`
      : wpEndpoint

    let res = await safeFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    }, { requireHttps: true, sameHostOnly: true })

    // post ที่เคย push ไว้ถูกลบไปแล้วบน WP → หา slug ใหม่ / สร้างใหม่แทน
    if (res.status === 404 && input.existingPostId && existingPostId === input.existingPostId) {
      existingPostId = await findBySlug()
      endpoint = existingPostId
        ? `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${existingPostId}`
        : wpEndpoint
      res = await safeFetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      }, { requireHttps: true, sameHostOnly: true })
    }

    if (!res.ok && payload.meta) {
      const retryPayload = { ...payload }
      delete retryPayload.meta
      res = await safeFetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
        signal: AbortSignal.timeout(30000),
      }, { requireHttps: true, sameHostOnly: true })
    }

    if (!res.ok) {
      const errText = await res.text()
      return { ok: false, error: `WordPress API error ${res.status}: ${errText.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}` }
    }

    const data = await res.json()
    const postId: number = data.id
    const postUrl: string = data.link ?? ''

    // Elementor: ติ๊ก = เอกสาร Elementor (HTML widget ชุดเดียวกับ content) ไม่ติ๊ก = ออกจาก builder
    let warning: string | undefined
    if (postId) {
      warning = await applyElementorMode({
        wpUrl, creds, postId, isPage,
        useElementor: !!input.useElementor,
        html: htmlLinked,
        isUpdate: existingPostId != null,
        liveUrl: data.status === 'publish' && postUrl ? postUrl : undefined,
        yoastMeta: wpMeta,
        siteToc: input.siteToc,
        tocPosition: input.tocPosition,
        fetcher: (url, init) => safeFetch(url, init, { requireHttps: true, sameHostOnly: true }),
      })
      if (Object.keys(wpMeta).length > 0) {
        // ส่ง Yoast meta ซ้ำทุกโหมด (รวม Elementor) — คำขอแรกอาจ retry แบบตัด meta ทิ้งไปแล้ว
        const normalEndpoint = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${postId}`
        await safeFetch(normalEndpoint, {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ meta: wpMeta }),
          signal: AbortSignal.timeout(20000),
        }, { requireHttps: true, sameHostOnly: true }).catch(() => {})
      }

      if (isPage && Object.keys(wpMeta).length) {
        const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
        const customFields = Object.entries(wpMeta).map(([key, value]) =>
          `<value><struct><member><name>key</name><value><string>${escXml(key)}</string></value></member><member><name>value</name><value><string>${escXml(value)}</string></value></member></struct></value>`,
        ).join('')
        const cleanPass = wpPass.replace(/\s+/g, '')
        const xmlBody = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<methodCall><methodName>wp.editPost</methodName><params>',
          `<param><value><int>1</int></value></param>`,
          `<param><value><string>${escXml(wpUser)}</string></value></param>`,
          `<param><value><string>${escXml(cleanPass)}</string></value></param>`,
          `<param><value><int>${postId}</int></value></param>`,
          `<param><value><struct><member><name>custom_fields</name><value><array><data>${customFields}</data></array></value></member></struct></value></param>`,
          '</params></methodCall>',
        ].join('')
        await safeFetch(`${wpUrl}/xmlrpc.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
          body: xmlBody,
          signal: AbortSignal.timeout(15000),
        }, { requireHttps: true, sameHostOnly: true }).catch(() => null)
      }

      // ปลั๊กอิน SEO ตัวอื่น (AIOSEO / Rank Math / SEOPress / Slim SEO) — ไม่เจอ = ไม่ยิงเพิ่ม
      const seo = await syncSeoPluginMeta({
        wpUrl, creds, postId, isPage,
        title: finalMetaTitle,
        description: finalMetaDesc,
        post: data,
        hint: input.seoPlugins,
        fetcher: (url, init) => safeFetch(url, init, { requireHttps: true, sameHostOnly: true }),
      })
      if (seo.warning) warning = warning ? `${warning} · ${seo.warning}` : seo.warning
    }

    return { ok: true, postId, postUrl, status: data.status, slug: data.slug ?? finalSlug, ...(warning && { warning }) }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Push ล้มเหลว: ${msg}` }
  }
}

/** ทดสอบการเชื่อมต่อ WordPress (คัดลอกจาก src/app/api/push/connect/route.ts) */
export async function testWordPressConnection(
  wpUrl: string, wpUser: string, wpPass: string,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const url = normalizeWpUrl(wpUrl)
  if (!url || !wpUser || !wpPass) {
    return { ok: false, error: 'ไม่พบ WordPress credentials' }
  }
  try {
    const cleanPass = wpPass.replace(/\s+/g, '')
    const creds = Buffer.from(`${wpUser}:${cleanPass}`).toString('base64')
    const authHeaders = {
      Authorization: `Basic ${creds}`,
      'User-Agent': 'MarsOS/1.0',
      'Content-Type': 'application/json',
    }

    const meRes = await safeFetch(`${url}/wp-json/wp/v2/users/me`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(10000),
    }, { requireHttps: true, sameHostOnly: true })
    // อ่านร่างได้ = ล็อกอินผ่าน + มีสิทธิ์เขียนโพสต์ (Author ขึ้นไป) — /wp/v2 รากเข้าได้โดยไม่ต้องล็อกอินจึงใช้ตรวจไม่ได้
    const capRes = await safeFetch(`${url}/wp-json/wp/v2/posts?status=draft&per_page=1&_fields=id`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(10000),
    }, { requireHttps: true, sameHostOnly: true }).catch(() => null)
    if (meRes.ok) {
      const me = await meRes.json()
      // ล็อกอินได้แต่ WordPress ปฏิเสธการอ่านร่าง = บัญชีไม่มีสิทธิ์เขียน (เช่น Subscriber) — push จะล้มทีหลัง
      if (capRes && (capRes.status === 401 || capRes.status === 403)) {
        const capCode = await capRes.json().then((j: { code?: unknown }) => String(j?.code ?? '')).catch(() => '')
        if (capCode === 'rest_forbidden_status' || capCode === 'rest_forbidden') {
          return { ok: false, error: `WordPress ตอบ ${capRes.status} — บัญชี ${wpUser} ไม่มีสิทธิ์เขียนโพสต์ — ใช้บัญชี Author/Editor/Administrator` }
        }
      }
      return { ok: true, name: me.name ?? wpUser }
    }
    if (capRes?.ok) return { ok: true, name: wpUser }

    // อ่านรหัสข้อผิดพลาดจาก body ของ /users/me (อาจเป็น HTML)
    const bodyText = await meRes.text().catch(() => '')
    let code = ''
    if (!bodyText.trimStart().startsWith('<')) {
      try { code = String((JSON.parse(bodyText) as { code?: unknown }).code ?? '') } catch { /* ไม่ใช่ JSON */ }
    }
    const isHtml = bodyText.trimStart().startsWith('<')
    const detail =
      code === 'rest_not_logged_in' ? 'WordPress ไม่ได้รับรหัสผ่าน — โฮสต์ตัด Authorization header หรือปลั๊กอินความปลอดภัย (Wordfence/iThemes) บล็อก REST API'
      : code === 'invalid_username' ? 'ไม่พบ Username นี้ใน WordPress — ใช้ Username สำหรับล็อกอิน ไม่ใช่ชื่อที่แสดง'
      : code === 'incorrect_password' ? 'Application Password ไม่ถูกต้อง — สร้างใหม่ที่ Users → Profile → Application Passwords'
      : code === 'application_passwords_disabled' ? 'เว็บปิด Application Passwords (มักเพราะไม่มี SSL หรือปลั๊กอินปิดไว้)'
      : isHtml ? 'เว็บตอบเป็นหน้า HTML แทน API — Cloudflare/ไฟร์วอลล์บล็อก หรือ Permalinks ยังเป็น Plain (ตั้งเป็น Post name)'
      : meRes.status === 404 ? 'ไม่พบ /wp-json — ตั้ง Permalinks เป็น Post name หรือปลั๊กอินปิด REST API'
      : meRes.status === 401 ? 'Application Password ไม่ถูกต้อง หรือ user ไม่มีสิทธิ์ REST API'
      : meRes.status === 403 ? 'WordPress บล็อก REST API — ตรวจสอบ plugin หรือ .htaccess'
      : 'ตรวจสอบ URL และ Application Password'
    return { ok: false, error: `WordPress ตอบ ${meRes.status} — ${detail}` }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // ไม่ส่งรหัสผ่านตามรีไดเรกต์ข้ามโดเมน — บอก URL ที่ถูกให้แก้เอง (มักเป็น www/ไม่มี www)
    const redirectHost = msg.match(/^เว็บรีไดเรกต์ไปโดเมนอื่น \((.+)\)$/)?.[1]
    if (redirectHost) return { ok: false, error: `${msg} — แก้ WordPress URL เป็น https://${redirectHost} แล้วทดสอบใหม่` }
    return { ok: false, error: `เชื่อมต่อไม่ได้: ${msg}` }
  }
}

/**
 * อ่านสถานะจริงของโพสต์บน WordPress (publish/draft/future/...) + ลิงก์ถาวร
 * ใช้ก่อน Request Index — บทความที่ตั้งวันเผยแพร่ขึ้นไปเป็น Draft ทีมจะกด Publish ใน WordPress เอง
 */
export async function getWordPressPostStatus(
  wpUrl: string, wpUser: string, wpPass: string, postId: string, postType: 'post' | 'page' = 'post',
): Promise<{ ok: boolean; status?: string; link?: string; error?: string }> {
  const url = normalizeWpUrl(wpUrl)
  if (!url || !wpUser || !wpPass) return { ok: false, error: 'ไม่พบ WordPress credentials' }
  if (!/^\d+$/.test(postId)) return { ok: false, error: 'ไม่พบ ID โพสต์บน WordPress' }
  const creds = Buffer.from(`${wpUser}:${wpPass.replace(/\s+/g, '')}`).toString('base64')
  const headers = { Authorization: `Basic ${creds}`, 'User-Agent': 'MarsOS/1.0' }
  // ไม่รู้ว่าเคย push เป็น post หรือ page — ลองชนิดที่ตั้งไว้ก่อน แล้วค่อยลองอีกชนิด
  const types = postType === 'page' ? ['pages', 'posts'] : ['posts', 'pages']
  try {
    let lastStatus = 0
    for (const t of types) {
      const res = await safeFetch(`${url}/wp-json/wp/v2/${t}/${postId}?context=edit&_fields=status,link`, {
        headers,
        signal: AbortSignal.timeout(10000),
      }, { requireHttps: true, sameHostOnly: true })
      if (res.ok) {
        const data = await res.json() as { status?: string; link?: string }
        return { ok: true, status: data.status, link: data.link }
      }
      lastStatus = res.status
      if (res.status !== 404) break
    }
    return { ok: false, error: lastStatus === 404 ? 'ไม่พบโพสต์นี้บน WordPress แล้ว (อาจถูกลบ)' : `WordPress ตอบ ${lastStatus}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
