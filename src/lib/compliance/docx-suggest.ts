/**
 * Compliance findings -> Word tracked changes (w:del + w:ins) + comments.
 * Pure logic: XML DOM is injected (browser DOMParser or @xmldom/xmldom in tests).
 * ห้ามแทนข้อความตรง ๆ: ข้อเสนอแก้ทุกจุดเป็นคู่ del+ins, ที่เหลือเป็น comment
 */
import { SEVERITY_LABEL, VERDICT_LABEL } from './types'
import type { Finding } from './types'

export interface XmlDom { parse(xml: string): Document; serialize(doc: Document): string }
export interface SuggestItem { id: string; quote: string; fixTarget?: string; replacement?: string; comment: string }
export interface AnnotateResult { xml: string; comments: { id: number; text: string }[]; changes: number; placed: string[]; unplaced: string[]; paragraphs: number }

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const DOC_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const DEFAULT_AUTHOR = 'MarsOS Compliance'
const COMMENT_MAX = 3000
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

// ตัวอักษรที่ XML 1.0 ไม่รับ + surrogate ครึ่งตัว — หลุดเข้าไฟล์แล้ว Word จะแจ้งไฟล์เสีย
const ILLEGAL_XML = new RegExp('[^\\u0009\\u000A\\u000D\\u0020-\\uD7FF\\uE000-\\uFFFD]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]', 'g')
function cleanText(s: string): string {
  return s.replace(ILLEGAL_XML, '')
}

// ---------- small DOM helpers ----------

function arr(nl: any): Element[] {
  const out: Element[] = []
  if (!nl) return out
  for (let i = 0; i < nl.length; i++) out.push(nl.item ? nl.item(i) : nl[i])
  return out
}
function isW(n: Node | null | undefined, name: string): boolean {
  return !!n && n.nodeType === 1 && (n as Element).localName === name && (n as Element).namespaceURI === W
}
function nodes(el: Node): Node[] {
  const out: Node[] = []
  for (let c = el.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}
function withDecl(xml: string): string {
  return XML_DECL + '\n' + xml.replace(/^\s*<\?xml[^?]*\?>\s*/, '')
}
function nearestP(n: Node): Node | null {
  for (let c = n.parentNode; c; c = c.parentNode) if (isW(c, 'p')) return c
  return null
}
function hasAncestor(n: Node, names: string[], stop?: Node): boolean {
  for (let c = n.parentNode; c && c !== stop; c = c.parentNode) {
    for (const nm of names) if (isW(c, nm)) return true
  }
  return false
}
function directChild(el: Node, name: string): Element | null {
  for (let c = el.firstChild; c; c = c.nextSibling) if (isW(c, name)) return c as Element
  return null
}
function setPreserve(el: Element): void {
  el.setAttributeNS(XML_NS, 'xml:space', 'preserve')
}
function setText(doc: Document, el: Element, text: string): void {
  while (el.firstChild) el.removeChild(el.firstChild)
  el.appendChild(doc.createTextNode(text))
}

// ---------- paragraph text model ----------

function childLen(c: Node): number {
  if (isW(c, 't')) return (c.textContent || '').length
  if (isW(c, 'tab') || isW(c, 'br') || isW(c, 'cr') || isW(c, 'noBreakHyphen')) return 1
  return 0
}
function childText(c: Node): string {
  if (isW(c, 't')) return c.textContent || ''
  if (isW(c, 'tab')) return '\t'
  if (isW(c, 'br') || isW(c, 'cr')) return '\n'
  if (isW(c, 'noBreakHyphen')) return '-'
  return ''
}
function runText(r: Node): string {
  let s = ''
  for (let c = r.firstChild; c; c = c.nextSibling) s += childText(c)
  return s
}

interface RunInfo { run: Element; start: number; end: number }

function collectRuns(p: Node): RunInfo[] {
  const out: RunInfo[] = []
  let pos = 0
  for (const r of arr((p as Element).getElementsByTagNameNS(W, 'r'))) {
    if (nearestP(r) !== p) continue
    if (hasAncestor(r, ['del', 'moveFrom'])) continue
    const len = runText(r).length
    out.push({ run: r, start: pos, end: pos + len })
    pos += len
  }
  return out
}
function paragraphText(p: Node): string {
  return collectRuns(p).map(r => runText(r.run)).join('')
}
// กล่องข้อความถูกเก็บ 2 ชุด (mc:Choice + mc:Fallback) — อ่านและแก้เฉพาะชุดที่แสดงจริง
function inFallback(n: Node): boolean {
  for (let c = n.parentNode; c; c = c.parentNode) {
    if (c.nodeType === 1 && (c as Element).localName === 'Fallback' && (c as Element).namespaceURI === MC) return true
  }
  return false
}
function allParagraphs(doc: Document): Element[] {
  return arr(doc.getElementsByTagNameNS(W, 'p')).filter(p => !inFallback(p))
}
function joinParagraphs(texts: string[]): string {
  const t = texts.slice()
  while (t.length && t[t.length - 1] === '') t.pop()
  return t.join('\n')
}

export function docxBodyText(documentXml: string, dom: XmlDom): string {
  const doc = dom.parse(documentXml)
  return joinParagraphs(allParagraphs(doc).map(paragraphText))
}

// ---------- tolerant matching ----------

interface NormText { s: string; start: number[]; end: number[] }

const MARK_RE = new RegExp('^\\p{M}$', 'u')
const WS_RE = /^\s$/

function isZeroWidth(code: number): boolean {
  return (code >= 0x200b && code <= 0x200d) || code === 0xfeff
}

// ตัด zero-width, ยุบ whitespace เป็น 1 ช่อง, NFC พร้อมเก็บ index เดิม
function normalise(text: string): NormText {
  interface Tok { ch: string; a: number; b: number }
  const toks: Tok[] = []
  for (let i = 0; i < text.length;) {
    const code = text.charCodeAt(i)
    let n = 1
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) n = 2
    }
    if (!isZeroWidth(code)) toks.push({ ch: text.substr(i, n), a: i, b: i + n })
    i += n
  }
  let s = ''
  const start: number[] = []
  const end: number[] = []
  const push = (str: string, a: number, b: number) => {
    for (let k = 0; k < str.length; k++) { s += str.charAt(k); start.push(a); end.push(b) }
  }
  for (let i = 0; i < toks.length;) {
    if (WS_RE.test(toks[i].ch)) {
      let j = i
      while (j + 1 < toks.length && WS_RE.test(toks[j + 1].ch)) j++
      push(' ', toks[i].a, toks[j].b)
      i = j + 1
      continue
    }
    let j = i
    let cl = toks[i].ch
    while (j + 1 < toks.length && MARK_RE.test(toks[j + 1].ch)) { j++; cl += toks[j].ch }
    push(cl.normalize('NFC'), toks[i].a, toks[j].b)
    i = j + 1
  }
  return { s, start, end }
}

function normNeedle(needle: string): string {
  return normalise(needle).s.trim()
}

interface Occ { pi: number; s: number; e: number }

// ---------- ids / dates ----------

function maxIdOf(doc: Document, names: string[]): number {
  let max = -1
  for (const nm of names) {
    for (const el of arr(doc.getElementsByTagNameNS(W, nm))) {
      const v = parseInt(el.getAttributeNS(W, 'id') || '', 10)
      if (!isNaN(v) && v > max) max = v
    }
  }
  return max
}
// เลข revision ใหม่ต้องไม่ชนกับ w:id ใด ๆ ที่มีอยู่แล้วในเอกสาร (ins/del/rPrChange/cellIns/bookmark ฯลฯ)
function maxAnyId(doc: Document): number {
  let max = -1
  for (const el of arr(doc.getElementsByTagName('*'))) {
    const raw = el.getAttributeNS(W, 'id') || ''
    if (!/^\d{1,9}$/.test(raw)) continue
    const v = parseInt(raw, 10)
    if (v > max) max = v
  }
  return max
}
function defaultDate(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ---------- run splitting / applying ----------

// สำเนา rPr: rPrChange ในสำเนาต้องได้เลข revision ใหม่ (ข้อความที่แทรกใหม่ไม่ต้องมี rPrChange เลย)
function cloneRPr(ctx: Ctx, rPr: Element, forInsert: boolean): Element {
  const c = rPr.cloneNode(true) as Element
  for (const ch of arr(c.getElementsByTagNameNS(W, 'rPrChange'))) {
    if (forInsert) ch.parentNode!.removeChild(ch)
    else ch.setAttributeNS(W, 'w:id', String(ctx.rev++))
  }
  return c
}

function splitRun(ctx: Ctx, run: Element, k: number): void {
  const doc = ctx.doc
  const second = run.cloneNode(false) as Element
  const rPr = directChild(run, 'rPr')
  if (rPr) second.appendChild(cloneRPr(ctx, rPr, false))
  let acc = 0
  let moved = false
  for (const c of nodes(run)) {
    if (c === rPr) continue
    if (moved) { second.appendChild(c); continue }
    const l = childLen(c)
    if (acc + l <= k && !(l === 0 && acc === k)) { acc += l; continue }
    if (l > 0 && acc < k) {
      const txt = c.textContent || ''
      const cut = k - acc
      const t2 = doc.createElementNS(W, 'w:t')
      setPreserve(t2)
      setText(doc, t2, txt.slice(cut))
      setText(doc, c as Element, txt.slice(0, cut))
      setPreserve(c as Element)
      second.appendChild(t2)
    } else {
      second.appendChild(c)
    }
    moved = true
  }
  run.parentNode!.insertBefore(second, run.nextSibling)
}

function splitAt(ctx: Ctx, p: Node, k: number): void {
  for (const r of collectRuns(p)) {
    if (r.start < k && k < r.end) { splitRun(ctx, r.run, k - r.start); return }
  }
}

function toDelText(doc: Document, run: Element): void {
  for (const c of nodes(run)) {
    if (!isW(c, 't')) continue
    const d = doc.createElementNS(W, 'w:delText')
    setPreserve(d)
    d.appendChild(doc.createTextNode(c.textContent || ''))
    run.replaceChild(d, c)
  }
}

interface Ctx { doc: Document; author: string; date: string; rev: number }

function revAttrs(ctx: Ctx, el: Element): void {
  el.setAttributeNS(W, 'w:id', String(ctx.rev++))
  el.setAttributeNS(W, 'w:author', ctx.author)
  el.setAttributeNS(W, 'w:date', ctx.date)
}

function makeInsRun(ctx: Ctx, rPr: Element | null, text: string): Element {
  const doc = ctx.doc
  const r = doc.createElementNS(W, 'w:r')
  if (rPr) r.appendChild(cloneRPr(ctx, rPr, true))
  const lines = cleanText(text.replace(/\r\n?|\u000B|\u000C/g, '\n')).split('\n')
  lines.forEach((line, i) => {
    if (i > 0) r.appendChild(doc.createElementNS(W, 'w:br'))
    if (line === '') return
    const t = doc.createElementNS(W, 'w:t')
    setPreserve(t)
    t.appendChild(doc.createTextNode(line))
    r.appendChild(t)
  })
  return r
}

function insertAfterAll(first: Node, list: Node[]): void {
  let cur = first
  for (const n of list) {
    cur.parentNode!.insertBefore(n, cur.nextSibling)
    cur = n
  }
}

function commentMarks(doc: Document, id: number): { start: Element; end: Element; ref: Element } {
  const start = doc.createElementNS(W, 'w:commentRangeStart')
  start.setAttributeNS(W, 'w:id', String(id))
  const end = doc.createElementNS(W, 'w:commentRangeEnd')
  end.setAttributeNS(W, 'w:id', String(id))
  const ref = doc.createElementNS(W, 'w:r')
  const cr = doc.createElementNS(W, 'w:commentReference')
  cr.setAttributeNS(W, 'w:id', String(id))
  ref.appendChild(cr)
  return { start, end, ref }
}

// คืน true เมื่อทำ tracked change สำเร็จ
function applyGroup(ctx: Ctx, p: Node, s: number, e: number, replacement: string | null, commentIds: number[]): boolean {
  const doc = ctx.doc
  splitAt(ctx, p, s)
  splitAt(ctx, p, e)
  const covered = collectRuns(p).filter(r => r.end > r.start && r.start >= s && r.end <= e).map(r => r.run)
  if (!covered.length) return false

  let first: Node = covered[0]
  let last: Node = covered[covered.length - 1]
  let changed = false
  if (replacement && !covered.some(r => hasAncestor(r, ['ins', 'moveTo'], p))) {
    const rPr = directChild(covered[0], 'rPr')
    let lastDel: Element | null = null
    covered.forEach((run, i) => {
      const del = doc.createElementNS(W, 'w:del')
      revAttrs(ctx, del)
      run.parentNode!.insertBefore(del, run)
      del.appendChild(run)
      toDelText(doc, run)
      if (i === 0) first = del
      lastDel = del
    })
    const ins = doc.createElementNS(W, 'w:ins')
    revAttrs(ctx, ins)
    ins.appendChild(makeInsRun(ctx, rPr, replacement))
    const ld = lastDel as unknown as Element
    ld.parentNode!.insertBefore(ins, ld.nextSibling)
    last = ins
    changed = true
  }
  for (const id of commentIds) {
    const m = commentMarks(doc, id)
    first.parentNode!.insertBefore(m.start, first)
  }
  const tail: Node[] = []
  for (const id of commentIds) {
    const m = commentMarks(doc, id)
    tail.push(m.end, m.ref)
  }
  insertAfterAll(last, tail)
  return changed
}

// ---------- annotate ----------

export function annotateDocumentXml(
  documentXml: string,
  items: SuggestItem[],
  opts: { dom: XmlDom; author?: string; date?: string; existingCommentsXml?: string | null },
): AnnotateResult {
  const { dom } = opts
  const author = opts.author || DEFAULT_AUTHOR
  const date = opts.date || defaultDate()
  const doc = dom.parse(documentXml)
  const paras = allParagraphs(doc)
  const texts = paras.map(paragraphText)
  const norms = texts.map(normalise)
  const lowers = norms.map(n => n.s.toLowerCase())

  const ctx: Ctx = {
    doc, author, date,
    rev: maxAnyId(doc) + 1,
  }
  let commentId = maxIdOf(doc, ['commentRangeStart', 'commentReference']) + 1
  if (opts.existingCommentsXml) {
    const cdoc = dom.parse(opts.existingCommentsXml)
    const m = maxIdOf(cdoc, ['comment'])
    if (m + 1 > commentId) commentId = m + 1
  }

  // occurrences of a normalised needle, in document order
  const occCache: Record<string, Occ[]> = {}
  const used: Record<string, number> = {}
  const findOcc = (needle: string): Occ[] => {
    const key = needle
    if (occCache[key]) return occCache[key]
    const scan = (ci: boolean): Occ[] => {
      const out: Occ[] = []
      const nd = ci ? key.toLowerCase() : key
      for (let pi = 0; pi < norms.length; pi++) {
        const hay = ci ? lowers[pi] : norms[pi].s
        if (ci && hay.length !== norms[pi].s.length) continue
        let from = 0
        for (;;) {
          const at = hay.indexOf(nd, from)
          if (at < 0) break
          out.push({ pi, s: norms[pi].start[at], e: norms[pi].end[at + nd.length - 1] })
          from = at + nd.length
        }
      }
      return out
    }
    let r = scan(false)
    if (!r.length) r = scan(true)
    occCache[key] = r
    return r
  }
  const pick = (raw: string): Occ | null => {
    const nd = normNeedle(raw)
    if (nd.length < 2) return null
    const occ = findOcc(nd)
    if (!occ.length) return null
    const n = used[nd] || 0
    used[nd] = n + 1
    return occ[Math.min(n, occ.length - 1)]
  }

  // ข้อความที่จะแก้ (target) อาจมีหลายที่ในเอกสาร — เลือกที่ที่ทับกับ quote ของข้อนั้น ไม่ใช่ที่แรกที่เจอ
  const pickTarget = (target: string, quote: string): Occ | null => {
    const tn = normNeedle(target)
    const qn = normNeedle(quote)
    const linked = qn.length >= 2 && qn !== tn
    if (linked && tn.length >= 2) {
      const tOcc = findOcc(tn)
      const qOcc = findOcc(qn)
      if (tOcc.length && qOcc.length) {
        const q = qOcc[Math.min(used[qn] || 0, qOcc.length - 1)]
        const hit = tOcc.filter(o => o.pi === q.pi && ((o.s <= q.s && o.e >= q.e) || (q.s <= o.s && q.e >= o.e)))[0]
        if (hit) { used[qn] = (used[qn] || 0) + 1; return hit }
      }
    }
    const occ = pick(target)
    // target ครอบ quote อยู่แล้ว — นับว่า quote ถูกใช้ไป 1 ตำแหน่ง รายการถัดไปที่ quote เดียวกันจะได้ตำแหน่งถัดไป
    if (occ && linked) used[qn] = (used[qn] || 0) + 1
    return occ
  }

  interface Entry { order: number; s: number; e: number; replacement: string | null }
  const perPara: Record<number, Entry[]> = {}
  const placed: string[] = []
  const unplaced: string[] = []
  const unplacedItems: SuggestItem[] = []

  items.forEach((it, order) => {
    let occ: Occ | null = null
    let replacement: string | null = null
    if (it.fixTarget && it.replacement && it.fixTarget !== it.replacement) {
      occ = pickTarget(it.fixTarget, it.quote || '')
      if (occ) replacement = it.replacement
    }
    if (!occ) occ = pick(it.quote || '')
    if (!occ) { unplaced.push(it.id); unplacedItems.push(it); return }
    placed.push(it.id)
    ;(perPara[occ.pi] = perPara[occ.pi] || []).push({ order, s: occ.s, e: occ.e, replacement })
  })

  const comments: { id: number; text: string }[] = []
  let changes = 0

  for (const key of Object.keys(perPara)) {
    const pi = Number(key)
    const entries = perPara[pi].slice().sort((a, b) => a.s - b.s || a.order - b.order)
    interface Group { s: number; e: number; entries: Entry[] }
    const groups: Group[] = []
    const merge = (list: Entry[]): Group[] => {
      const out: Group[] = []
      for (const en of list) {
        const g = out[out.length - 1]
        if (g && en.s < g.e) { g.e = Math.max(g.e, en.e); g.entries.push(en) } else out.push({ s: en.s, e: en.e, entries: [en] })
      }
      return out
    }
    // ข้อเสนอแก้ที่ไม่ทับกันเองต้องได้เป็น tracked change แยกจุด — comment ที่คร่อมหลายจุดไปเกาะจุดแรกที่ทับ
    const fixGroups = merge(entries.filter(en => en.replacement))
    const loose: Entry[] = []
    for (const en of entries) {
      if (en.replacement) continue
      const g = fixGroups.filter(x => en.s < x.e && en.e > x.s)[0]
      if (g) g.entries.push(en); else loose.push(en)
    }
    for (const g of fixGroups.concat(merge(loose))) groups.push(g)
    groups.sort((a, b) => a.s - b.s)
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const g = groups[gi]
      const byOrder = g.entries.slice().sort((a, b) => a.order - b.order)
      const winner = byOrder.filter(x => x.replacement)[0] || null
      const s = winner ? winner.s : g.s
      const e = winner ? winner.e : g.e
      const ids: number[] = []
      for (const en of byOrder) {
        const id = commentId++
        ids.push(id)
        comments.push({ id, text: items[en.order].comment })
      }
      if (applyGroup(ctx, paras[pi], s, e, winner ? winner.replacement : null, ids)) changes++
    }
  }

  if (unplacedItems.length) {
    let anchor: Element | null = null
    for (const p of paras) {
      const runs = collectRuns(p).filter(r => r.end > r.start && !hasAncestor(r.run, ['ins', 'moveTo'], p))
      if (runs.length) { anchor = runs[0].run; break }
    }
    if (!anchor) {
      for (const p of paras) {
        const runs = collectRuns(p)
        if (runs.length) { anchor = runs[0].run; break }
      }
    }
    if (anchor) {
      let node: Node = anchor
      while (isW(node.parentNode, 'del')) node = node.parentNode!
      const id = commentId++
      comments.push({
        id,
        text: `ตำแหน่งในไฟล์หาไม่เจอ ${unplacedItems.length} จุด (ข้อความในไฟล์อาจต่างจากตอนตรวจ):\n\n` +
          unplacedItems.map(i => i.comment).join('\n\n'),
      })
      const m = commentMarks(doc, id)
      node.parentNode!.insertBefore(m.start, node)
      insertAfterAll(node, [m.end, m.ref])
    }
  }

  comments.sort((a, b) => a.id - b.id)
  return { xml: withDecl(dom.serialize(doc)), comments, changes, placed, unplaced, paragraphs: paras.length }
}

// ---------- comments part / package plumbing ----------

export function buildCommentsXml(
  existingXml: string | null,
  comments: { id: number; text: string }[],
  opts: { dom: XmlDom; author: string; date: string },
): string {
  const { dom } = opts
  const doc = existingXml
    ? dom.parse(existingXml)
    : dom.parse(`<w:comments xmlns:w="${W}"/>`)
  const root = doc.documentElement
  for (const c of comments) {
    const el = doc.createElementNS(W, 'w:comment')
    el.setAttributeNS(W, 'w:id', String(c.id))
    el.setAttributeNS(W, 'w:author', cleanText(opts.author))
    el.setAttributeNS(W, 'w:date', opts.date)
    el.setAttributeNS(W, 'w:initials', 'MC')
    for (const line of cleanText(c.text.replace(/\r\n?|\u000B|\u000C/g, '\n')).split('\n')) {
      const p = doc.createElementNS(W, 'w:p')
      if (line !== '') {
        const r = doc.createElementNS(W, 'w:r')
        const t = doc.createElementNS(W, 'w:t')
        setPreserve(t)
        t.appendChild(doc.createTextNode(line))
        r.appendChild(t)
        p.appendChild(r)
      }
      el.appendChild(p)
    }
    root.appendChild(el)
  }
  return withDecl(dom.serialize(doc))
}

function allByLocal(doc: Document, name: string): Element[] {
  return arr(doc.getElementsByTagName(name))
}

export function ensureCommentsPart(
  contentTypesXml: string,
  documentRelsXml: string | null,
  dom: XmlDom,
): { contentTypes: string; rels: string; target: string } {
  const relsDoc = dom.parse(documentRelsXml || `<Relationships xmlns="${REL_NS}"/>`)
  const rels = allByLocal(relsDoc, 'Relationship')
  for (const r of rels) {
    if (r.getAttribute('Type') === COMMENTS_REL) {
      const t = r.getAttribute('Target') || 'comments.xml'
      const target = t.charAt(0) === '/' ? t.slice(1) : 'word/' + t
      return { contentTypes: contentTypesXml, rels: documentRelsXml || '', target }
    }
  }
  let max = 0
  for (const r of rels) {
    const m = /^rId(\d+)$/.exec(r.getAttribute('Id') || '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  const root = relsDoc.documentElement
  const rel = relsDoc.createElementNS(root.namespaceURI || REL_NS, 'Relationship')
  rel.setAttribute('Id', `rId${max + 1}`)
  rel.setAttribute('Type', COMMENTS_REL)
  rel.setAttribute('Target', 'comments.xml')
  root.appendChild(rel)

  const ctDoc = dom.parse(contentTypesXml)
  const has = allByLocal(ctDoc, 'Override').some(o => o.getAttribute('PartName') === '/word/comments.xml')
  let contentTypes = contentTypesXml
  if (!has) {
    const ctRoot = ctDoc.documentElement
    const ov = ctDoc.createElementNS(ctRoot.namespaceURI || CT_NS, 'Override')
    ov.setAttribute('PartName', '/word/comments.xml')
    ov.setAttribute('ContentType', COMMENTS_CT)
    ctRoot.appendChild(ov)
    contentTypes = withDecl(dom.serialize(ctDoc))
  }
  return { contentTypes, rels: withDecl(dom.serialize(relsDoc)), target: 'word/comments.xml' }
}

// ---------- findings -> items ----------

export function findingsToItems(findings: Finding[]): SuggestItem[] {
  const out: SuggestItem[] = []
  for (const f of findings) {
    if (f.verdict === 'likely_ok') continue
    const lines = [
      `[${f.ruleCode}] ${f.ruleTitle}`,
      `ระดับ: ${SEVERITY_LABEL[f.severity]} · ${VERDICT_LABEL[f.verdict]}${f.origin === 'ai' ? ' · AI' : f.origin === 'spelling' ? ' · คำสะกด' : ''}`,
      f.reason ? `เหตุผล: ${f.reason}` : '',
      f.suggestion ? `คำแนะนำ: ${f.suggestion}` : '',
      f.replacement ? `ข้อความที่เสนอ: ${f.replacement}` : '',
      f.sourceName ? `อ้างอิง: ${f.sourceName}${f.sourceRef ? ' ' + f.sourceRef : ''}` : '',
    ].filter(Boolean)
    out.push({
      id: f.id,
      quote: f.quote,
      fixTarget: f.fixTarget,
      replacement: f.replacement,
      comment: lines.join('\n').slice(0, COMMENT_MAX),
    })
  }
  return out
}

// ---------- plain docx ----------

function xmlEscape(s: string): string {
  return s.replace(ILLEGAL_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function plainPara(line: string, bold: boolean): string {
  if (line === '') return '<w:p/>'
  const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : ''
  const parts = line.split('\t').map(x => `<w:t xml:space="preserve">${xmlEscape(x)}</w:t>`)
  return `<w:p><w:r>${rPr}${parts.join('<w:tab/>')}</w:r></w:p>`
}

export function plainDocxParts(title: string, text: string): Record<string, string> {
  const paras: string[] = []
  if (title) paras.push(plainPara(title.replace(/[\r\n]+/g, ' '), true))
  for (const line of (text || '').split(/\r\n|\r|\n/)) paras.push(plainPara(line, false))
  return {
    '[Content_Types].xml':
      `${XML_DECL}\n<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOC_CT}"/></Types>`,
    '_rels/.rels':
      `${XML_DECL}\n<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${DOC_REL}" Target="word/document.xml"/></Relationships>`,
    'word/document.xml':
      `${XML_DECL}\n<w:document xmlns:w="${W}"><w:body>${paras.join('')}</w:body></w:document>`,
    'word/_rels/document.xml.rels':
      `${XML_DECL}\n<Relationships xmlns="${REL_NS}"/>`,
  }
}
