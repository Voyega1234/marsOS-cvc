// ─── Upload Article — ตำแหน่งสารบัญ (nav.content-toc) ในบทความ ──────────────────────────
// ตำแหน่งเป็นตัวเลขเดียว ใช้ร่วมกันทั้ง Generate (build-html), หน้า Push (ย้ายการ์ด) และผลสแกนเว็บ
//   -1 = แบบเดิม: หลัง H1 → ปก → ย่อหน้าแรก
//    0 = หลังอินโทรทั้งหมด ก่อนหัวข้อ H2 แรก
//    n = หลังหัวข้อ H2 ที่ n (n ≥ จำนวน H2 = ท้ายบทความ)
// ไม่ตั้งค่า (undefined) = แบบเดิมทุกอย่าง — โปรเจกต์เก่าได้ HTML เดิมทุก byte
// string-scan ล้วน ใช้ได้ทั้ง server และ client

import { parseUploadCards } from './cards'

export const TOC_POSITION_LEGACY = -1
export const TOC_POSITION_MAX = 50

/** ค่าจาก JSON/request → ตำแหน่งที่ใช้ได้ หรือ undefined (ไม่ตั้ง) */
export function normalizeTocPosition(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined
  if (raw < TOC_POSITION_LEGACY || raw > TOC_POSITION_MAX) return undefined
  return raw
}

interface TocPrefsLike {
  tocPosition?: unknown
  siteScan?: { components?: { toc?: { position?: unknown } | null } | null } | null
}

/** ตำแหน่งที่ใช้ตอน Generate: ที่ทีมย้ายเองในหน้า Push ก่อน แล้วค่อยตามที่สแกนเว็บเจอ */
export function effectiveTocPosition(prefs: TocPrefsLike | null | undefined): number | undefined {
  if (!prefs) return undefined
  return normalizeTocPosition(prefs.tocPosition) ?? normalizeTocPosition(prefs.siteScan?.components?.toc?.position)
}

/** ตำแหน่งเป็นข้อความสั้น ๆ สำหรับ UI */
export function describeTocPosition(position: number, h2Count?: number): string {
  if (position === TOC_POSITION_LEGACY) return 'หลังย่อหน้าแรก'
  if (position === 0) return 'หลังอินโทร ก่อนหัวข้อแรก'
  if (position >= TOC_POSITION_MAX || (h2Count !== undefined && position >= h2Count)) return 'ท้ายบทความ'
  return `หลังหัวข้อที่ ${position}`
}

const H2_START_RE = /^\s*<h2\b/i
const SYSTEM_TOC_RE = /<nav\b[^>]*class="[^"]*\bcontent-toc\b[^"]*"[^>]*>[\s\S]*?<\/nav>/i

/** card ที่ขึ้นต้นด้วย H2 = จุดเริ่มหัวข้อใหม่ */
function startsSection(html: string): boolean {
  return H2_START_RE.test(html)
}

/** สารบัญของระบบ = card toc ที่ไม่ใช่สารบัญที่ผู้เขียนพิมพ์มาเอง */
function systemTocIndex(cards: Array<{ type: string; derived?: boolean; html: string }>): number {
  return cards.findIndex((c) => c.type === 'toc' && !c.derived && SYSTEM_TOC_RE.test(c.html))
}

/** ตำแหน่งปัจจุบันของสารบัญระบบในบทความ — ไม่มีสารบัญคืน undefined */
export function tocPositionOfHtml(html: string): number | undefined {
  const { cards } = parseUploadCards(html)
  const t = systemTocIndex(cards)
  if (t === -1) return undefined
  const before = cards.slice(0, t).filter((c) => startsSection(c.html)).length
  if (before > 0) return before
  // ยังไม่ถึงหัวข้อแรก: มีเนื้อหาอินโทรต่อหลังสารบัญ = แบบเดิม (กลางอินโทร)
  const next = cards.slice(t + 1).find((c) => c.type !== 'toc')
  return next && !startsSection(next.html) ? TOC_POSITION_LEGACY : 0
}

/** จำนวนหัวข้อ H2 ที่เป็นจุดเริ่ม card (นับแบบเดียวกับตอนวางสารบัญ) */
export function sectionCountOfHtml(html: string): number {
  return parseUploadCards(html).cards.filter((c) => startsSection(c.html)).length
}

/** จุดแทรกแบบเดิมในอินโทร: หลัง </h1> → ปก (figure) → ย่อหน้าแรก */
function legacySlot(intro: string): number {
  const h1 = intro.match(/<\/h1\s*>/i)
  let at = h1 && h1.index !== undefined ? h1.index + h1[0].length : 0
  const fig = intro.slice(at).match(/^\s*<figure\b[\s\S]*?<\/figure>/i)
  if (fig) at += fig[0].length
  const p = intro.slice(at).match(/^\s*<p\b[\s\S]*?<\/p>/i)
  if (p) at += p[0].length
  return at
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/** สร้างสารบัญจาก H2 ที่มี id แล้ว (ทุกบทความที่ผ่าน Generate มี id) — H2 ไม่มี id สักตัว คืน null */
export function buildTocFromHeadings(html: string, language?: string): string | null {
  const items: string[] = []
  for (const m of Array.from(html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi))) {
    const id = m[1].match(/\bid="([^"]+)"/i)
    if (!id) return null
    items.push(`<li><a href="#${id[1]}">${escapeHtml(textOf(m[2]))}</a></li>`)
  }
  if (items.length < 3) return null
  const label = language === 'en' ? 'Contents' : 'สารบัญ'
  return `<nav class="content-toc" aria-label="${label}"><p class="content-toc__title">${label}</p><ol>${items.join('')}</ol></nav>`
}

function joinAround(before: string, toc: string, after: string): string {
  const lead = before && !/\s$/.test(before) ? '\n' : ''
  const trail = after && !/^\s/.test(after) ? '\n' : ''
  return `${before}${lead}${toc}${trail}${after}`
}

/**
 * ย้ายสารบัญระบบไปตำแหน่ง position (ไม่มีสารบัญ = สร้างจาก H2 แล้ววาง) — คืน HTML ใหม่
 * คืน null เมื่อวางไม่ได้ (หัวข้อไม่ถึง 3 / H2 ไม่มี id)
 */
export function placeToc(html: string, position: number, language?: string): string | null {
  const parsed = parseUploadCards(html)
  const t = systemTocIndex(parsed.cards)
  if (t !== -1 && tocPositionOfHtml(html) === position) return html
  const toc = t !== -1 ? parsed.cards[t].html.trim() : buildTocFromHeadings(html, language)
  if (!toc) return null

  const rest = parsed.cards.filter((_, i) => i !== t)
  const firstSection = rest.findIndex((c) => startsSection(c.html))
  const introEnd = firstSection === -1 ? rest.length : firstSection

  let body: string
  if (position === TOC_POSITION_LEGACY) {
    const intro = rest.slice(0, introEnd).map((c) => c.html).join('')
    const at = legacySlot(intro)
    body = joinAround(intro.slice(0, at), toc, intro.slice(at)) + rest.slice(introEnd).map((c) => c.html).join('')
  } else {
    // position = จำนวนหัวข้อก่อนสารบัญ → แทรกก่อน card หัวข้อที่ position+1
    let seen = 0
    let cut = rest.length
    for (let i = 0; i < rest.length; i++) {
      if (!startsSection(rest[i].html)) continue
      if (seen === position) { cut = i; break }
      seen++
    }
    body = joinAround(rest.slice(0, cut).map((c) => c.html).join(''), toc, rest.slice(cut).map((c) => c.html).join(''))
  }
  return parsed.head + body + parsed.tail
}

/**
 * สแกนเว็บ: บทความที่คนเขียนเองวางสารบัญไว้ตรงไหน
 * tocStart = ตำแหน่งเริ่มของสารบัญใน html ของเนื้อหา — คืน -1/0/n แบบเดียวกับข้างบน
 */
export function detectTocPosition(contentHtml: string, tocStart: number): number {
  const before = contentHtml.slice(0, tocStart)
  const h2Before = (before.match(/<h2\b/gi) || []).length
  if (h2Before > 0) return h2Before
  // ก่อนหัวข้อแรก: มีย่อหน้าเนื้อหาอยู่ระหว่างสารบัญกับ H2 แรก = กลางอินโทร (แบบเดิม)
  // หา H2 หลังกล่องสารบัญ — หัวกล่องสารบัญบางเว็บเป็น h2 เอง
  const after = contentHtml.slice(tocStart)
  const rest = after.slice(tocBlockEnd(after))
  const firstH2 = rest.search(/<h2\b/i)
  const tail = stripNonText(firstH2 === -1 ? rest : rest.slice(0, firstH2))
  const hasText = Array.from(tail.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).some((m) => textOf(m[1]).replace(/&nbsp;/g, '').trim())
  return hasText ? TOC_POSITION_LEGACY : 0
}

/** จุดจบโดยประมาณของกล่องสารบัญ (nav/div ตัวแรก นับซ้อน) */
function tocBlockEnd(html: string): number {
  const open = html.match(/^\s*<(nav|div|section|aside|details)\b/i)
  if (!open) return 0
  const tag = open[1].toLowerCase()
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi')
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
  return html.length
}

/** ตัด script/style/comment ออกก่อนดูว่ามีย่อหน้าข้อความจริงไหม */
function stripNonText(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '')
}

/** ตำแหน่งที่บทความส่วนใหญ่ใช้ (เสมอกันเลือกตัวที่เจอก่อน) — ไม่มีข้อมูลคืน undefined */
export function majorityTocPosition(positions: number[]): { position: number; count: number } | undefined {
  const counts = new Map<number, number>()
  for (const p of positions) counts.set(p, (counts.get(p) || 0) + 1)
  let best: { position: number; count: number } | undefined
  for (const [position, count] of Array.from(counts)) {
    if (!best || count > best.count) best = { position, count }
  }
  return best
}
