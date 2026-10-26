/**
 * Export บทความเป็นไฟล์ให้ลูกค้าตรวจ — Word (.docx) และ HTML เดี่ยว
 *
 * ใช้ได้เฉพาะฝั่งเบราว์เซอร์ (DOMParser / canvas / fetch / object URL)
 * `docx` import แบบ static ในไฟล์นี้ — ฝั่ง UI ให้ `await import('@/lib/article-export')`
 * ตอนกดปุ่ม เพื่อไม่ให้ docx ไปอยู่ใน bundle เริ่มต้น
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, ImageRun,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, LevelFormat,
  ShadingType, UnderlineType,
} from 'docx'
import { boxKeyTakeaways } from '@/lib/article-structure'

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ───────────────────────── HTML เดี่ยว ─────────────────────────

const PAGE_BG_RE = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i

/**
 * ห่อบทความเป็นเอกสาร HTML ที่เปิดได้ทุกเบราว์เซอร์ — สไตล์พื้นฐานเดียวกับ ArticleFrame (Preview ในระบบ)
 * `<style>` และ JSON-LD ของบทความอยู่ครบ ไม่แตะ
 * CSP script-src 'none' — แท็บ preview เป็น blob: ของโดเมนระบบ สคริปต์ที่ติดมากับบทความต้องรันไม่ได้ (JSON-LD ไม่ใช่สคริปต์ที่รัน ไม่โดน)
 */
export function buildStandaloneArticleHtml(o: {
  html: string
  title: string
  lang: 'th' | 'en'
  coverSrc?: string
  coverAlt?: string
  /** สีพื้นหน้าเว็บปลายทาง (เหมือน ArticleFrame) — รับเฉพาะ hex/rgb, ไม่ตรงรูปแบบ = ขาว */
  pageBackground?: string
}): string {
  // หัวกล่องสรุปตามภาษาของเนื้อหา (บทความเก่า / โหมดไทย+อังกฤษ ที่ project.language ไม่บอกภาษาจริง)
  const html = boxKeyTakeaways(o.html || '')
  const bg = o.pageBackground && PAGE_BG_RE.test(o.pageBackground.trim()) ? o.pageBackground.trim() : '#fff'
  const cover = o.coverSrc && !html.includes('content-cover')
    ? `<img src="${escHtml(o.coverSrc)}" alt="${escHtml(o.coverAlt ?? o.title)}" style="width:100%;height:auto;display:block;margin:0 0 24px;border-radius:12px" />\n`
    : ''
  return `<!doctype html>
<html lang="${o.lang === 'en' ? 'en' : 'th'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">
<title>${escHtml(o.title)}</title>
<style>html,body{margin:0;padding:24px;box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:${bg};line-height:1.7;word-break:break-word;overflow-wrap:break-word;}img{max-width:100%;height:auto;}table{width:100%;border-collapse:collapse;display:block;overflow-x:auto;}.article-export-wrap{max-width:840px;margin:0 auto;}</style>
</head>
<body>
<div class="article-export-wrap">
${cover}${html}
</div>
</body>
</html>`
}

// ───────────────────────── Word (.docx) ─────────────────────────

type DocxBlock = Paragraph | Table
type InlineChild = TextRun | ExternalHyperlink

interface Fmt { bold?: boolean; italics?: boolean; underline?: boolean; code?: boolean; size?: number }
interface Tok { kind: 'text' | 'br'; text: string; fmt: Fmt; href?: string }

interface ParaOpts {
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]
  list?: { kind: 'ul' | 'ol'; level: number; instance: number }
  indentLeft?: number
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
  keepNext?: boolean
  box?: boolean        // เส้นซ้าย + พื้นอ่อน (กล่องสรุปประเด็นสำคัญ)
  quote?: boolean
}

// state ของ container หนึ่งอัน: out ใช้ร่วมกับ parent, buf/opts/fmt เป็นของตัวเอง
interface St {
  out: DocxBlock[]
  buf: Tok[]
  opts: ParaOpts
  fmt: Fmt
  listUsed: boolean
  listDepth: number
  href?: string
}

interface LoadedImg { data: Uint8Array; width: number; height: number }

interface Ctx {
  olCount: { n: number }
  imgCache: Map<string, Promise<LoadedImg | null>>
}

const SKIP_SEL = 'script,style,noscript,template,svg,nav.content-toc,nav.content-breadcrumb,[hidden]'
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure', 'figcaption',
  'blockquote', 'ul', 'ol', 'li', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'details', 'summary',
  'hr', 'nav', 'form', 'pre', 'dl', 'dt', 'dd', 'address', 'fieldset',
])

const THAI_FONT = { ascii: 'Tahoma', hAnsi: 'Tahoma', cs: 'Tahoma', eastAsia: 'Tahoma' }
const MAX_IMG_W = 600
const BORDER_GRAY = 'BFBFBF'

type StPatch = { opts?: ParaOpts; fmt?: Fmt; listUsed?: boolean; listDepth?: number }

function newSt(parent: St | null, patch: StPatch, out?: DocxBlock[]): St {
  return {
    out: out ?? parent!.out,
    buf: [],
    opts: { ...(parent?.opts ?? {}), ...(patch.opts ?? {}) },
    fmt: { ...(parent?.fmt ?? {}), ...(patch.fmt ?? {}) },
    listUsed: patch.listUsed ?? false,
    listDepth: patch.listDepth ?? parent?.listDepth ?? 0,
    href: parent?.href,
  }
}

/** รวม token → run: ยุบ whitespace แบบ HTML, ตัดช่องว่างหัว/ท้ายย่อหน้า */
function tokensToChildren(tokens: Tok[]): InlineChild[] {
  const list: Tok[] = []
  let prevSpace = true // ต้นย่อหน้า = เหมือนมีช่องว่างอยู่แล้ว
  for (const t of tokens) {
    if (t.kind === 'br') {
      const last = list[list.length - 1]
      if (last && last.kind === 'text' && last.text.endsWith(' ')) last.text = last.text.slice(0, -1)
      list.push({ ...t })
      prevSpace = true
      continue
    }
    let text = t.text.replace(/\s+/g, ' ')
    if (prevSpace && text.startsWith(' ')) text = text.slice(1)
    if (!text) continue
    prevSpace = text.endsWith(' ')
    list.push({ ...t, text })
  }
  const last = list[list.length - 1]
  if (last && last.kind === 'text' && last.text.endsWith(' ')) last.text = last.text.slice(0, -1)
  const children: InlineChild[] = []
  for (const t of list) {
    if (t.kind === 'br') { children.push(new TextRun({ break: 1 })); continue }
    if (!t.text) continue
    const run: ConstructorParameters<typeof TextRun>[0] = {
      text: t.text,
      bold: t.fmt.bold || undefined,
      italics: t.fmt.italics || undefined,
      underline: t.fmt.underline ? { type: UnderlineType.SINGLE } : undefined,
      font: t.fmt.code ? { ascii: 'Consolas', hAnsi: 'Consolas', cs: 'Consolas', eastAsia: 'Consolas' } : undefined,
      size: t.fmt.size,
      sizeComplexScript: t.fmt.size ? Math.round(t.fmt.size * 1.27) : undefined,
    }
    if (t.href) {
      children.push(new ExternalHyperlink({ link: t.href, children: [new TextRun({ ...run, style: 'Hyperlink' })] }))
    } else {
      children.push(new TextRun(run))
    }
  }
  return children
}

type ParaInit = ConstructorParameters<typeof Paragraph>[0] & object

function makeParagraph(children: InlineChild[], opts: ParaOpts): Paragraph {
  const o: { -readonly [K in keyof ParaInit]: ParaInit[K] } = { children }
  if (opts.heading) o.heading = opts.heading
  if (opts.alignment) o.alignment = opts.alignment
  if (opts.keepNext) o.keepNext = true
  if (opts.list) {
    o.numbering = { reference: opts.list.kind, level: Math.min(opts.list.level, 8), instance: opts.list.instance }
  } else if (opts.indentLeft) {
    o.indent = { left: opts.indentLeft }
  }
  if (opts.quote) {
    o.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'CBD5E1', space: 8 } }
  }
  if (opts.box) {
    o.border = { left: { style: BorderStyle.SINGLE, size: 24, color: '3B82F6', space: 8 } }
    o.shading = { type: ShadingType.CLEAR, fill: 'EFF6FF', color: 'auto' }
  }
  if (!opts.heading && !opts.list) o.spacing = { after: 120 }
  return new Paragraph(o)
}

/** ส่ง buffer ออกเป็นย่อหน้า (ข้ามถ้าว่าง) */
function flush(st: St) {
  const children = tokensToChildren(st.buf)
  st.buf = []
  if (!children.length) return
  const opts = { ...st.opts }
  if (opts.list) {
    if (st.listUsed) {
      // ย่อหน้าที่ 2+ ใน li เดียวกัน: ไม่ขึ้นสัญลักษณ์ใหม่ แค่เยื้องให้ตรงเนื้อหา
      opts.indentLeft = 720 + 360 * opts.list.level
      opts.list = undefined
    } else {
      st.listUsed = true
    }
  }
  st.out.push(makeParagraph(children, opts))
}

function imgFailParagraph(alt: string, src: string): Paragraph {
  const kids: InlineChild[] = [new TextRun({ text: `[รูปภาพ: ${alt || 'ไม่มีคำอธิบาย'}] `, italics: true })]
  if (/^https?:\/\//i.test(src)) {
    kids.push(new ExternalHyperlink({ link: src, children: [new TextRun({ text: src, style: 'Hyperlink' })] }))
  }
  return new Paragraph({ children: kids, spacing: { after: 120 } })
}

function loadImageEl(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/** โหลดรูป → วาดลง canvas → PNG (docx รับแค่ png/jpg/gif/bmp; แปลงทุกชนิดเป็น PNG ให้เหมือนกันหมด) */
async function rasterize(src: string): Promise<LoadedImg | null> {
  let img: HTMLImageElement
  let blobUrl = ''
  try {
    if (src.startsWith('data:')) {
      img = await loadImageEl(src, false)
    } else {
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error(String(res.status))
        blobUrl = URL.createObjectURL(await res.blob())
        img = await loadImageEl(blobUrl, false)
      } catch {
        // fetch โดน CORS บล็อก — ลองโหลดผ่าน <img crossOrigin> ตรง ๆ
        img = await loadImageEl(src, true)
      }
    }
    const natW = img.naturalWidth || img.width || 0
    const natH = img.naturalHeight || img.height || 0
    let w = natW || MAX_IMG_W
    let h = natH || Math.round(MAX_IMG_W * 0.5625)
    if (w > MAX_IMG_W) { h = Math.round((h * MAX_IMG_W) / w); w = MAX_IMG_W }
    // วาดสูงสุด 2x ของขนาดในหน้า Word ให้คม แต่ไม่ขยายเกินต้นฉบับ
    const scale = natW ? Math.min(2, natW / w) : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/png'))
    if (!blob) return null
    return { data: new Uint8Array(await blob.arrayBuffer()), width: w, height: h }
  } catch {
    return null
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  }
}

async function pushImage(src: string, alt: string, st: St, cx: Ctx) {
  flush(st)
  if (!src) return
  let p = cx.imgCache.get(src)
  if (!p) { p = rasterize(src); cx.imgCache.set(src, p) }
  const loaded = await p
  if (!loaded) { st.out.push(imgFailParagraph(alt, src)); return }
  st.out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [new ImageRun({
      type: 'png',
      data: loaded.data,
      transformation: { width: loaded.width, height: loaded.height },
      altText: { name: alt || 'image', title: alt || 'image', description: alt || 'image' },
    })],
  }))
}

async function walkChildren(parent: Node, st: St, cx: Ctx) {
  for (const c of Array.from(parent.childNodes)) await walk(c, st, cx)
}

/** เดินลูกของ el ใน child state ที่ปรับ opts/fmt แล้ว flush ตอนจบ */
async function walkIn(el: Element, st: St, cx: Ctx, patch: StPatch) {
  flush(st)
  const sub = newSt(st, patch)
  await walkChildren(el, sub, cx)
  flush(sub)
}

/** inline ที่เปลี่ยนแค่ fmt — token เก็บ fmt ของตัวเองตอนสร้าง จึงสลับ st.fmt ชั่วคราวได้ */
async function withFmt(el: Element, st: St, cx: Ctx, patch: Fmt) {
  const prev = st.fmt
  st.fmt = { ...prev, ...patch }
  await walkChildren(el, st, cx)
  st.fmt = prev
}

async function buildCellBlocks(cell: Element, st: St, cx: Ctx, bold: boolean): Promise<DocxBlock[]> {
  const out: DocxBlock[] = []
  const sub = newSt(null, { opts: {}, fmt: { ...st.fmt, bold: bold || st.fmt.bold }, listDepth: 0 }, out)
  await walkChildren(cell, sub, cx)
  flush(sub)
  // cell ต้องมีอย่างน้อย 1 ย่อหน้า และห้ามจบด้วย table
  if (!out.length || out[out.length - 1] instanceof Table) out.push(new Paragraph({ children: [] }))
  return out
}

async function buildTable(el: Element, st: St, cx: Ctx) {
  const rows: Element[] = []
  const collect = (parent: Element) => {
    for (const c of Array.from(parent.children)) {
      const t = c.tagName.toLowerCase()
      if (t === 'tr') rows.push(c)
      else if (t === 'thead' || t === 'tbody' || t === 'tfoot') collect(c)
    }
  }
  collect(el)
  if (!rows.length) return
  const spanOf = (c: Element) => Math.max(1, parseInt(c.getAttribute('colspan') || '1', 10) || 1)
  const isCell = (c: Element) => /^(td|th)$/i.test(c.tagName)
  const colCount = Math.max(1, ...rows.map(r =>
    Array.from(r.children).filter(isCell).reduce((n, c) => n + spanOf(c), 0)))
  const colW = Math.floor(9360 / colCount)
  const side = { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY }
  const borders = { top: side, bottom: side, left: side, right: side }

  const trs: TableRow[] = []
  for (const r of rows) {
    const cells: TableCell[] = []
    for (const c of Array.from(r.children)) {
      if (!isCell(c)) continue
      const isTh = c.tagName.toLowerCase() === 'th'
      const span = spanOf(c)
      cells.push(new TableCell({
        children: await buildCellBlocks(c, st, cx, isTh),
        columnSpan: span > 1 ? span : undefined,
        width: { size: colW * span, type: WidthType.DXA },
        borders,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: isTh ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
      }))
    }
    if (cells.length) trs.push(new TableRow({ children: cells }))
  }
  if (!trs.length) return
  flush(st)
  st.out.push(new Table({
    rows: trs,
    width: { size: '100%', type: WidthType.PERCENTAGE },
    columnWidths: Array(colCount).fill(colW),
  }))
  st.out.push(new Paragraph({ children: [], spacing: { after: 60 } }))
}

async function walk(node: Node, st: St, cx: Ctx): Promise<void> {
  if (node.nodeType === 3) {
    st.buf.push({ kind: 'text', text: node.textContent || '', fmt: st.fmt, href: st.href })
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  if (el.matches(SKIP_SEL)) return
  const tag = el.tagName.toLowerCase()

  switch (tag) {
    case 'img':
      await pushImage(el.getAttribute('src') || '', el.getAttribute('alt') || '', st, cx)
      return
    case 'br':
      st.buf.push({ kind: 'br', text: '', fmt: st.fmt })
      return
    case 'hr':
      flush(st)
      st.out.push(new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_GRAY, space: 1 } },
        spacing: { after: 120 },
      }))
      return
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const heading = tag === 'h1' ? HeadingLevel.HEADING_1
        : tag === 'h2' ? HeadingLevel.HEADING_2
        : tag === 'h3' ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4
      await walkIn(el, st, cx, { opts: { heading, list: undefined, indentLeft: undefined } })
      return
    }
    case 'ul': case 'ol': {
      flush(st)
      const instance = tag === 'ol' ? ++cx.olCount.n : 0
      const level = st.listDepth
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType === 1 && (c as Element).tagName.toLowerCase() === 'li' && !(c as Element).matches(SKIP_SEL)) {
          await walkIn(c as Element, st, cx, {
            opts: { list: { kind: tag, level, instance } },
            listDepth: level + 1,
            listUsed: false,
          })
        } else {
          await walk(c, st, cx)
        }
      }
      flush(st)
      return
    }
    case 'table':
      await buildTable(el, st, cx)
      return
    case 'details': // summary → ตัวหนา (case 'summary') แล้วตามด้วยคำตอบ
      flush(st)
      await walkChildren(el, st, cx)
      flush(st)
      return
    case 'summary':
      await walkIn(el, st, cx, { opts: { keepNext: true }, fmt: { bold: true } })
      return
    case 'figcaption':
      await walkIn(el, st, cx, { opts: { alignment: AlignmentType.CENTER }, fmt: { italics: true, size: 18 } })
      return
    case 'blockquote':
      await walkIn(el, st, cx, { opts: { quote: true, indentLeft: 720 }, fmt: { italics: true } })
      return
    case 'strong': case 'b':
      await withFmt(el, st, cx, { bold: true })
      return
    case 'em': case 'i':
      await withFmt(el, st, cx, { italics: true })
      return
    case 'u':
      await withFmt(el, st, cx, { underline: true })
      return
    case 'code': case 'kbd': case 'samp':
      await withFmt(el, st, cx, { code: true })
      return
    case 'a': {
      const href = (el.getAttribute('href') || '').trim()
      const prev = st.href
      if (/^https?:\/\//i.test(href)) st.href = href
      await walkChildren(el, st, cx)
      st.href = prev
      return
    }
    default:
      break
  }

  // กล่องสรุปประเด็นสำคัญ: ชื่อกล่องตัวหนา ทั้งกล่องมีเส้นซ้าย + พื้นอ่อน
  if (tag === 'div' && el.classList.contains('content-takeaways')) {
    flush(st)
    const sub = newSt(st, { opts: { box: true } })
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 1 && /title|heading/.test((c as Element).className || '')) {
        const prev = sub.fmt
        sub.fmt = { ...prev, bold: true }
        await walk(c, sub, cx)
        flush(sub)
        sub.fmt = prev
      } else {
        await walk(c, sub, cx)
      }
    }
    flush(sub)
    return
  }

  if (BLOCK_TAGS.has(tag)) {
    flush(st)
    await walkChildren(el, st, cx)
    flush(st)
    return
  }
  // inline อื่น ๆ (span ฯลฯ) และแท็กที่ไม่รู้จัก: ลงไปต่อ
  await walkChildren(el, st, cx)
}

export async function buildArticleDocx(o: {
  html: string
  title: string
  coverSrc?: string
  coverAlt?: string
}): Promise<Blob> {
  const doc = new DOMParser().parseFromString(boxKeyTakeaways(o.html || ''), 'text/html')
  const body = doc.body
  const cx: Ctx = { olCount: { n: 0 }, imgCache: new Map() }
  const out: DocxBlock[] = []
  const root: St = { out, buf: [], opts: {}, fmt: {}, listUsed: false, listDepth: 0 }

  if (!body.querySelector('h1') && o.title) {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: o.title })] }))
  }
  if (o.coverSrc && !(o.html || '').includes('content-cover')) {
    await pushImage(o.coverSrc, o.coverAlt ?? o.title, root, cx)
  }
  await walkChildren(body, root, cx)
  flush(root)
  if (!out.length) out.push(new Paragraph({ children: [] }))

  const mkLevels = (kind: 'ul' | 'ol') => Array.from({ length: 9 }, (_, level) => ({
    level,
    format: kind === 'ol' ? LevelFormat.DECIMAL : LevelFormat.BULLET,
    text: kind === 'ol' ? `%${level + 1}.` : '•',
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + 360 * level, hanging: 360 } } },
  }))
  const document = new Document({
    creator: 'MarsOS',
    title: o.title,
    numbering: { config: [
      { reference: 'ul', levels: mkLevels('ul') },
      { reference: 'ol', levels: mkLevels('ol') }, // ol แต่ละอัน restart ที่ 1 ผ่าน instance
    ] },
    styles: {
      default: {
        document: {
          run: { font: THAI_FONT, size: 22, sizeComplexScript: 28 },
        },
      },
      characterStyles: [{
        id: 'Hyperlink',
        name: 'Hyperlink',
        basedOn: 'DefaultParagraphFont',
        run: { color: '0563C1', underline: { type: UnderlineType.SINGLE } },
      }],
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: THAI_FONT, bold: true, size: 36, sizeComplexScript: 40, color: '1E293B' },
          paragraph: { spacing: { before: 360, after: 160 }, keepNext: true } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: THAI_FONT, bold: true, size: 30, sizeComplexScript: 34, color: '1E293B' },
          paragraph: { spacing: { before: 320, after: 140 }, keepNext: true } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: THAI_FONT, bold: true, size: 26, sizeComplexScript: 30, color: '1E293B' },
          paragraph: { spacing: { before: 280, after: 120 }, keepNext: true } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: THAI_FONT, bold: true, size: 24, sizeComplexScript: 28, color: '334155' },
          paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: out,
    }],
  })
  return Packer.toBlob(document)
}

// ───────────────────────── ดาวน์โหลด ─────────────────────────

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** เปิดไฟล์ในแท็บใหม่ — ต้องเรียก window.open ตอนคลิก (ก่อน await) ไม่งั้นโดนบล็อก popup แล้วค่อยส่งแท็บเข้ามา */
export function showBlobInTab(tab: Window | null, blob: Blob): boolean {
  if (!tab || tab.closed) return false
  const url = URL.createObjectURL(blob)
  tab.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

export function articleFileName(s: string): string {
  const name = (s || '').trim().replace(/\s+/g, '-').replace(/[/\\?%*:|"<>]/g, '').slice(0, 60)
  return name || 'article'
}
