// ─────────────────────────────────────────────────────────────────────────────
//  วัดโครงบทความตัวอย่างแบบตายตัว (ไม่ใช้ AI / ไม่ fetch / ไม่แตะ DB)
//
//  - analyzeExampleStructure(html): วัด H1 / อินโทร / H2-H3 ทีละส่วน / รวมทั้งบทความ
//  - renderStructuredText(html): แปลง HTML เป็นข้อความที่ยังเห็น list/ตาราง/ย่อหน้า/รูป
//  - formatStructureEvidence / buildOutlineSection: ข้อความภาษาไทยไว้ป้อน AI และต่อท้าย Master Prompt
//
//  ความยาวนับเป็น "ตัวอักษรที่ไม่ใช่ช่องว่าง" เพราะภาษาไทยไม่มีช่องว่างคั่นคำ
//  ตัวตรวจ TOC/FAQ/CTA ใช้ร่วมกับ analyzePostLayout ของ site-scan
// ─────────────────────────────────────────────────────────────────────────────

import { parse, type HTMLElement, type Node } from 'node-html-parser'

import { analyzePostLayout } from './site-scan'

export const OUTLINE_HEADING = '## โครงสร้าง Outline จากบทความตัวอย่าง'

// ── ชนิดข้อมูล ──────────────────────────────────────────────────────────────

export type ExampleBlock =
  | { type: 'h'; level: number; text: string }
  | { type: 'p'; text: string; links: number }
  | { type: 'list'; ordered: boolean; items: string[]; links: number }
  | { type: 'table'; rows: string[][]; links: number }
  | { type: 'quote'; text: string; links: number }
  | { type: 'img'; alt: string }
  | { type: 'mark'; kind: 'summary' | 'faqq' | 'toc' }

export type SectionRole = 'content' | 'faq' | 'conclusion' | 'references' | 'sub'

export interface ExampleSection {
  level: 2 | 3
  heading: string
  role: SectionRole
  /** ตัวอักษรของส่วนนี้เอง (ถึงหัวข้อ H2/H3 ถัดไป) */
  chars: number
  /** เฉพาะ H2: รวมหัวข้อย่อย H3 ที่อยู่ใต้มัน */
  charsWithSubs: number
  paragraphs: number
  lists: number
  listItems: number
  tables: number
  images: number
  blockquotes: number
}

export interface ExampleStructure {
  h1: string | null
  intro: { chars: number; paragraphs: number; lists: number; images: number }
  sections: ExampleSection[]
  totals: {
    chars: number
    h2: number
    h3: number
    paragraphs: number
    avgParagraphChars: number
    /** null = ภาษาไทยไม่มีเครื่องหมายจบประโยคพอให้วัด */
    avgSentenceChars: number | null
    lists: number
    tables: number
    images: number
    blockquotes: number
    links: number
  }
  toc: { found: boolean }
  faq: { found: boolean; sectionIndex: number | null; questions: number }
  cta: { found: boolean; position: string | null }
  summaryBox: { found: boolean; where: 'intro' | 'section' | null; sectionIndex: number | null }
  /** ส่วนอ้างอิงท้ายบทความ (หัวข้อ H2/H3 หรือข้อความสั้น "อ้างอิง" ตามด้วย list) */
  references: { found: boolean; items: number; afterFaq: boolean; inlineNumbers: boolean }
  /** ลำดับส่วนจาก analyzePostLayout (cover/intro/toc/sections/faq/cta) */
  order: string[]
}

// ── แยก HTML เป็น block ─────────────────────────────────────────────────────

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form', 'button', 'head'])
const INLINE_TAGS = new Set(['a', 'span', 'strong', 'b', 'em', 'i', 'u', 'small', 'sup', 'sub', 'mark', 'br', 'abbr', 'code', 'font', 'label', 'cite', 'time'])
const TOC_TAGS = new Set(['div', 'nav', 'section', 'aside', 'ul', 'ol', 'details'])
const TOC_CLASS_RE = /(?<![\w-])(?:toc|table-of-contents|ez-toc[\w-]*|lwptoc[\w-]*|toc_container|ftwp-[\w-]*|joli-toc|wpj-jtoc|rank-math-toc[\w-]*|uagb-toc[\w-]*|kb-table-of-content[\w-]*)(?![\w-])|yoast-table-of-contents|elementor-widget-table-of-contents/i
const TOC_TITLE_RE = /^\s*(?:สารบัญ|สารบัญบทความ|เนื้อหาในบทความ|table of contents|contents)\s*:?\s*$/i
const SUMMARY_CLASS_RE = /takeaway|key-?points?|summary-box|short-answer|tldr|ua-summary|mars-summary/i
const FAQ_Q_CLASS_RE = /faq[\w-]*(?:question|title|q\b)|accordion-?(?:title|header|button)|(?<![\w-])question(?![\w-])/i
const FAQ_HEADING_RE = /คำถามที่พบบ่อย|คำถามยอดฮิต|คำถามที่ถามบ่อย|\bFAQs?\b|Frequently Asked Questions/i
const CONCLUSION_RE = /^\s*(?:สรุป|บทสรุป|สรุปท้ายบทความ|conclusion|final thoughts|สรุปส่งท้าย)/i
const SUMMARY_TITLE_RE = /สรุปประเด็นสำคัญ|key takeaways|คำตอบสั้น|short answer|สรุปสั้น/i
const REFERENCES_TITLE_RE = /^(?:แหล่ง|เอกสาร)?อ้างอิง(?:ข้อมูล)?\s*:?$|^แหล่งที่มา(?:ข้อมูล)?\s*:?$|^references?\s*:?$|^sources?\s*:?$/i
// เลขกำกับอ้างอิงในเนื้อหา เช่น [1] หรือตัวยก <sup>1</sup>
const INLINE_CITATION_RE = /\[\d{1,3}\]|<sup\b[^>]*>\s*(?:<a\b[^>]*>)?\s*\[?\d{1,3}\]?/i
const CTA_HEADING_RE = /ติดต่อ|ปรึกษา|สั่งซื้อ|จองคิว|สนใจ|contact us|get in touch/i

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** จำนวนตัวอักษรที่ไม่ใช่ช่องว่าง */
export function countChars(s: string): number {
  return s.replace(/\s+/g, '').length
}

// บล็อกบทความที่เกี่ยวข้องของธีมไม่ใช่เนื้อหาบทความ ตัดตั้งแต่หัวข้อนี้ถึงท้าย
const RELATED_TAIL_RE = /<h[23]\b[^>]*>\s*(?:<[^>]+>\s*)*(?:บทความที่เกี่ยวข้อง|บทความแนะนำ|บทความอื่น ๆ|บทความอื่นๆ|อ่านบทความอื่น|related (?:posts?|articles?)|you may also like|more articles)\s*(?:<[^>]+>\s*)*<\/h[23]>/i

function cleanHtml(html: string): string {
  const out = html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<noscript\b[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, '')
  const related = RELATED_TAIL_RE.exec(out)
  return related ? out.slice(0, related.index) : out
}

function attrOf(el: HTMLElement, name: string): string {
  return el.getAttribute(name) || ''
}

function linkCount(el: HTMLElement): number {
  return el.querySelectorAll('a[href]').length
}

function isTinyImage(el: HTMLElement): boolean {
  if (/\bemoji\b/i.test(attrOf(el, 'class'))) return true
  const w = Number(attrOf(el, 'width')) || 0
  const h = Number(attrOf(el, 'height')) || 0
  return (w > 0 && w < 40) || (h > 0 && h < 40)
}

function imgBlocks(el: HTMLElement): ExampleBlock[] {
  const out: ExampleBlock[] = []
  const imgs = el.tagName?.toLowerCase() === 'img' ? [el] : el.querySelectorAll('img')
  for (const img of imgs) {
    if (isTinyImage(img)) continue
    out.push({ type: 'img', alt: squash(attrOf(img, 'alt')) })
  }
  return out
}

/** ul/ol ที่ทุกข้อเป็นลิงก์ anchor (#...) = สารบัญ */
function isAnchorList(el: HTMLElement): boolean {
  const lis = el.querySelectorAll('li')
  if (lis.length < 3) return false
  const withAnchor = lis.filter((li) => li.querySelectorAll('a').some((a) => /^#/.test(attrOf(a, 'href')))).length
  return withAnchor / lis.length >= 0.8
}

function tableRows(el: HTMLElement): string[][] {
  return el.querySelectorAll('tr').map((tr) => tr.querySelectorAll('th, td').map((c) => squash(c.text)))
}

/** แปลง HTML ของเนื้อบทความเป็นลำดับ block ตามลำดับในเอกสาร (ตัดสารบัญ/สคริปต์ออก) */
export function parseExampleBlocks(html: string): ExampleBlock[] {
  const root = parse(cleanHtml(html), { blockTextElements: { script: false, style: false } })
  const blocks: ExampleBlock[] = []
  let buf = ''
  let bufLinks = 0

  function flush(): void {
    const t = squash(buf)
    if (t) blocks.push({ type: 'p', text: t, links: bufLinks })
    buf = ''
    bufLinks = 0
  }

  function walk(parent: HTMLElement): void {
    for (const child of parent.childNodes as Node[]) {
      if (child.nodeType === 3) {
        buf += ' ' + child.text
        continue
      }
      if (child.nodeType !== 1) continue
      const el = child as HTMLElement
      const tag = (el.tagName || '').toLowerCase()
      if (!tag || SKIP_TAGS.has(tag)) continue

      const cls = `${attrOf(el, 'class')} ${attrOf(el, 'id')}`
      if (TOC_TAGS.has(tag) && (TOC_CLASS_RE.test(cls) || ((tag === 'ul' || tag === 'ol') && isAnchorList(el)))) {
        flush()
        blocks.push({ type: 'mark', kind: 'toc' })
        continue
      }

      if (tag === 'img') {
        flush()
        blocks.push(...imgBlocks(el))
        continue
      }
      if (INLINE_TAGS.has(tag)) {
        if (el.querySelector('img')) {
          flush()
          blocks.push(...imgBlocks(el))
        }
        if (tag === 'br') buf += ' '
        else {
          buf += ' ' + el.text
          bufLinks += tag === 'a' ? 1 : linkCount(el)
        }
        continue
      }

      flush()
      const h = /^h([1-6])$/.exec(tag)
      if (h) {
        const text = squash(el.text)
        if (!text) continue
        if (TOC_TITLE_RE.test(text)) {
          blocks.push({ type: 'mark', kind: 'toc' })
          continue
        }
        blocks.push({ type: 'h', level: Number(h[1]), text })
        continue
      }
      if (tag === 'ul' || tag === 'ol') {
        const items = el.querySelectorAll('li').map((li) => squash(li.text)).filter(Boolean)
        blocks.push(...imgBlocks(el))
        if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items, links: linkCount(el) })
        continue
      }
      if (tag === 'table') {
        blocks.push(...imgBlocks(el))
        const rows = tableRows(el).filter((r) => r.some(Boolean))
        if (rows.length) blocks.push({ type: 'table', rows, links: linkCount(el) })
        continue
      }
      if (tag === 'blockquote') {
        const text = squash(el.text)
        blocks.push(...imgBlocks(el))
        if (text) blocks.push({ type: 'quote', text, links: linkCount(el) })
        continue
      }
      if (tag === 'p') {
        blocks.push(...imgBlocks(el))
        const text = squash(el.text)
        if (text) blocks.push({ type: 'p', text, links: linkCount(el) })
        continue
      }
      if (tag === 'summary') {
        const text = squash(el.text)
        if (text) {
          blocks.push({ type: 'mark', kind: 'faqq' })
          blocks.push({ type: 'p', text, links: 0 })
        }
        continue
      }

      // กล่องทั่วไป — มาร์กกล่องสรุป/คำถาม FAQ แล้วเดินต่อข้างใน
      if (SUMMARY_CLASS_RE.test(cls)) blocks.push({ type: 'mark', kind: 'summary' })
      else if (FAQ_Q_CLASS_RE.test(cls) && !el.querySelector('p, li, h1, h2, h3, h4')) blocks.push({ type: 'mark', kind: 'faqq' })
      walk(el)
      flush()
    }
  }

  walk(root)
  flush()
  return blocks
}

// ── แปลงเป็นข้อความที่คงโครงสร้าง ───────────────────────────────────────────

/** HTML → ข้อความที่ยังเห็น heading(#) / list(- , 1.) / ตาราง(| a | b |) / quote(>) / รูป([รูป: alt]) */
export function renderStructuredText(html: string): string {
  const out: string[] = []
  for (const b of parseExampleBlocks(html)) {
    if (b.type === 'h') out.push(`${'#'.repeat(b.level)} ${b.text}`)
    else if (b.type === 'p') out.push(b.text)
    else if (b.type === 'list') out.push(b.items.map((t, i) => (b.ordered ? `${i + 1}. ${t}` : `- ${t}`)).join('\n'))
    else if (b.type === 'table') out.push(b.rows.map((r) => `| ${r.join(' | ')} |`).join('\n'))
    else if (b.type === 'quote') out.push(`> ${b.text}`)
    else if (b.type === 'img') out.push(`[รูป: ${b.alt}]`)
  }
  return out.join('\n\n')
}

// ── วัดโครงสร้าง ────────────────────────────────────────────────────────────

function emptySection(level: 2 | 3, heading: string): ExampleSection {
  const role: SectionRole = REFERENCES_TITLE_RE.test(heading) ? 'references' : FAQ_HEADING_RE.test(heading) ? 'faq' : CONCLUSION_RE.test(heading) ? 'conclusion' : level === 3 ? 'sub' : 'content'
  return { level, heading, role, chars: 0, charsWithSubs: 0, paragraphs: 0, lists: 0, listItems: 0, tables: 0, images: 0, blockquotes: 0 }
}

function splitSentences(text: string): string[] {
  return text.split(/[.!?…]+(?=\s|$)|[\n\r]+/).map((s) => s.trim()).filter(Boolean)
}

const CTA_POSITION_LABEL = {
  beforeFaq: 'หลังเนื้อหาหลัก ก่อน FAQ',
  afterFaq: 'ท้ายบทความ หลัง FAQ',
  end: 'ท้ายบทความ',
  early: 'ก่อนเริ่มเนื้อหาหลัก',
} as const

/** วัดโครงบทความจาก HTML เนื้อหา — ว่างคืน null */
export function analyzeExampleStructure(html: string): ExampleStructure | null {
  const clean = cleanHtml(html || '')
  const blocks = parseExampleBlocks(clean)
  if (!blocks.some((b) => b.type !== 'mark' && !(b.type === 'img'))) return null

  let h1: string | null = null
  const intro = { chars: 0, paragraphs: 0, lists: 0, images: 0 }
  const sections: ExampleSection[] = []
  let cur: ExampleSection | null = null
  let currentH2: ExampleSection | null = null
  let tocFound = false
  let faqQuestions = 0
  let faqQuestionMarks = 0
  let faqSubHeadings = 0
  let summaryWhere: 'intro' | 'section' | null = null
  let summarySection: number | null = null
  let pendingSummaryMark = false
  let refsFound = false
  let refsItems = 0
  let refsAfterFaq = false
  let refsTitlePending = false
  let totalLinks = 0
  let totalChars = 0
  let paragraphs = 0
  let paragraphChars = 0
  let sentenceCount = 0
  let sentenceChars = 0
  const faqIdx = () => sections.findIndex((s) => s.role === 'faq')

  const addChars = (n: number) => {
    totalChars += n
    if (cur) {
      cur.chars += n
      if (cur.level === 3 && currentH2) currentH2.charsWithSubs += n
      else cur.charsWithSubs += n
    } else intro.chars += n
  }

  for (const b of blocks) {
    if (b.type === 'mark') {
      if (b.kind === 'toc') tocFound = true
      else if (b.kind === 'faqq') faqQuestionMarks++
      else pendingSummaryMark = true
      continue
    }
    if (b.type === 'h') {
      if (b.level === 1) {
        if (h1 === null) h1 = b.text
        continue
      }
      if (b.level === 2 || b.level === 3) {
        const s = emptySection(b.level as 2 | 3, b.text)
        // H3 ใต้ FAQ = คำถาม
        if (b.level === 3 && currentH2?.role === 'faq') faqSubHeadings++
        if (b.level === 2) currentH2 = s
        else if (!currentH2) s.role = 'sub'
        sections.push(s)
        cur = s
        if (SUMMARY_TITLE_RE.test(b.text)) {
          summaryWhere = summaryWhere ?? 'section'
          summarySection = summarySection ?? sections.length - 1
        }
        continue
      }
      // h4-h6: นับเป็นข้อความในส่วนปัจจุบัน
      addChars(countChars(b.text))
      continue
    }

    if (pendingSummaryMark) {
      pendingSummaryMark = false
      if (summaryWhere === null) {
        summaryWhere = cur ? 'section' : 'intro'
        summarySection = cur ? sections.indexOf(cur) : null
      }
    }

    // อ้างอิงแบบไม่ใช้ heading: <p>อ้างอิง</p><ul>…</ul> — ไม่นับเป็นเนื้อหาของหัวข้อก่อนหน้า
    if (b.type === 'p' && REFERENCES_TITLE_RE.test(b.text)) {
      refsFound = true
      refsAfterFaq = faqIdx() !== -1
      refsTitlePending = true
      continue
    }
    if (refsTitlePending) {
      refsTitlePending = false
      if (b.type === 'list') {
        refsItems += b.items.length
        totalLinks += b.links
        continue
      }
    }
    if (b.type === 'list' && cur?.role === 'references') refsItems += b.items.length

    if (b.type === 'p') {
      const n = countChars(b.text)
      addChars(n)
      paragraphs++
      paragraphChars += n
      const sents = splitSentences(b.text)
      sentenceCount += sents.length
      sentenceChars += sents.reduce((a, s) => a + countChars(s), 0)
      totalLinks += b.links
      if (cur) cur.paragraphs++
      else intro.paragraphs++
      if (!cur && SUMMARY_TITLE_RE.test(b.text.slice(0, 40)) && summaryWhere === null) summaryWhere = 'intro'
    } else if (b.type === 'list') {
      const n = b.items.reduce((a, t) => a + countChars(t), 0)
      addChars(n)
      totalLinks += b.links
      if (cur) {
        cur.lists++
        cur.listItems += b.items.length
      } else intro.lists++
    } else if (b.type === 'table') {
      addChars(b.rows.reduce((a, r) => a + r.reduce((x, c) => x + countChars(c), 0), 0))
      totalLinks += b.links
      if (cur) cur.tables++
    } else if (b.type === 'quote') {
      addChars(countChars(b.text))
      totalLinks += b.links
      if (cur) cur.blockquotes++
    } else if (b.type === 'img') {
      if (cur) cur.images++
      else intro.images++
    }
  }

  // นับ H3 ที่เป็นคำถามภายใต้ FAQ — ใช้ค่าที่มากสุดจากตัวนับต่าง ๆ
  faqQuestions = Math.max(faqSubHeadings, faqQuestionMarks)
  const faqAt = faqIdx()
  const refAt = sections.findIndex((s) => s.role === 'references')
  if (refAt !== -1) {
    refsFound = true
    refsAfterFaq = faqAt !== -1 && refAt > faqAt
  }

  const h2 = sections.filter((s) => s.level === 2).length
  const h3 = sections.filter((s) => s.level === 3).length
  const images = intro.images + sections.reduce((a, s) => a + s.images, 0)
  const lists = intro.lists + sections.reduce((a, s) => a + s.lists, 0)
  const tables = sections.reduce((a, s) => a + s.tables, 0)
  const blockquotes = sections.reduce((a, s) => a + s.blockquotes, 0)

  // ใช้ตัวตรวจ TOC/FAQ/CTA ร่วมกับ site-scan
  const layout = analyzePostLayout(clean)
  const order = layout?.order ?? []
  const hasCtaByClass = order.includes('cta')
  const ctaHeadingAt = sections.findIndex((s) => CTA_HEADING_RE.test(s.heading))
  let ctaPosition: string | null = null
  if (hasCtaByClass) {
    const ci = order.indexOf('cta')
    const fi = order.indexOf('faq')
    const si = order.indexOf('sections')
    if (si !== -1 && ci < si) ctaPosition = CTA_POSITION_LABEL.early
    else if (fi !== -1) ctaPosition = ci > fi ? CTA_POSITION_LABEL.afterFaq : CTA_POSITION_LABEL.beforeFaq
    else ctaPosition = CTA_POSITION_LABEL.end
  } else if (ctaHeadingAt !== -1) {
    ctaPosition = ctaHeadingAt === sections.length - 1 ? CTA_POSITION_LABEL.end : `หัวข้อที่ ${ctaHeadingAt + 1}`
  }

  const sentencesMeaningful = paragraphs > 0 && sentenceCount >= paragraphs * 1.3
  return {
    h1,
    intro,
    sections,
    totals: {
      chars: totalChars,
      h2,
      h3,
      paragraphs,
      avgParagraphChars: paragraphs ? Math.round(paragraphChars / paragraphs) : 0,
      avgSentenceChars: sentencesMeaningful ? Math.round(sentenceChars / sentenceCount) : null,
      lists,
      tables,
      images,
      blockquotes,
      links: totalLinks,
    },
    toc: { found: tocFound || order.includes('toc') },
    faq: { found: faqAt !== -1 || order.includes('faq') || faqQuestionMarks > 0, sectionIndex: faqAt === -1 ? null : faqAt, questions: faqQuestions },
    cta: { found: hasCtaByClass || ctaHeadingAt !== -1, position: ctaPosition },
    summaryBox: { found: summaryWhere !== null, where: summaryWhere, sectionIndex: summarySection },
    references: { found: refsFound, items: refsItems, afterFaq: refsAfterFaq, inlineNumbers: INLINE_CITATION_RE.test(clean) },
    order,
  }
}

// ── ข้อความภาษาไทยจากผลวัด ──────────────────────────────────────────────────

export interface LabeledStructure {
  label: string
  structure: ExampleStructure
}

const ROLE_LABEL: Record<SectionRole, string> = {
  content: 'เนื้อหาหลัก',
  faq: 'FAQ',
  conclusion: 'สรุปท้ายบทความ',
  references: 'อ้างอิง',
  sub: 'หัวข้อย่อย',
}

function approx(n: number): number {
  if (n < 100) return Math.round(n / 10) * 10
  return Math.round(n / 50) * 50
}

function sectionFormat(s: ExampleSection): string {
  const parts: string[] = []
  parts.push(s.paragraphs ? `ย่อหน้า ${s.paragraphs}` : 'ไม่มีย่อหน้า')
  if (s.lists) parts.push(`list ${s.lists} ชุด (${s.listItems} ข้อ)`)
  if (s.tables) parts.push(`ตาราง ${s.tables}`)
  if (s.images) parts.push(`รูป ${s.images}`)
  if (s.blockquotes) parts.push(`quote ${s.blockquotes}`)
  return parts.join(', ')
}

function outlineLines(st: ExampleStructure, withHeading: boolean): string[] {
  const lines: string[] = []
  let n = 0
  if (st.h1) lines.push(withHeading ? `H1: "${st.h1}"` : 'H1: 1 อัน')
  const introFmt = [`ย่อหน้า ${st.intro.paragraphs}`, st.intro.lists ? `list ${st.intro.lists}` : '', st.intro.images ? `รูป ${st.intro.images}` : ''].filter(Boolean).join(', ')
  lines.push(`0. เกริ่นนำ (ก่อน H2 แรก) — ประมาณ ${approx(st.intro.chars)} ตัวอักษร; ${introFmt}`)
  if (st.toc.found) lines.push('   (มีสารบัญตามหลังเกริ่นนำ)')
  if (st.summaryBox.found && st.summaryBox.where === 'intro') lines.push('   (มีกล่องสรุปประเด็นสำคัญในช่วงเกริ่นนำ)')
  for (const s of st.sections) {
    n++
    const tag = s.level === 2 ? 'H2' : '  H3'
    const len = s.level === 2 && s.charsWithSubs > s.chars ? `${approx(s.charsWithSubs)} ตัวอักษร (รวมหัวข้อย่อย)` : `${approx(s.chars)} ตัวอักษร`
    const head = withHeading ? ` "${s.heading}"` : ''
    lines.push(`${n}. ${tag}${head} [${ROLE_LABEL[s.role]}] — ประมาณ ${len}; ${sectionFormat(s)}`)
  }
  if (st.references.found) {
    const where = st.references.afterFaq ? ' อยู่หลัง FAQ' : ''
    lines.push(`อ้างอิง: มีส่วนอ้างอิงท้ายบทความ${st.references.items ? ` ${st.references.items} แหล่ง` : ''}${where} (ใส่เฉพาะแหล่งที่ระบบให้มา ไม่มีให้ก็ไม่ต้องมีส่วนนี้ ห้ามแต่งแหล่งเอง${st.references.inlineNumbers ? '' : ' และห้ามใส่เลขกำกับอ้างอิงอย่าง [1] ในเนื้อหา เพราะตัวอย่างไม่ได้ใช้'})`)
  }
  if (st.cta.found) lines.push(`CTA: ${st.cta.position ?? 'มี'}`)
  return lines
}

function rangeOf(nums: number[]): string {
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  return lo === hi ? `${lo}` : `${lo}-${hi}`
}

/** ข้อความหลักฐานที่วัดได้จริง ไว้ป้อน AI (ห้ามนับเอง) */
export function formatStructureEvidence(items: LabeledStructure[]): string {
  const out: string[] = ['ผลวัดโครงสร้างจริงจากบทความตัวอย่าง (วัดด้วยโปรแกรมจากบทความเต็ม ไม่ใช่ประมาณ — ห้ามนับหรือเดาโครงสร้างซ้ำ ให้ใช้ตัวเลขนี้):']
  for (const { label, structure: st } of items) {
    const t = st.totals
    out.push('', `[${label}]`)
    out.push(`- รวม ${t.chars} ตัวอักษร | H2 ${t.h2} | H3 ${t.h3} | ย่อหน้า ${t.paragraphs} (เฉลี่ย ${t.avgParagraphChars} ตัวอักษร/ย่อหน้า)`)
    out.push(`- ความยาวประโยคเฉลี่ย: ${t.avgSentenceChars === null ? 'วัดไม่ได้ (ภาษาไทยไม่มีเครื่องหมายจบประโยค ให้ดูจากความยาวย่อหน้า)' : `${t.avgSentenceChars} ตัวอักษร`}`)
    out.push(`- list ${t.lists} | ตาราง ${t.tables} | รูป ${t.images} | quote ${t.blockquotes} | ลิงก์ ${t.links}`)
    out.push(`- สารบัญ: ${st.toc.found ? 'มี' : 'ไม่มี'} | FAQ: ${st.faq.found ? `มี${st.faq.questions ? ` ${st.faq.questions} ข้อ` : ''}` : 'ไม่มี'} | CTA: ${st.cta.found ? st.cta.position ?? 'มี' : 'ไม่มี'} | กล่องสรุปประเด็นสำคัญ: ${st.summaryBox.found ? 'มี' : 'ไม่มี'}`)
    if (st.order.length) out.push(`- ลำดับส่วนที่ตรวจพบ: ${st.order.join(' > ')}`)
    out.push('- โครง outline เรียงตามจริง:')
    out.push(...outlineLines(st, true).map((l) => `  ${l}`))
  }
  return out.join('\n')
}

/** ส่วนที่ต่อท้าย Master Prompt แบบตายตัว — ไม่ผ่าน AI */
export function buildOutlineSection(items: LabeledStructure[]): string {
  if (!items.length) return ''
  const out: string[] = [OUTLINE_HEADING, '']
  if (items.length === 1) {
    out.push('ลำดับหัวข้อจริงของบทความตัวอย่าง (วัดด้วยโปรแกรม) เรียงตามนี้:')
    out.push(...outlineLines(items[0].structure, false))
  } else {
    items.forEach(({ label, structure }) => {
      out.push(`${label}:`)
      out.push(...outlineLines(structure, false).map((l) => `  ${l}`))
      out.push('')
    })
    const ss = items.map((i) => i.structure)
    out.push('ช่วงที่เจอร่วมกันของตัวอย่างทั้งหมด:')
    out.push(`- จำนวน H2: ${rangeOf(ss.map((s) => s.totals.h2))} | H3: ${rangeOf(ss.map((s) => s.totals.h3))}`)
    out.push(`- ความยาวรวม: ${rangeOf(ss.map((s) => approx(s.totals.chars)))} ตัวอักษร`)
    out.push(`- เกริ่นนำ: ${rangeOf(ss.map((s) => approx(s.intro.chars)))} ตัวอักษร`)
    out.push(`- ความยาวเฉลี่ยต่อย่อหน้า: ${rangeOf(ss.map((s) => s.totals.avgParagraphChars))} ตัวอักษร`)
    out.push(`- list: ${rangeOf(ss.map((s) => s.totals.lists))} ชุด | ตาราง: ${rangeOf(ss.map((s) => s.totals.tables))} | รูป: ${rangeOf(ss.map((s) => s.totals.images))}`)
    out.push(`- มีสารบัญ ${ss.filter((s) => s.toc.found).length}/${ss.length} ชิ้น | มี FAQ ${ss.filter((s) => s.faq.found).length}/${ss.length} ชิ้น | มี CTA ${ss.filter((s) => s.cta.found).length}/${ss.length} ชิ้น`)
  }
  out.push(
    '',
    'กติกาการใช้โครงนี้:',
    '- เรียงส่วนต่าง ๆ ตามลำดับนี้ จำนวนส่วนเท่านี้ (หลายตัวอย่างให้อยู่ในช่วงที่เจอร่วมกัน) รูปแบบของแต่ละส่วน (ย่อหน้า/list/ตาราง/รูป) และความยาวโดยประมาณตามที่ระบุ',
    '- ตั้งชื่อหัวข้อใหม่ให้ตรงกับหัวข้อของบทความใหม่ ห้ามใช้ชื่อหัวข้อของตัวอย่าง',
    '- ห้ามคัดลอกข้อเท็จจริง ตัวเลข ชื่อแบรนด์ หรือประโยคจากบทความตัวอย่างมาใส่ในบทความใหม่',
  )
  return out.join('\n').trim()
}
