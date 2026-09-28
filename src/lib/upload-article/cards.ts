// ─── Upload Article — แยกบทความเป็น card ก่อน push ──────────────────────────────
// ใช้แทน parseArticleCards ของ Clients เพราะ HTML ของ Upload Article มีสารบัญ (nav.content-toc)
// อยู่ในบทความจริง และ id ของ H2 ต้องคงเดิม (ลิงก์สารบัญชี้ไปที่ id นั้น)
// string-scan ล้วน ใช้ได้ทั้ง server และ client — head + cards + tail ต่อกันได้ HTML เดิมทุก byte

import { stripTags, type ArticleCard, type ArticleCardType, type ParsedArticle } from '@/lib/articleCards'

import { decodeTextEntities } from './entities'

export type { ArticleCard, ParsedArticle }

const WRAPPER_OPEN = '<div class="content-article">'
const FAQ_HEADING_RE = /FAQ|คำถามที่พบบ่อย|คำถามยอดฮิต|Q\s*&\s*A|ถาม.?ตอบ|frequently asked/i
const TOC_RE = /<nav\b[^>]*class="[^"]*\bcontent-toc\b[^"]*"[^>]*>[\s\S]*?<\/nav>/gi
const CTA_OPEN_RE = /<div\b[^>]*class="[^"]*\b(?:content-cta|cta)\b[^"]*"[^>]*>/gi

interface Range {
  start: number
  end: number
  type: 'toc' | 'cta'
}

/** หาตำแหน่งปิดของ <div> ที่เปิดที่ start (นับ div ซ้อน) — ไม่เจอคืน -1 */
function balancedDivEnd(html: string, start: number): number {
  const re = /<div\b[^>]*>|<\/div\s*>/gi
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else {
      depth++
    }
  }
  return -1
}

/** แยก head (schema/style/wrapper เปิด) body และ tail (wrapper ปิด) */
function splitFrame(html: string): { head: string; body: string; tail: string } {
  const w = html.indexOf(WRAPPER_OPEN)
  if (w !== -1) {
    const headEnd = w + WRAPPER_OPEN.length
    const closeIdx = html.lastIndexOf('</div>')
    if (closeIdx > headEnd) {
      return { head: html.slice(0, headEnd), body: html.slice(headEnd, closeIdx), tail: html.slice(closeIdx) }
    }
  }
  // ไม่มี wrapper (โหมด text) — head = script/style/comment นำหน้า
  const lead = html.match(/^(?:\s|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->)*/i)
  const headLen = lead ? lead[0].length : 0
  return { head: html.slice(0, headLen), body: html.slice(headLen), tail: '' }
}

function specialRanges(body: string): Range[] {
  const ranges: Range[] = []
  for (const m of Array.from(body.matchAll(TOC_RE))) {
    ranges.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, type: 'toc' })
  }
  for (const m of Array.from(body.matchAll(CTA_OPEN_RE))) {
    const s = m.index ?? 0
    if (ranges.some((r) => s >= r.start && s < r.end)) continue
    const e = balancedDivEnd(body, s)
    if (e !== -1) ranges.push({ start: s, end: e, type: 'cta' })
  }
  return ranges.sort((a, b) => a.start - b.start)
}

function headingText(chunk: string, tag: string): string {
  const m = chunk.match(new RegExp(`^\\s*<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? stripTags(m[1]) : ''
}

export function parseUploadCards(html: string): ParsedArticle {
  const { head, body, tail } = splitFrame(html || '')
  let lead = head
  const cards: ArticleCard[] = []
  const headingTag = /<h2\b/i.test(body) ? 'h2' : /<h3\b/i.test(body) ? 'h3' : null
  let seenHeading = false
  let lastLabel = ''

  const push = (type: ArticleCardType, label: string, chunk: string) => {
    // ถอด entity เฉพาะข้อความที่แสดงใน UI (บทความเก่าจาก Google Doc เก็บไทยเป็น &#NNNN;) — html ของ card ไม่แตะ
    cards.push({ id: `${type}-${cards.length}`, type, label: decodeTextEntities(label), html: chunk, plainText: decodeTextEntities(stripTags(chunk)) })
  }
  /** ช่องว่างล้วน — ต่อท้าย card ก่อนหน้า ให้ประกอบกลับได้ byte เดิม */
  const glue = (chunk: string): boolean => {
    if (chunk.trim()) return false
    if (cards.length) cards[cards.length - 1].html += chunk
    else lead += chunk
    return true
  }

  const addNormal = (text: string) => {
    if (!text) return
    const cuts: number[] = []
    if (headingTag) {
      const re = new RegExp(`<${headingTag}\\b`, 'gi')
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) cuts.push(m.index)
    }
    const points = [0, ...cuts.filter((c) => c > 0), text.length]
    for (let i = 0; i < points.length - 1; i++) {
      const chunk = text.slice(points[i], points[i + 1])
      if (glue(chunk)) continue
      const heading = headingTag ? headingText(chunk, headingTag) : ''
      if (heading) {
        seenHeading = true
        lastLabel = heading
        const isFaq = FAQ_HEADING_RE.test(heading) || /content-faq__item/.test(chunk)
        push(isFaq ? 'faq' : 'content', heading, chunk)
      } else if (!seenHeading) {
        const hasTitle = cards.some((c) => c.type === 'title')
        const h1 = chunk.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
        if (!hasTitle) push('title', h1 ? stripTags(h1[1]) : 'ส่วนนำ (Intro)', chunk)
        else push('content', 'ส่วนนำ (ต่อ)', chunk)
      } else {
        const isFaq = /content-faq__item/.test(chunk)
        push(isFaq ? 'faq' : 'content', `${lastLabel} (ต่อ)`, chunk)
      }
    }
  }

  let pos = 0
  for (const r of specialRanges(body)) {
    addNormal(body.slice(pos, r.start))
    const chunk = body.slice(r.start, r.end)
    if (r.type === 'toc') {
      const title = chunk.match(/<p\b[^>]*content-toc__title[^>]*>([\s\S]*?)<\/p>/i)
      push('toc', title ? stripTags(title[1]) : 'สารบัญ', chunk)
    } else {
      const btn = stripTags(chunk).slice(0, 60)
      push('cta', btn ? `CTA: ${btn}` : 'CTA', chunk)
    }
    pos = r.end
  }
  addNormal(body.slice(pos))

  return { head: lead, tail, cards }
}

/** id ของหัวข้อทุกตัวใน html (ใช้ตัดลิงก์สารบัญที่ชี้ไปหัวข้อที่ไม่ได้เลือก) */
function headingIds(html: string): string[] {
  return Array.from(html.matchAll(/<h[23]\b[^>]*\bid="([^"]+)"/gi)).map((m) => m[1])
}

/** ประกอบเฉพาะ card ที่เลือก — สารบัญตัดรายการที่ชี้ไปหัวข้อที่ไม่ได้ส่ง ถ้าเหลือ 0 รายการตัดทั้งกล่อง */
export function assembleUploadHtml(parsed: ParsedArticle, selectedIds: Set<string>): string {
  const dropped = new Set<string>()
  for (const c of parsed.cards) {
    if (!selectedIds.has(c.id)) for (const id of headingIds(c.html)) dropped.add(id)
  }
  const parts: string[] = []
  for (const c of parsed.cards) {
    if (!selectedIds.has(c.id)) continue
    if (c.type === 'toc' && dropped.size) {
      const html = c.html.replace(/<li\b[^>]*>\s*<a\b[^>]*href="#([^"]+)"[^>]*>[\s\S]*?<\/a>\s*<\/li>/gi, (li, id: string) =>
        dropped.has(id) ? '' : li,
      )
      if (!/<li\b/i.test(html)) continue
      parts.push(html)
      continue
    }
    parts.push(c.html)
  }
  return parsed.head + parts.join('') + parsed.tail
}

/**
 * ลายนิ้วมือของ htmlContent (FNV-1a 32 bit + ความยาว) — client ส่งค่านี้มากับ card ที่เลือกตอน push
 * server เทียบกับ htmlContent ปัจจุบัน ถ้าไม่ตรง = บทความถูกแก้หลังโหลดหน้า card ที่เลือกอาจไม่ตรงแล้ว
 * (ห้ามใช้ updatedAt เพราะเปลี่ยนทุกครั้งที่สถานะ push เปลี่ยน ทำให้กด push ซ้ำหลัง fail ไม่ได้)
 */
export function uploadHtmlVersion(html: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < html.length; i++) {
    h ^= html.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${html.length}:${(h >>> 0).toString(16)}`
}
