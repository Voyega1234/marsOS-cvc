// ─── Upload Article — Import Outline ───
// ทีมนำเข้า outline ของตัวเอง (ไฟล์ / วางข้อความ / Google Doc / โฟลเดอร์ Drive) แล้วให้ AI เขียนเต็มบทความตาม outline นั้น
// กติกา (เจ้าของสั่ง 2026-11-10):
// - หัวข้อใน outline ต้องอยู่ในบทความครบทุกข้อ ข้อความตรงทุกคำ ลำดับเดิม
// - เพิ่มเนื้อหา/หัวข้อเสริมได้ แต่ห้ามตัด ห้ามสลับ ห้ามเปลี่ยนชื่อ
// - ตอนเขียนจาก outline ไม่ใช้ส่วน "โครงสร้าง Outline จากบทความตัวอย่าง" ใน Master Prompt — ที่เหลือของ Master Prompt ใช้ตามเดิม
// - keyword ที่ไม่มี outline เขียนแบบเดิมทุกอย่าง (ไฟล์นี้ไม่ถูกเรียก)
// ไม่มี dependency ฝั่ง server — ใช้ได้ทั้ง route และ test

import { decodeTextEntities } from './entities'
import { OUTLINE_HEADING } from './example-structure'

export interface OutlineItem {
  /** ระดับหัวข้อ 2-6 (H1 แยกเป็น title) */
  level: number
  text: string
  /** แนวเนื้อหาใต้หัวข้อนี้ (ไม่ใช่หัวข้อ) — ส่งให้ AI เป็นแนวทาง ไม่พิมพ์ออกมาตรง ๆ */
  notes?: string
}

export interface UploadOutline {
  items: OutlineItem[]
  /** แนวทางที่อยู่ก่อนหัวข้อแรก (เช่น บรีฟบทนำ) */
  notes?: string
  source: 'file' | 'paste' | 'gdoc' | 'gdrive'
  sourceName: string
  importedAt: string
}

export interface ParsedOutline {
  title: string
  keyword: string
  slug: string
  items: OutlineItem[]
  notes: string
}

/** จำกัดขนาดที่เก็บใน pushPrefs (keywordPlan เป็น JSON ก้อนเดียว) */
export const OUTLINE_MAX_ITEMS = 80
export const OUTLINE_ITEM_TEXT_MAX = 300
export const OUTLINE_NOTE_MAX = 1500
export const OUTLINE_TOTAL_NOTES_MAX = 12000

// "H2: ข้อความ" / "H2 - ข้อความ" / "[H2] ข้อความ" / "(H2) ข้อความ" / "<H2> ข้อความ" / "H2 ข้อความ" — แต่ไม่ใช่ "H2O"
const PREFIX_RE = /^\s*(?:[[(<{]\s*H([1-6])\s*[\])>}]|H([1-6])(?=[\s:：\-–—.)]))\s*[:：\-–—.)]?\s*(.*)$/i
// markdown "## ข้อความ"
const MD_RE = /^\s*(#{1,6})\s+(.+)$/
// "Keyword: ..." / "คีย์เวิร์ด: ..." / "Title: ..." / "Slug: ..."
const META_RE = /^\s*(main\s*(?:keyword|kw)|focus\s*(?:keyword|kw)|keyword|คีย์เวิร์ด(?:หลัก)?|คำค้น(?:หลัก)?|seo\s*title|title|ชื่อบทความ|หัวข้อบทความ|slug|url\s*slug)\s*[:：]\s*(.+)$/i

const BLOCK_END_RE = /<\/(p|div|li|ul|ol|blockquote|pre|section|article|header|footer|dd|dt)\s*>|<br\s*\/?>/gi

function stripTagsText(html: string): string {
  return decodeTextEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .trim()
}

/** HTML → บรรทัด: หัวข้อจริงติดป้าย @@Hn@@, แถวตาราง @@ROW@@, รายการ @@LI@@ */
function htmlToLines(html: string): string[] {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
  // ลิงก์ในบรีฟเป็นแหล่งข้อมูล — เก็บ URL ไว้เมื่อข้อความลิงก์ไม่ใช่ URL เอง
  s = s.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, inner: string) => {
    const text = stripTagsText(inner)
    return !text || text === href ? ` ${href} ` : `${inner} (${href})`
  })
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, n: string, inner: string) => `\n@@H${n}@@${stripTagsText(inner)}\n`)
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (_m, inner: string) => {
    const cells = Array.from(inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)).map((c) => stripTagsText(c[1])).filter(Boolean)
    return `\n@@ROW@@${cells.join('\t')}\n`
  })
  s = s.replace(/<li\b[^>]*>/gi, '\n@@LI@@')
  s = s.replace(BLOCK_END_RE, '\n')
  return s
    .split('\n')
    .map((l) => (l.startsWith('@@H') || l.startsWith('@@ROW@@') ? l : l.startsWith('@@LI@@') ? `@@LI@@${stripTagsText(l.slice(6))}` : stripTagsText(l)))
    .map((l) => l.trim())
    .filter(Boolean)
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trim() : text
}

function headingFromLine(line: string): { level: number; text: string } | null {
  const p = PREFIX_RE.exec(line)
  if (p) {
    const text = p[3].trim()
    if (text) return { level: Number(p[1] || p[2]), text }
    return null
  }
  const md = MD_RE.exec(line)
  if (md) return { level: md[1].length, text: md[2].trim() }
  return null
}

/**
 * อ่าน outline จาก HTML ที่ importer แปลงมาแล้ว (ไฟล์ / ข้อความ / Google Doc)
 * หัวข้อ = แท็ก h1-h6 จริง หรือบรรทัดที่ขึ้นต้นด้วย H2: / [H2] / ## — ข้อความอื่นเป็นแนวเนื้อหาของหัวข้อก่อนหน้า
 * หัวข้อ H1 แรกเป็นชื่อบทความ (H1 อื่นลดเป็น H2 เพราะบทความมี H1 ได้อันเดียว)
 */
export function parseOutlineFromHtml(html: string): ParsedOutline {
  const items: Array<OutlineItem & { noteLines: string[] }> = []
  const lead: string[] = []
  let title = ''
  let keyword = ''
  let mainKeyword = ''
  let slug = ''

  const addHeading = (level: number, rawText: string) => {
    // หัวข้อจริงที่ข้างในยังมี "H3: ..." — ใช้ระดับตามป้ายที่ทีมเขียนไว้
    const inner = headingFromLine(rawText)
    const lv = inner ? inner.level : level
    const text = clip((inner ? inner.text : rawText).replace(/\s+/g, ' ').trim(), OUTLINE_ITEM_TEXT_MAX)
    if (!text) return
    if (lv === 1 && !title && items.length === 0) {
      title = text
      return
    }
    items.push({ level: lv === 1 ? 2 : lv, text, noteLines: [] })
  }

  for (const raw of htmlToLines(html)) {
    const hTag = /^@@H([1-6])@@(.*)$/.exec(raw)
    if (hTag) {
      addHeading(Number(hTag[1]), hTag[2])
      continue
    }
    if (raw.startsWith('@@ROW@@')) {
      // ตารางบรีฟ: แถว "H2 | ข้อความ" เป็นหัวข้อ, แถว "Keyword | ..." เป็นข้อมูลบทความ, ที่เหลือข้าม
      // เซลล์คั่นด้วย tab: ป้าย | ค่า | (คอลัมน์อื่นเช่น Search Volume ข้าม)
      const cells = raw.slice(7).split('\t').map((c) => c.trim()).filter(Boolean)
      const label = cells[0] ?? ''
      const value = cells[1] ?? ''
      const lvCell = /^H([1-6])\s*[:：]?$/i.exec(label)
      if (lvCell && value) addHeading(Number(lvCell[1]), value)
      else {
        const joined = cells.join(' ')
        const h = headingFromLine(joined)
        if (h) addHeading(h.level, joined)
        else if (/^(main\s*(?:keyword|kw)|focus\s*(?:keyword|kw)|keyword|kw|คีย์เวิร์ด(?:หลัก)?|slug|url\s*slug)\s*[:：]?$/i.test(label) && value) applyMeta(label, value)
      }
      continue
    }
    const isLi = raw.startsWith('@@LI@@')
    const line = (isLi ? raw.slice(6) : raw).replace(/^[-•*●▪◦]\s+/, '').trim()
    if (!line) continue
    const h = headingFromLine(line)
    if (h) {
      addHeading(h.level, line)
      continue
    }
    const meta = META_RE.exec(line)
    if (meta && applyMeta(meta[1], meta[2])) continue
    const noteLine = isLi ? `- ${line}` : line
    if (items.length) items[items.length - 1].noteLines.push(noteLine)
    else lead.push(noteLine)
  }

  function applyMeta(label: string, value: string): boolean {
    const v = value.trim()
    if (!v) return false
    const l = label.toLowerCase()
    if (/slug/.test(l)) {
      if (!slug) slug = v
      return true
    }
    if (/title|ชื่อบทความ|หัวข้อบทความ/.test(l)) {
      if (!title) title = clip(v, OUTLINE_ITEM_TEXT_MAX)
      return true
    }
    // หัวคอลัมน์ตาราง ("Keyword | Search Volume") ไม่ใช่ keyword
    if (/^(search\s*)?volume$|^sv$|^kd$|^difficulty$/i.test(v)) return true
    if (/main|focus|หลัก/.test(l)) {
      if (!mainKeyword) mainKeyword = clip(v, 200)
    } else if (!keyword) keyword = clip(v, 200)
    return true
  }

  let budget = OUTLINE_TOTAL_NOTES_MAX
  const take = (lines: string[]) => {
    const text = clip(lines.join('\n').trim(), Math.min(OUTLINE_NOTE_MAX, Math.max(0, budget)))
    budget -= text.length
    return text
  }
  const notes = take(lead)
  const out = items.slice(0, OUTLINE_MAX_ITEMS).map(({ noteLines, ...it }) => {
    const n = take(noteLines)
    return n ? { ...it, notes: n } : it
  })
  return { title, keyword: mainKeyword || keyword, slug, items: out, notes }
}

// ─── Master Prompt: ตัดส่วน outline จากบทความตัวอย่าง ───

function stripOutlineText(text: string): string {
  const idx = text.indexOf(OUTLINE_HEADING)
  if (idx === -1) return text
  const after = text.slice(idx + OUTLINE_HEADING.length)
  const next = after.search(/\n#{1,2} (?!#)/)
  const before = text.slice(0, idx).replace(/\s+$/, '')
  const rest = next === -1 ? '' : after.slice(next).replace(/^\s+/, '')
  return [before, rest].filter(Boolean).join('\n\n')
}

/**
 * ตัดส่วน "## โครงสร้าง Outline จากบทความตัวอย่าง" ออกจาก Master Prompt (ตั้งแต่หัวข้อนั้นถึงหัวข้อ ## ถัดไปหรือจบข้อความ)
 * Master Prompt แบบ JSON ที่ส่วนนี้อยู่ในค่า string ก็ตัดให้ ส่วนอื่นไม่แตะ
 */
export function stripMasterOutlineSection(text: string): string {
  if (!text.includes(OUTLINE_HEADING)) return text
  const head = text.trimStart()[0]
  if (head === '{' || head === '[') {
    try {
      const walk = (v: unknown): unknown => {
        if (typeof v === 'string') return stripOutlineText(v)
        if (Array.isArray(v)) return v.map(walk)
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]))
        }
        return v
      }
      return JSON.stringify(walk(JSON.parse(text)), null, 2)
    } catch {
      // JSON ที่มีข้อความต่อท้าย (outline ถูกต่อหลัง JSON) — ตัดแบบข้อความ
    }
  }
  return stripOutlineText(text)
}

// ─── คำสั่งเขียน ───

function headingTag(level: number): string {
  return `h${Math.min(6, Math.max(2, level))}`
}

/** outline แบบอ่านง่าย (ใช้เป็นหัวข้อของบทความสำหรับจับคู่สินค้า/ข้อจำกัด) */
export function outlineAsText(outline: Pick<UploadOutline, 'items'>): string {
  return outline.items.map((it) => `${'  '.repeat(Math.max(0, it.level - 2))}${it.text}`).join('\n')
}

/** บล็อกใน user prompt — แทนที่โครงหัวข้อจากทุกแหล่ง (Master Prompt / Intent / ตัวอย่าง) ด้วย outline นี้ */
export function outlineWriterBlock(outline: Pick<UploadOutline, 'items' | 'notes'>, language?: 'th' | 'en'): string {
  const lines: string[] = [
    '# OUTLINE ของบทความนี้ (ทีมกำหนดมา — เป็นโครงบทความเพียงชุดเดียวที่ใช้)',
    'กติกา outline (สำคัญกว่าคำแนะนำเรื่องโครงหัวข้อ/ลำดับหัวข้อ/จำนวน H2-H3 จากทุกส่วนด้านบน — ส่วนอื่นของ Master Prompt, Business Skill, Article Brief, ข้อจำกัด และ Validator Pack ยังต้องทำตามทั้งหมด):',
    '- ทุกหัวข้อด้านล่างต้องอยู่ในบทความครบทุกข้อ ใช้แท็กตามระดับที่กำหนด (<h2>/<h3>/...) และข้อความหัวข้อต้องตรงทุกตัวอักษร (รวมตัวเลข เครื่องหมาย และเว้นวรรค)',
    '- เรียงตามลำดับนี้เท่านั้น ห้ามสลับ ห้ามตัด ห้ามรวมหัวข้อ ห้ามเปลี่ยนชื่อ ห้ามแปล ห้ามย่อ ห้ามขยายชื่อหัวข้อ ห้ามเปลี่ยนระดับหัวข้อ',
    '- เพิ่มได้: เนื้อหาเชิงลึก ตัวอย่าง ตาราง list และหัวข้อย่อย/หัวข้อเสริมที่ช่วยผู้อ่าน (แทรกได้ทุกตำแหน่ง ตราบใดที่หัวข้อของ outline ยังครบและเรียงเดิม)',
    '- ทุกหัวข้อต้องมีเนื้อหาจริงใต้หัวข้อ ห้ามปล่อยหัวข้อว่าง',
    '- ข้อความ "แนวเนื้อหา" ใต้หัวข้อคือบรีฟว่าต้องเขียนอะไร ห้ามพิมพ์บรีฟออกมาตรง ๆ และห้ามทำเป็นหัวข้อ',
    '- กฎภาษามนุษย์ (Human Voice) ห้ามใช้กับข้อความหัวข้อของ outline — หัวข้อ outline ต้องคงตามที่ให้ไว้',
    '- ถ้า outline มีหัวข้อ FAQ / สรุป / บทสรุป อยู่แล้ว ให้ใช้หัวข้อนั้น (ข้อความตาม outline) ห้ามสร้างส่วนเดียวกันซ้ำ',
    '- เกริ่นนำก่อนหัวข้อแรกเขียนได้ตามปกติ',
    '',
  ]
  if (outline.notes) {
    lines.push('แนวเนื้อหาภาพรวม / บทนำ:')
    lines.push(outline.notes)
    lines.push('')
  }
  lines.push('หัวข้อตามลำดับ:')
  outline.items.forEach((it, i) => {
    const indent = '  '.repeat(Math.max(0, it.level - 2))
    lines.push(`${indent}${i + 1}. <${headingTag(it.level)}>${it.text}</${headingTag(it.level)}>`)
    if (it.notes) {
      for (const n of it.notes.split('\n')) lines.push(`${indent}   แนวเนื้อหา: ${n}`)
    }
  })
  if (language === 'en') lines.push('', '(Headings must stay exactly as written above, even if the article is in English.)')
  return lines.join('\n')
}

// ─── ตรวจบทความกับ outline ───

const NUMBER_PREFIX_RE = /^\s*(?:\d+(?:\.\d+)*[.)]?|[ก-ฮ][.)])\s+/

/** ข้อความหัวข้อสำหรับเทียบตรงทุกคำ: ถอด entity, ตัดช่องว่างซ้ำ/อักขระมองไม่เห็น, NFC, ตัวพิมพ์เล็ก */
export function normalizeHeading(text: string): string {
  return stripTagsText(text)
    .normalize('NFC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function looseHeading(text: string): string {
  return normalizeHeading(text).replace(NUMBER_PREFIX_RE, '').replace(/[\s"'`.,:;!?()[\]{}\-–—|/\\]+/g, '')
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** ความคล้าย (Dice ของ bigram) 0..1 */
export function headingSimilarity(a: string, b: string): number {
  const x = looseHeading(a)
  const y = looseHeading(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const A = bigrams(x)
  const B = bigrams(y)
  let inter = 0
  A.forEach((n, g) => { inter += Math.min(n, B.get(g) ?? 0) })
  return (2 * inter) / (x.length - 1 + (y.length - 1))
}

export const OUTLINE_FUZZY_MIN = 0.6

interface ArticleHeading { level: number; text: string; start: number; end: number; inner: string }

function articleHeadings(html: string): ArticleHeading[] {
  const out: ArticleHeading[] = []
  const re = /<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    out.push({ level: Number(m[1]), inner: m[2], text: stripTagsText(m[2]), start: m.index, end: m.index + m[0].length })
  }
  return out
}

export interface OutlineCheck {
  /** HTML หลังแก้ชื่อ/ระดับหัวข้อที่ใกล้เคียง (fix=false = เท่าเดิม) */
  html: string
  /** หัวข้อ outline ที่ไม่มีในบทความ (index ใน items) */
  missing: number[]
  /** หัวข้อ outline ที่มีแต่อยู่ผิดลำดับ */
  outOfOrder: number[]
  /** หัวข้อที่ชื่อเพี้ยน/ระดับผิด แล้วแก้กลับให้ตรง outline (fix=true) หรือพบว่าเพี้ยน (fix=false) */
  renamed: number[]
  /** ตำแหน่งในบทความของหัวข้อ outline ที่เจอ (-1 = ไม่เจอ) */
  positions: number[]
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * เทียบหัวข้อในบทความกับ outline ตามลำดับ
 * - ตรงทุกคำ (หลัง normalize) = ผ่าน
 * - ใกล้เคียง (≥ OUTLINE_FUZZY_MIN) = ถือเป็นหัวข้อเดียวกันที่ AI เปลี่ยนคำ — fix=true แก้ข้อความ/ระดับกลับเป็นของ outline
 * - ไม่เจอหลังหัวข้อก่อนหน้า แต่เจอก่อนหน้า = ผิดลำดับ, ไม่เจอเลย = ขาด
 */
export function checkOutline(html: string, items: OutlineItem[], opts: { fix?: boolean } = {}): OutlineCheck {
  const heads = articleHeadings(html)
  const used = new Set<number>()
  const positions: number[] = items.map(() => -1)
  const missing: number[] = []
  const outOfOrder: number[] = []
  const renamed: number[] = []
  const edits = new Map<number, OutlineItem>()
  let cursor = 0

  const findExact = (it: OutlineItem, from: number, to: number) => {
    const want = normalizeHeading(it.text)
    for (let j = from; j < to; j++) if (!used.has(j) && normalizeHeading(heads[j].text) === want) return j
    return -1
  }
  const findFuzzy = (it: OutlineItem, from: number, to: number) => {
    let best = -1
    let bestScore = 0
    for (let j = from; j < to; j++) {
      if (used.has(j)) continue
      const sc = headingSimilarity(heads[j].text, it.text)
      if (sc >= OUTLINE_FUZZY_MIN && sc > bestScore) {
        best = j
        bestScore = sc
      }
    }
    return best
  }

  items.forEach((it, i) => {
    let j = findExact(it, cursor, heads.length)
    // หัวข้อถัดไปของ outline ที่ตรงเป๊ะต้องไม่โดนแย่งด้วย fuzzy — fuzzy ค้นได้ถึงก่อนหัวข้อที่ตรงเป๊ะของข้อถัดไป
    if (j === -1) {
      const nextExact = items.slice(i + 1).map((n) => findExact(n, cursor, heads.length)).find((x) => x !== -1)
      j = findFuzzy(it, cursor, nextExact ?? heads.length)
    }
    if (j !== -1) {
      used.add(j)
      positions[i] = j
      cursor = j + 1
      const textOk = normalizeHeading(heads[j].text) === normalizeHeading(it.text)
      const levelOk = heads[j].level === Math.min(6, Math.max(2, it.level))
      if (!textOk || !levelOk) {
        renamed.push(i)
        edits.set(j, it)
      }
      return
    }
    // ไม่เจอหลังตำแหน่งปัจจุบัน — เจอก่อนหน้า = ผิดลำดับ
    const back = findExact(it, 0, cursor)
    const before = back !== -1 ? back : findFuzzy(it, 0, cursor)
    if (before !== -1) {
      used.add(before)
      positions[i] = before
      outOfOrder.push(i)
      return
    }
    missing.push(i)
  })

  let out = html
  if (opts.fix && edits.size) {
    const sorted = Array.from(edits.entries()).sort((a, b) => b[0] - a[0])
    for (const [j, it] of sorted) {
      const h = heads[j]
      const tag = headingTag(it.level)
      out = `${out.slice(0, h.start)}<${tag}>${escapeHtmlText(it.text)}</${tag}>${out.slice(h.end)}`
    }
  }
  return { html: out, missing, outOfOrder, renamed, positions }
}

/** คำเตือนที่ส่งกลับหน้าเว็บ (ว่าง = ผ่าน) */
export function outlineWarnings(check: Pick<OutlineCheck, 'missing' | 'outOfOrder'>, items: OutlineItem[], extra?: { renamed?: number[] }): string[] {
  const name = (i: number) => `"${items[i].text}"`
  const out: string[] = []
  if (check.missing.length) out.push(`outline: ขาดหัวข้อ ${check.missing.map(name).join(', ')}`)
  if (check.outOfOrder.length) out.push(`outline: หัวข้ออยู่ผิดลำดับ ${check.outOfOrder.map(name).join(', ')}`)
  if (extra?.renamed?.length) out.push(`outline: หัวข้อถูกแก้ข้อความหลังตรวจข้อจำกัด/Comment ${extra.renamed.map(name).join(', ')}`)
  return out
}

// ─── เติมหัวข้อที่ขาด ───

/** คำสั่งรอบเติม: เขียนเฉพาะส่วนที่ขาด แต่ละส่วนขึ้นต้นด้วยหัวข้อตรงทุกตัวอักษร */
export function buildOutlineFillPrompt(items: OutlineItem[], missing: number[], language: 'th' | 'en' | undefined): string {
  const list = missing.map((i) => {
    const it = items[i]
    const tag = headingTag(it.level)
    const prev = i > 0 ? `ต่อจากหัวข้อ "${items[i - 1].text}"` : 'เป็นหัวข้อแรก'
    return `- <${tag}>${it.text}</${tag}> (${prev})${it.notes ? `\n  แนวเนื้อหา: ${it.notes.replace(/\n/g, ' / ')}` : ''}`
  })
  return [
    'บทความด้านบนยังขาดหัวข้อจาก OUTLINE ต่อไปนี้ — เขียนเฉพาะส่วนที่ขาด (หัวข้อ + เนื้อหาใต้หัวข้อ) ตามลำดับที่ให้',
    ...list,
    '',
    '- แต่ละส่วนขึ้นต้นด้วยแท็กหัวข้อตามที่ให้ไว้ ข้อความหัวข้อต้องตรงทุกตัวอักษร',
    '- เนื้อหาต่อเนื่องกับบทความเดิม ใช้น้ำเสียงเดียวกัน ข้อเท็จจริงต้องมาจากข้อมูลที่ให้ไว้ด้านบนเท่านั้น',
    `- ภาษา: ${language === 'en' ? 'English' : 'ไทย'}`,
    '- ตอบเป็น HTML ล้วนของส่วนที่ขาดเท่านั้น ห้ามมีส่วนอื่นของบทความ ห้ามมี META_DESCRIPTION, ---HTML---, markdown code fence, style, class',
  ].join('\n')
}

/** ตัดคำตอบรอบเติมเป็นส่วนของแต่ละหัวข้อที่ขาด (หาหัวข้อด้วยข้อความตรง/ใกล้เคียง) */
export function splitOutlineFill(raw: string, items: OutlineItem[], missing: number[]): Map<number, string> {
  const text = raw.replace(/^\s*```[a-z]*\n?/i, '').replace(/```\s*$/i, '')
  const heads = articleHeadings(text)
  const found: Array<{ i: number; start: number }> = []
  let cursor = 0
  for (const i of missing) {
    const it = items[i]
    let j = -1
    for (let k = cursor; k < heads.length; k++) {
      if (normalizeHeading(heads[k].text) === normalizeHeading(it.text) || headingSimilarity(heads[k].text, it.text) >= OUTLINE_FUZZY_MIN) {
        j = k
        break
      }
    }
    if (j === -1) continue
    found.push({ i, start: heads[j].start })
    cursor = j + 1
  }
  const out = new Map<number, string>()
  found.forEach((f, n) => {
    const end = n + 1 < found.length ? found[n + 1].start : text.length
    let section = text.slice(f.start, end).trim()
    // แก้หัวข้อของส่วนนี้ให้ตรง outline เป๊ะ
    const it = items[f.i]
    const tag = headingTag(it.level)
    section = section.replace(/^<h[2-6]\b[^>]*>[\s\S]*?<\/h[2-6]\s*>/i, `<${tag}>${escapeHtmlText(it.text)}</${tag}>`)
    if (section.length > 0) out.set(f.i, section)
  })
  return out
}

/**
 * แทรกส่วนที่เติมเข้าบทความ: วางก่อนหัวข้อ outline ข้อถัดไปที่มีอยู่แล้ว
 * ไม่มีข้อถัดไป = วางท้ายส่วนของหัวข้อ outline ก่อนหน้า (ก่อนหัวข้อเสริมระดับเดียวกันหรือสูงกว่า เช่น FAQ ที่ AI เพิ่ม) หรือท้ายบทความ
 */
export function insertOutlineSections(html: string, items: OutlineItem[], sections: Map<number, string>): string {
  let out = html
  const order = Array.from(sections.keys()).sort((a, b) => a - b)
  for (const i of order) {
    const heads = articleHeadings(out)
    const check = checkOutline(out, items)
    const section = sections.get(i)!
    let at = -1
    for (let n = i + 1; n < items.length; n++) {
      const p = check.positions[n]
      if (p !== -1 && !check.outOfOrder.includes(n)) {
        at = heads[p].start
        break
      }
    }
    if (at === -1) {
      let prevPos = -1
      for (let n = i - 1; n >= 0; n--) {
        if (check.positions[n] !== -1) {
          prevPos = check.positions[n]
          break
        }
      }
      if (prevPos !== -1) {
        const prevLevel = heads[prevPos].level
        const nextHead = heads.slice(prevPos + 1).find((h) => h.level <= Math.max(2, Math.min(prevLevel, items[i].level)))
        at = nextHead ? nextHead.start : out.length
      } else {
        const first = heads[0]
        at = first ? first.start : out.length
      }
    }
    out = `${out.slice(0, at)}${section}\n${out.slice(at)}`
  }
  return out
}

// ─── FAQ ───

const FAQ_HEADING_RE = /FAQ|คำถามที่พบบ่อย|คำถามยอดฮิต|Q\s*&\s*A|ถาม.?ตอบ|frequently asked|คำถามที่(หลายคน|คน|ผู้อ่าน|ลูกค้า)?(มัก|ชอบ)?(ถาม|สงสัย)/i

/** outline มีส่วน FAQ ของตัวเอง — ตัวเขียนห้ามเขียนส่วน FAQ ทับ (คำถามใน outline จะหาย) */
export function outlineHasFaq(items: OutlineItem[]): boolean {
  return items.some((it) => FAQ_HEADING_RE.test(it.text))
}
