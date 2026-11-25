/**
 * Comment ของลูกค้า "รายบทความ" (Upload Article) — แยกจาก Comment รวมของ Content Engine
 * เก็บใน UploadClient.pushPrefs.articleComments = { [articleId]: ArticleComment[] } (ไม่ต้องรัน SQL)
 * ไฟล์นี้ pure: ไม่มี prisma / session — ใช้ได้ทั้งฝั่ง server และ client
 */
import { parse, type HTMLElement } from 'node-html-parser'

export type ArticleCommentSource = 'import' | 'manual'

export interface ArticleComment {
  id: string
  /** import = อ่านมาจากไฟล์ต้นฉบับตอนนำเข้า, manual = พิมพ์/วางเองในระบบ */
  source: ArticleCommentSource
  text: string
  /** ข้อความในบทความตรงจุดที่ comment ชี้ (มีเฉพาะ comment จากไฟล์) */
  quote?: string
  createdAt: string
  /** ติ๊กไว้ = เอาไปปรับตอนกด Generate */
  enabled: boolean
  /** เวลาที่ AI ปรับบทความตาม comment นี้ล่าสุด — ไม่มี = ยังไม่ได้ปรับ */
  appliedAt?: string
  /** สิ่งที่ AI แก้ในบทความตาม comment นี้รอบล่าสุด (เขียนโดย comment-revise เท่านั้น) — ไม่มี = ไม่มีบันทึก */
  changes?: ArticleCommentChange[]
  /** จำนวนจุดที่แก้แต่ไม่ได้เก็บรายละเอียดไว้ (เกิน MAX_CHANGES_PER_COMMENT) */
  moreChanges?: number
}

/** replace = แก้ข้อความในบล็อกเดิม, insert = เพิ่มบล็อกใหม่, delete = ลบบล็อก, format = ข้อความเดิม เปลี่ยนแค่รูปแบบ */
export type ArticleCommentChangeKind = 'replace' | 'insert' | 'delete' | 'format'

/** จุดที่ AI แก้ 1 จุด — ข้อความล้วน ตัดให้สั้นแล้ว (เอาไว้แสดงให้ทีมดู ไม่ได้ใช้สร้างบทความ) */
export interface ArticleCommentChange {
  kind: ArticleCommentChangeKind
  /** ข้อความเดิมเฉพาะท่อนที่ถูกแก้ */
  before?: string
  /** ข้อความใหม่เฉพาะท่อนที่ถูกแก้ */
  after?: string
  /** ข้อความที่ไม่ได้แก้ซึ่งอยู่ก่อน/หลังท่อนที่ถูกแก้ (ให้เห็นว่าอยู่ตรงไหนของย่อหน้า) */
  lead?: string
  tail?: string
}

/** comment ที่อ่านได้จากไฟล์ต้นฉบับ (ยังไม่มี id) */
export interface ExtractedComment {
  text: string
  quote?: string
}

export const ARTICLE_COMMENTS_KEY = 'articleComments'
/** jobType ของ AIJob เมื่อ AI ปรับบทความตาม comment — ใช้ทั้งตอนบันทึกและตอนหาค่าเฉลี่ยต้นทุน */
export const COMMENT_REVISE_JOB_TYPE = 'UPLOAD_ARTICLE_COMMENT_REVISE'
export const MAX_COMMENT_CHARS = 4_000
export const MAX_QUOTE_CHARS = 500
export const MAX_COMMENTS_PER_ARTICLE = 50
export const MAX_COMMENT_TOTAL_CHARS = 20_000
export const MAX_CHANGES_PER_COMMENT = 5
/** ความยาวของ "เดิม" / "เปลี่ยนเป็น" ต่อ 1 จุด */
export const MAX_CHANGE_CHARS = 400
/** ความยาวของข้อความรอบ ๆ ที่ไม่ได้แก้ ต่อ 1 ข้าง */
export const MAX_CHANGE_CONTEXT_CHARS = 60
/** ข้อความของบันทึกการแก้รวมทุก comment ของบทความ 1 ชิ้น — เกินแล้ว comment ถัดไปไม่เก็บบันทึก (pushPrefs เป็น JSON ก้อนเดียว) */
export const MAX_CHANGE_TOTAL_CHARS = 30_000

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote'

function collapse(text: string): string {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** ข้อความของบล็อกที่ marker อยู่ โดยตัด marker ทุกตัวในบล็อกออก */
function quoteOfBlock(block: HTMLElement | null, markerSelector: string): string {
  if (!block) return ''
  const copy = parse(block.toString())
  for (const a of copy.querySelectorAll(markerSelector)) {
    const parent = a.parentNode
    if (parent && parent.tagName?.toLowerCase() === 'sup' && parent.childNodes.length === 1) parent.remove()
    else a.remove()
  }
  return clip(collapse(copy.text), MAX_QUOTE_CHARS)
}

function finish(list: ExtractedComment[]): ExtractedComment[] {
  const out: ExtractedComment[] = []
  for (const c of list) {
    const text = clip(c.text.trim(), MAX_COMMENT_CHARS)
    if (!text) continue
    out.push(c.quote ? { text, quote: c.quote } : { text })
    if (out.length >= MAX_COMMENTS_PER_ARTICLE) break
  }
  return out
}

/**
 * Comment จาก HTML ที่ Google Docs ส่งออก (export?format=html หรือไฟล์ .html)
 * - จุดในเนื้อหา: <sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup> (อยู่ท้ายช่วงที่ถูก comment)
 * - ข้อความ comment ท้ายเอกสาร: <div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a>ข้อความ</p></div>
 * คำตอบใน thread เดียวกันเป็น comment แยกรายการ (Google Docs ส่งออกมาแบบนั้น)
 */
export function extractGoogleDocsComments(rawHtml: string): ExtractedComment[] {
  if (!rawHtml || !/#cmnt_ref/i.test(rawHtml)) return []
  const root = parse(rawHtml, { comment: false })
  const quotes = new Map<string, string>()
  for (const a of root.querySelectorAll('a')) {
    const m = /^#cmnt(\d+)$/.exec(a.getAttribute('href') || '')
    if (!m) continue
    quotes.set(m[1], quoteOfBlock(a.closest(BLOCK_SELECTOR), 'a[href^="#cmnt"]'))
  }
  const out: ExtractedComment[] = []
  for (const a of root.querySelectorAll('a[href^="#cmnt_ref"]')) {
    const m = /^#cmnt_ref(\d+)$/.exec(a.getAttribute('href') || '')
    if (!m) continue
    // comment หลายบรรทัดอยู่ใน <div> เดียวกัน — ใช้ <div> เมื่อมันเป็นของ comment นี้ตัวเดียว
    const div = a.closest('div')
    const box = div && div.querySelectorAll('a[href^="#cmnt_ref"]').length === 1 ? div : a.closest('p') || a.parentNode
    if (!box) continue
    const copy = parse(box.toString())
    for (const ref of copy.querySelectorAll('a[href^="#cmnt_ref"]')) ref.remove()
    const paragraphs = copy.querySelectorAll('p')
    const text = (paragraphs.length > 1 ? paragraphs.map((p) => collapse(p.text)).filter(Boolean).join('\n') : collapse(copy.text))
    const quote = quotes.get(m[1])
    out.push(quote ? { text, quote } : { text })
  }
  return finish(out)
}

const TEXT_COMMENT_LINE_RE = /^\[([a-z]{1,3})\]\S/

/**
 * Comment จากไฟล์ .txt / ข้อความที่วาง ซึ่งส่งออกจาก Google Docs:
 * ในเนื้อหามี [a] และท้ายไฟล์มีบรรทัด "[a]ข้อความ comment" (เงื่อนไขเดียวกับ stripGoogleDocsCommentMarkers)
 */
export function extractTextComments(text: string): ExtractedComment[] {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const found: Array<{ label: string; text: string }> = []
  const bodyLines: string[] = []
  for (const line of lines) {
    const m = TEXT_COMMENT_LINE_RE.exec(line)
    if (m) found.push({ label: m[1], text: line.slice(m[0].length - 1).trim() })
    else bodyLines.push(line)
  }
  if (found.length === 0) return []
  const labels = new Set(found.map((f) => f.label))
  const markerRe = /\[([a-z]{1,3})\]/g
  const quoteOf = (label: string): string => {
    const line = bodyLines.find((l) => l.includes(`[${label}]`))
    if (!line) return ''
    return clip(collapse(line.replace(markerRe, (whole, l: string) => (labels.has(l) ? '' : whole))), MAX_QUOTE_CHARS)
  }
  return finish(found.map((f) => {
    const quote = quoteOf(f.label)
    return quote ? { text: f.text, quote } : { text: f.text }
  }))
}

/**
 * Comment จาก .docx ที่แปลงด้วย mammoth พร้อม style map `comment-reference => sup`
 * - จุดในเนื้อหา: <sup><a href="#comment-0" id="comment-ref-0">[SK1]</a></sup>
 * - ข้อความ comment ท้ายเอกสาร: <dl><dt id="comment-0">Comment [SK1]</dt><dd><p>ข้อความ <a href="#comment-ref-0">↑</a></p></dd></dl>
 */
export function extractMammothComments(html: string): ExtractedComment[] {
  if (!html || !/#comment-ref-/i.test(html)) return []
  const root = parse(html, { comment: false })
  const quotes = new Map<string, string>()
  for (const a of root.querySelectorAll('a')) {
    const m = /^#comment-(\d+)$/.exec(a.getAttribute('href') || '')
    if (!m) continue
    quotes.set(m[1], quoteOfBlock(a.closest(BLOCK_SELECTOR), 'a[href^="#comment-"]'))
  }
  const out: ExtractedComment[] = []
  for (const dt of root.querySelectorAll('dt')) {
    const m = /^comment-(\d+)$/.exec(dt.getAttribute('id') || '')
    if (!m) continue
    const dd = dt.nextElementSibling
    if (!dd || dd.tagName.toLowerCase() !== 'dd') continue
    const copy = parse(dd.toString())
    for (const back of copy.querySelectorAll('a[href^="#comment-ref-"]')) back.remove()
    const paragraphs = copy.querySelectorAll('p')
    const text = (paragraphs.length > 0 ? paragraphs.map((p) => collapse(p.text)).filter(Boolean).join('\n') : collapse(copy.text))
    const quote = quotes.get(m[1])
    out.push(quote ? { text, quote } : { text })
  }
  return finish(out)
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID ? c.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** comment ที่อ่านจากไฟล์ → รายการพร้อมเก็บ (ติ๊กไว้ให้เลย ผู้ใช้เอาออกเองได้) */
export function toImportedComments(extracted: ExtractedComment[], now = new Date()): ArticleComment[] {
  const createdAt = now.toISOString()
  return sanitizeArticleComments(extracted.map((c) => ({ id: newId(), source: 'import', text: c.text, quote: c.quote, createdAt, enabled: true })))
}

export function manualComment(text: string, now = new Date()): ArticleComment | null {
  return sanitizeArticleComments([{ id: newId(), source: 'manual', text, createdAt: now.toISOString(), enabled: true }])[0] ?? null
}

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))

const CHANGE_KINDS: ArticleCommentChangeKind[] = ['replace', 'insert', 'delete', 'format']

let wordSegmenter: Intl.Segmenter | null | undefined
/** แบ่งเป็นคำ (ภาษาไทยไม่มีช่องว่างคั่นคำ ต้องใช้ Intl.Segmenter) — ต่อกลับได้ข้อความเดิมทุกตัวอักษร */
function wordsOf(text: string): string[] {
  if (wordSegmenter === undefined) {
    try {
      wordSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null
    } catch {
      wordSegmenter = null
    }
  }
  if (wordSegmenter) return Array.from(wordSegmenter.segment(text), (s) => s.segment)
  return text.split(/(\s+)/).filter(Boolean)
}

/** ต้นข้อความไม่เกิน max ตัวอักษร ตัดที่ขอบคำ (ตัดแล้วเติม …) */
function clipWords(tokens: string[], max: number): string {
  const text = tokens.join('')
  if (text.length <= max) return text
  let out = ''
  for (const t of tokens) {
    if (out.length + t.length > max - 1) break
    out += t
  }
  if (!out.trim()) out = text.slice(0, max - 1)
  return `${out.trimEnd()}…`
}

/** ท้ายข้อความไม่เกิน max ตัวอักษร ตัดที่ขอบคำ (ตัดแล้วเติม … ข้างหน้า) */
function clipWordsFromEnd(tokens: string[], max: number): string {
  const text = tokens.join('')
  if (text.length <= max) return text
  let out = ''
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (out.length + tokens[i].length > max - 1) break
    out = tokens[i] + out
  }
  if (!out.trim()) out = text.slice(-(max - 1))
  return `…${out.trimStart()}`
}

/**
 * สรุปการแก้ 1 จุดจากข้อความล้วนของบล็อกก่อน/หลัง — เก็บเฉพาะท่อนที่ต่างกัน + ข้อความรอบ ๆ สั้น ๆ
 * (ลูกค้าขอแก้วลีเดียว ไม่ควรต้องอ่านทั้งย่อหน้าเพื่อหาว่าอะไรเปลี่ยน)
 */
export function describeChange(kind: 'replace' | 'insert' | 'delete', beforeText: string, afterText: string): ArticleCommentChange {
  const before = collapse(beforeText)
  const after = collapse(afterText)
  if (kind === 'insert') return after ? { kind, after: clipWords(wordsOf(after), MAX_CHANGE_CHARS) } : { kind }
  if (kind === 'delete') return before ? { kind, before: clipWords(wordsOf(before), MAX_CHANGE_CHARS) } : { kind }
  if (before === after) return after ? { kind: 'format', after: clipWords(wordsOf(after), MAX_CHANGE_CHARS) } : { kind: 'format' }

  const a = wordsOf(before)
  const b = wordsOf(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let end = 0
  while (end < a.length - head && end < b.length - head && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const midBefore = a.slice(head, a.length - end).join('')
  const midAfter = b.slice(head, b.length - end).join('')
  // ช่องว่างที่ขอบของท่อนที่แก้ ย้ายไปอยู่กับข้อความรอบ ๆ — ต่อ lead + ท่อนที่แก้ + tail แล้วอ่านได้ปกติ
  const ref = midBefore.trim() ? midBefore : midAfter
  const lead = a.slice(0, head).join('') + (/^\s/.test(ref) ? ' ' : '')
  const tail = (/\s$/.test(ref) ? ' ' : '') + a.slice(a.length - end).join('')
  const out: ArticleCommentChange = { kind: 'replace' }
  if (midBefore.trim()) out.before = clipWords(wordsOf(midBefore.trim()), MAX_CHANGE_CHARS)
  if (midAfter.trim()) out.after = clipWords(wordsOf(midAfter.trim()), MAX_CHANGE_CHARS)
  if (lead.trim()) out.lead = clipWordsFromEnd(wordsOf(lead), MAX_CHANGE_CONTEXT_CHARS)
  if (tail.trim()) out.tail = clipWords(wordsOf(tail), MAX_CHANGE_CONTEXT_CHARS)
  return out
}

/** ช่องว่างซ้อน → ช่องเดียว แต่คงช่องว่างที่ขอบไว้ (lead/tail ต้องต่อกับท่อนที่แก้ได้พอดี) */
const squeeze = (text: string): string => text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')

function sanitizeChanges(raw: unknown, budget: { left: number }): ArticleCommentChange[] {
  if (!Array.isArray(raw)) return []
  const out: ArticleCommentChange[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const kind = CHANGE_KINDS.find((k) => k === r.kind)
    if (!kind) continue
    const before = typeof r.before === 'string' ? collapse(r.before).slice(0, MAX_CHANGE_CHARS) : ''
    const after = typeof r.after === 'string' ? collapse(r.after).slice(0, MAX_CHANGE_CHARS) : ''
    const lead = typeof r.lead === 'string' ? squeeze(r.lead).trimStart().slice(0, MAX_CHANGE_CONTEXT_CHARS) : ''
    const tail = typeof r.tail === 'string' ? squeeze(r.tail).trimEnd().slice(0, MAX_CHANGE_CONTEXT_CHARS) : ''
    const size = before.length + after.length + lead.length + tail.length
    if (size > budget.left) break
    budget.left -= size
    const change: ArticleCommentChange = { kind }
    if (before) change.before = before
    if (after) change.after = after
    if (lead.trim()) change.lead = lead
    if (tail.trim()) change.tail = tail
    out.push(change)
    if (out.length >= MAX_CHANGES_PER_COMMENT) break
  }
  return out
}

/** comment ชุดเดิมที่บันทึกการแก้ถูกแทนที่ (รายการว่าง = ลบบันทึกทิ้ง) */
export function setCommentChanges(comment: ArticleComment, changes: ArticleCommentChange[], more = 0): ArticleComment {
  const next: ArticleComment = { ...comment }
  delete next.changes
  delete next.moreChanges
  if (changes.length > 0) {
    next.changes = changes.slice(0, MAX_CHANGES_PER_COMMENT)
    if (more > 0) next.moreChanges = more
  }
  return next
}

/**
 * รายการ comment ที่หน้าจอส่งมาบันทึก — บันทึกการแก้ใช้ของที่เก็บไว้เสมอ ไม่รับจากหน้าจอ
 * (หน้าจอที่เปิดค้างก่อน AI ปรับจะไม่ลบบันทึกทิ้ง และแต่งบันทึกเองไม่ได้)
 */
export function keepStoredChanges(next: ArticleComment[], stored: ArticleComment[]): ArticleComment[] {
  const byId = new Map(stored.map((c) => [c.id, c]))
  return next.map((c) => {
    const kept = byId.get(c.id)
    return setCommentChanges(c, kept?.changes ?? [], kept?.moreChanges ?? 0)
  })
}

/** ทำความสะอาดรายการ comment จากที่ไหนก็ตาม (body ของ PUT / ค่าที่เก็บไว้) — ตัดของเสีย ของซ้ำ และของที่เกินเพดาน */
export function sanitizeArticleComments(raw: unknown): ArticleComment[] {
  if (!Array.isArray(raw)) return []
  const out: ArticleComment[] = []
  const seen = new Set<string>()
  let total = 0
  const changeBudget = { left: MAX_CHANGE_TOTAL_CHARS }
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const text = typeof r.text === 'string' ? r.text.replace(/\r\n?/g, '\n').trim().slice(0, MAX_COMMENT_CHARS) : ''
    if (!text) continue
    const id = typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : newId()
    if (seen.has(id)) continue
    if (total + text.length > MAX_COMMENT_TOTAL_CHARS) break
    const quote = typeof r.quote === 'string' ? collapse(r.quote).slice(0, MAX_QUOTE_CHARS) : ''
    const comment: ArticleComment = {
      id,
      source: r.source === 'import' ? 'import' : 'manual',
      text,
      createdAt: isIsoDate(r.createdAt) ? r.createdAt : new Date().toISOString(),
      enabled: r.enabled !== false,
    }
    if (quote) comment.quote = quote
    if (isIsoDate(r.appliedAt)) comment.appliedAt = r.appliedAt
    const changes = sanitizeChanges(r.changes, changeBudget)
    if (changes.length > 0) {
      comment.changes = changes
      const more = typeof r.moreChanges === 'number' && Number.isInteger(r.moreChanges) ? Math.min(Math.max(r.moreChanges, 0), 999) : 0
      if (more > 0) comment.moreChanges = more
    }
    seen.add(id)
    total += text.length
    out.push(comment)
    if (out.length >= MAX_COMMENTS_PER_ARTICLE) break
  }
  return out
}

type Prefs = Record<string, unknown>

function commentMap(prefs: Prefs | null | undefined): Record<string, unknown> {
  const raw = prefs?.[ARTICLE_COMMENTS_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

export function readArticleComments(prefs: Prefs | null | undefined, articleId: string): ArticleComment[] {
  return sanitizeArticleComments(commentMap(prefs)[articleId])
}

/** prefs ชุดใหม่ที่ comment ของบทความนี้ถูกแทนที่ (รายการว่าง = ลบ key ของบทความนี้ทิ้ง) */
export function withArticleComments(prefs: Prefs, articleId: string, comments: ArticleComment[]): Prefs {
  const map = { ...commentMap(prefs) }
  const clean = sanitizeArticleComments(comments)
  if (clean.length > 0) map[articleId] = clean
  else delete map[articleId]
  const next = { ...prefs }
  if (Object.keys(map).length > 0) next[ARTICLE_COMMENTS_KEY] = map
  else delete next[ARTICLE_COMMENTS_KEY]
  return next
}

/** comment ที่ยังรอปรับ = ติ๊กไว้และยังไม่เคยถูก AI ปรับ */
export const isPendingComment = (c: ArticleComment): boolean => c.enabled && !c.appliedAt

export interface ArticleCommentCount {
  total: number
  pending: number
}

/** จำนวน comment ต่อบทความ สำหรับป้ายในรายการ (ไม่มี comment = ไม่มี key) */
export function articleCommentCounts(prefs: Prefs | null | undefined): Record<string, ArticleCommentCount> {
  const out: Record<string, ArticleCommentCount> = {}
  for (const [articleId, raw] of Object.entries(commentMap(prefs))) {
    const list = sanitizeArticleComments(raw)
    if (list.length > 0) out[articleId] = { total: list.length, pending: list.filter(isPendingComment).length }
  }
  return out
}
