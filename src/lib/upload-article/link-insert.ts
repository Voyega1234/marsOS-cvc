// ─── Upload Article — แทรก Internal Link ตอน Generate โดยไม่แก้ถ้อยคำผู้เขียน ───
// ครอบ <a> ให้คำที่มีอยู่แล้วในเนื้อหาเท่านั้น (ไม่เพิ่ม/ไม่เปลี่ยนคำ) — คำต้องตรงขอบคำ (ภาษาไทยตัดคำด้วย Intl.Segmenter)
// ใส่เฉพาะย่อหน้า/รายการ/ช่องตาราง ไม่แตะหัวข้อ, ลิงก์เดิม, รูป, โค้ด และใส่ได้ย่อหน้าละ 1 ลิงก์

import { parse, HTMLElement, Node, NodeType, TextNode } from 'node-html-parser'
import { normalizeUrl } from './internal-links'
import type { UploadLinkPair } from './types'

/** ต้องตรงกับ clean-html — ไม่ให้ parser ถือเนื้อใน script/style/pre เป็น raw text */
const PARSE_OPTIONS = { blockTextElements: {} }

export const INSERTED_LINK_ATTR = 'data-ua-link'

/** ข้อความต้องอยู่ใต้แท็กเหล่านี้ถึงจะใส่ลิงก์ */
const CONTAINERS = new Set(['p', 'li', 'td', 'dd', 'blockquote'])
/** ใต้แท็กเหล่านี้ห้ามใส่ลิงก์ */
const BLOCKED = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'summary', 'figure', 'figcaption', 'code', 'pre', 'script', 'style', 'button', 'label', 'select', 'option', 'textarea', 'svg'])

const MIN_KEYWORD_LEN = 2

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

let segmenter: Intl.Segmenter | null | undefined
function wordBoundaries(text: string): Set<number> | null {
  if (segmenter === undefined) {
    try {
      segmenter = new Intl.Segmenter('th', { granularity: 'word' })
    } catch {
      segmenter = null
    }
  }
  if (!segmenter) return null
  const set = new Set<number>([0, text.length])
  for (const seg of Array.from(segmenter.segment(text))) {
    set.add(seg.index)
    set.add(seg.index + seg.segment.length)
  }
  return set
}

const LATIN_WORD_CHAR = /[A-Za-z0-9]/
/** ตัวอักษรละติน/ตัวเลข/ไทย — ใช้ตอนไม่มี Intl.Segmenter */
const WORD_CHAR = /[A-Za-z0-9\u0E00-\u0E7F]/

/** ตำแหน่งแรกที่ keyword โผล่แบบตรงขอบคำ — ไม่เจอ = -1 */
function findWholeWord(text: string, keyword: string): number {
  const hay = text.toLowerCase()
  const needle = keyword.toLowerCase()
  let bounds: Set<number> | null | undefined
  let from = 0
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from)
    if (i < 0) return -1
    const end = i + needle.length
    const before = text[i - 1] ?? ''
    const after = text[end] ?? ''
    const latinOk = !(LATIN_WORD_CHAR.test(before) && LATIN_WORD_CHAR.test(text[i])) && !(LATIN_WORD_CHAR.test(after) && LATIN_WORD_CHAR.test(text[end - 1]))
    if (latinOk) {
      if (bounds === undefined) bounds = wordBoundaries(text)
      // ไม่มีตัวตัดคำในเครื่อง = ยอมรับเฉพาะคำที่ติดช่องว่าง/เครื่องหมายทั้งสองฝั่ง
      const ok = bounds
        ? bounds.has(i) && bounds.has(end)
        : !WORD_CHAR.test(before) && !WORD_CHAR.test(after)
      if (ok) return i
    }
    from = i + 1
  }
  return -1
}

function blockedOrContainer(node: Node): HTMLElement | null {
  let container: HTMLElement | null = null
  let cur: Node | null = node.parentNode
  while (cur && cur.nodeType === NodeType.ELEMENT_NODE) {
    const el = cur as HTMLElement
    const tag = (el.rawTagName || '').toLowerCase()
    if (BLOCKED.has(tag)) return null
    // กล่อง CTA ที่ระบบแทรก — ไม่ใส่ Internal Link ในหัวข้อ/คำโปรย CTA
    if (/\bcontent-cta\b/.test(el.getAttribute('class') || '')) return null
    if (!container && CONTAINERS.has(tag)) container = el
    cur = el.parentNode
  }
  return container
}

function textNodes(root: HTMLElement): TextNode[] {
  const out: TextNode[] = []
  const walk = (n: Node) => {
    for (const c of n.childNodes) {
      if (c.nodeType === NodeType.TEXT_NODE) out.push(c as TextNode)
      else if (c.nodeType === NodeType.ELEMENT_NODE) walk(c)
    }
  }
  walk(root)
  return out
}

export interface InsertLinksResult {
  html: string
  inserted: UploadLinkPair[]
}

/**
 * ครอบลิงก์ให้คำที่ตรงกับ keyword ของแต่ละลิงก์ (ครั้งแรกที่เจอ) ตามลำดับใน pool จนครบ max
 * ข้าม URL ที่บทความลิงก์อยู่แล้ว และย่อหน้าที่มีลิงก์อยู่แล้ว
 */
export function insertInternalLinks(html: string, pool: UploadLinkPair[], max: number): InsertLinksResult {
  if (!html || max <= 0 || pool.length === 0) return { html, inserted: [] }
  const root = parse(html, { comment: true, ...PARSE_OPTIONS })

  const linkedUrls = new Set<string>()
  const linkedContainers = new Set<HTMLElement>()
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href') || ''
    if (/^https?:\/\//i.test(href)) linkedUrls.add(normalizeUrl(href))
    // ย่อหน้าที่มีลิงก์อยู่แล้วไม่ใส่เพิ่ม
    let cur: Node | null = a.parentNode
    while (cur && cur.nodeType === NodeType.ELEMENT_NODE) {
      if (CONTAINERS.has(((cur as HTMLElement).rawTagName || '').toLowerCase())) { linkedContainers.add(cur as HTMLElement); break }
      cur = cur.parentNode
    }
  }

  const inserted: UploadLinkPair[] = []
  for (const pair of pool) {
    if (inserted.length >= max) break
    const keyword = pair.keyword.trim()
    if (keyword.length < MIN_KEYWORD_LEN) continue
    const key = normalizeUrl(pair.url)
    if (linkedUrls.has(key)) continue
    const needle = escapeHtml(keyword)

    for (const tn of textNodes(root)) {
      const container = blockedOrContainer(tn)
      if (!container || linkedContainers.has(container)) continue
      const raw = tn.rawText
      const at = findWholeWord(raw, needle)
      if (at < 0) continue

      const parent = tn.parentNode as HTMLElement
      const matched = raw.slice(at, at + needle.length)
      const fragment = parse(
        `${raw.slice(0, at)}<a href="${escapeAttr(pair.url)}" ${INSERTED_LINK_ATTR}="1">${matched}</a>${raw.slice(at + needle.length)}`,
        PARSE_OPTIONS,
      ).childNodes
      const idx = parent.childNodes.indexOf(tn)
      if (idx < 0) continue
      for (const n of fragment) n.parentNode = parent
      parent.childNodes.splice(idx, 1, ...fragment)

      linkedUrls.add(key)
      linkedContainers.add(container)
      inserted.push(pair)
      break
    }
  }

  return { html: inserted.length ? root.toString() : html, inserted }
}
