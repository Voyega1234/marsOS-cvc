// แหล่งอ้างอิงท้ายบทความ — ห้ามแต่งเด็ดขาด (บทความสุขภาพ/กฎหมาย ลิงก์ปลอมเสียหายจริง)
// ตัวเขียนเลือกได้เฉพาะจากรายการที่สแกนจากบทความจริงของเว็บหรือทีมใส่เอง
// ไฟล์นี้ไม่มี dependency ฝั่ง server — ใช้ได้ทั้ง Upload และ SME/SEO
// ลูกค้าเดิมไม่มี detail.structure.references = ไม่เข้าทางนี้เลย ผลเท่าเดิมทุกตัวอักษร

import type { ArticleStructureOptions } from '@/lib/article-structure'
import type { UploadReference, UploadThemeDetail } from './types'

/** จำนวนแหล่งที่ส่งเข้า prompt ต่อบทความ */
export const REFERENCES_PROMPT_MAX = 40

export const REFERENCES_HEADING_RE = /^\s*(?:แหล่ง|เอกสาร)?อ้างอิง(?:และแหล่งข้อมูล)?\s*[:：]?\s*$|^\s*(?:แหล่งที่มา|แหล่งข้อมูล(?:อ้างอิง)?)\s*[:：]?\s*$|^\s*(?:references?|sources?|bibliography)\s*[:：]?\s*$/i

const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;')

/** ตัดพารามิเตอร์ติดตาม (utm_, gclid, fbclid) — ลิงก์เสียหรือไม่ใช่ https/http คืน null */
export function cleanReferenceUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim().replace(/&amp;/g, '&'))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    for (const k of Array.from(u.searchParams.keys())) if (/^(?:utm_.+|gclid|fbclid)$/i.test(k)) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return null
  }
}

/** กุญแจเทียบลิงก์: ไม่สน / ท้าย และ www. */
export function refKey(raw: string | undefined | null): string | null {
  const url = cleanReferenceUrl(raw)
  if (!url) return null
  return url.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '').toLowerCase()
}

/** เลือกแหล่งที่น่าจะตรงเรื่องก่อน — เรียงตามคำที่ตรงกับหัวข้อ ไม่ตรงเลยคงลำดับเดิม */
export function pickReferencesForPrompt(library: UploadReference[], topic: string, max = REFERENCES_PROMPT_MAX): UploadReference[] {
  if (library.length <= max) return library
  const words = Array.from(new Set(topic.toLowerCase().split(new RegExp('[^\\p{L}\\p{N}]+', 'u')).filter((w) => w.length >= 3)))
  const score = (r: UploadReference) => {
    const title = r.title.toLowerCase()
    return words.reduce((n, w) => n + (title.includes(w) ? 1 : 0), 0)
  }
  return library
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.r)
}

/** ค่าที่ส่งให้ตัวเขียน — ไม่มีโครงที่สแกน/ตั้งไว้ = undefined ตัวเขียนใช้กฎเดิม */
export function structureOptionsFromDetail(detail: UploadThemeDetail | null | undefined, topic: string): ArticleStructureOptions | undefined {
  const s = detail?.structure
  if (!s) return undefined
  return {
    takeaways: s.takeaways,
    faqPlain: s.faqPlain,
    conclusionBeforeFaq: s.conclusionBeforeFaq,
    references: s.references,
    referencesTitle: s.referencesTitle,
    ...(s.references ? { library: pickReferencesForPrompt(detail?.references ?? [], topic) } : {}),
  }
}

export interface ReferencesBoxOptions {
  library: UploadReference[]
  title?: string
  language?: 'th' | 'en'
  /** true = เอาเฉพาะลิงก์ในรายการ (บทความจาก AI) · false = คงลิงก์ของเอกสารที่ทีมนำเข้าเอง */
  onlyListed: boolean
}

function renderBox(items: Array<{ title: string; url: string }>, title: string): string {
  const seen = new Set<string>()
  const li = items
    .filter((it) => {
      const k = refKey(it.url)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((it) => `<li><a href="${escapeAttr(it.url)}">${escapeHtml(it.title)}</a></li>`)
  if (!li.length) return ''
  return `<div class="content-references"><p class="content-references__title">${escapeHtml(title)}</p><ul>${li.join('')}</ul></div>`
}

function linksIn(block: string, byKey: Map<string, UploadReference>): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = []
  for (const m of Array.from(block.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi))) {
    const key = refKey(m[1])
    const listed = key ? byKey.get(key) : undefined
    if (listed) out.push({ title: listed.title, url: cleanReferenceUrl(listed.url) || listed.url })
  }
  return out
}

/** ตำแหน่งจบของบล็อก ul/ol/p ที่เริ่มหลังช่องว่างจาก pos — นับชั้นซ้อน กันรายการย่อยทำบล็อกขาด */
function blockAt(html: string, pos: number): { tag: string; start: number; end: number } | null {
  const m = /^\s*<(ul|ol|p)\b[^>]*>/i.exec(html.slice(pos))
  if (!m) return null
  const tag = m[1].toLowerCase()
  const walk = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  walk.lastIndex = pos + m[0].length
  let depth = 1
  for (let t = walk.exec(html); t; t = walk.exec(html)) {
    depth += t[1] ? -1 : 1
    if (depth === 0) return { tag, start: pos, end: t.index + t[0].length }
  }
  return null
}

/**
 * ส่วนอ้างอิงที่เขียนเป็นแท็กล้วน แล้วครอบเป็นกล่อง content-references (ไม่ใช่ H2 จึงไม่เข้าสารบัญ และ FAQ ไม่กลืน)
 * บทความจาก AI: ลิงก์นอกรายการถูกตัด ชื่อแหล่งใช้ตามรายการ ไม่เหลือสักข้อ = ลบทั้งส่วน
 * เอกสารที่ทีมนำเข้า: ครอบกล่องเฉย ๆ เนื้อหาและลิงก์คงเดิมทุกตัว · ทำซ้ำได้ผลเท่าเดิม
 */
export function boxReferencesSection(html: string, o: ReferencesBoxOptions): string {
  if (html.includes('content-references')) return html
  const byKey = new Map<string, UploadReference>()
  for (const r of o.library) {
    const k = refKey(r.url)
    if (k && !byKey.has(k)) byKey.set(k, r)
  }
  const headingRe = /<(h[2-6]|p)\b[^>]*>((?:(?!<\/\1>)[\s\S]){1,300})<\/\1>/gi
  let from = 0
  let out = html
  for (;;) {
    headingRe.lastIndex = from
    const m = headingRe.exec(out)
    if (!m) return out
    const label = stripTags(m[2])
    if (!REFERENCES_HEADING_RE.test(label)) {
      from = m.index + m[0].length
      continue
    }
    const headEnd = m.index + m[0].length
    // รายการตามด้วยรายการ หรือย่อหน้าลิงก์ตามด้วยย่อหน้าลิงก์ — ชนิดอื่นถือว่าจบส่วนอ้างอิง ข้อความปิดท้ายจะได้ไม่หาย
    let end = headEnd
    let kind: 'list' | 'p' | null = null
    for (;;) {
      const b = blockAt(out, end)
      if (!b) break
      const k = b.tag === 'p' ? 'p' : 'list'
      if ((kind && kind !== k) || !/<a\b/i.test(out.slice(b.start, b.end))) break
      kind = k
      end = b.end
    }
    // เขียนคำว่า "อ้างอิง" ลอย ๆ ไม่มีรายการลิงก์ตาม — ไม่แตะ
    if (end === headEnd) {
      from = headEnd
      continue
    }
    const fallback = o.language === 'en' ? 'References' : 'อ้างอิง'
    const body = out.slice(headEnd, end)
    const box = o.onlyListed
      ? renderBox(linksIn(body, byKey), o.title || fallback)
      : `<div class="content-references"><p class="content-references__title">${escapeHtml(label.replace(/\s*[:：]$/, '') || fallback)}</p>${body.trim()}</div>`
    out = `${out.slice(0, m.index)}${box}${out.slice(end)}`
    from = m.index + box.length
  }
}
