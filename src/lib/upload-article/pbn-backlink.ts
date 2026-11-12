// ─── PBN Backlinks — keyword + URL ปลายทาง (backlink) ───────────────────────────
// บทความ PBN ทุกชิ้นต้องมีลิงก์ออก (external link) ไป URL ปลายทางของ keyword นั้น และห้ามมีลิงก์อื่นในเนื้อหา
// จำนวนลิงก์เลือกตอนสั่งเขียน (ค่าเริ่มต้น 1, สูงสุด PBN_BACKLINKS_MAX) — ทุกลิงก์ชี้ URL เดียวกัน
// (ไม่มี internal link ของเว็บ PBN, ไม่มีลิงก์ออกไปที่อื่น) — กล่องของระบบ (CTA/Author/TOC/Breadcrumb) ไม่แตะ
// Upload Article ไม่ใช้ไฟล์นี้

import { parse, HTMLElement, Node, NodeType } from 'node-html-parser'
import { INSERTED_LINK_ATTR, blockedOrContainer, escapeAttr, escapeHtml, findWholeWord, textNodes } from './link-insert'
import { normalizeUrl } from './internal-links'
import { cleanPbnBacklinkCount } from './pbn-sets'
import type { UploadKeyword, UploadLinkPair } from './types'

const PARSE_OPTIONS = { blockTextElements: {} }
const SYSTEM_BLOCK_RE = /\bcontent-(?:cta|author|toc|breadcrumb)\b/
export const PBN_TARGET_URL_MAX = 2000

/**
 * ข้อความที่ทีมพิมพ์/วาง → URL ปลายทางที่ใช้ได้ (http/https, host มีจุด) — ไม่มี scheme เติม https:// ให้
 * ใช้ไม่ได้ = null, ว่าง = ''
 */
export function normalizeTargetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return ''
  if (s.length > PBN_TARGET_URL_MAX || /\s/.test(s)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.') || u.hostname.startsWith('.') || u.hostname.endsWith('.')) return null
    return u.href
  } catch {
    return null
  }
}

/** คู่ anchor → URL ของบทความ PBN จาก keyword (ไม่มี URL = null) */
export function pbnBacklinkFor(keyword: Pick<UploadKeyword, 'keyword' | 'targetUrl'>): UploadLinkPair | null {
  const url = normalizeTargetUrl(keyword.targetUrl ?? '')
  return url ? { keyword: keyword.keyword.trim(), url } : null
}

export interface EnforceBacklinkResult {
  html: string
  /** ลิงก์อื่นที่ถูกถอดออก (เหลือแต่ข้อความ) */
  removed: number
  /** ลิงก์ไป URL ปลายทางมีอยู่ในบทความหลังจัดการแล้ว */
  present: boolean
  /** ระบบครอบลิงก์ให้เอง (AI ไม่ได้ใส่มา หรือใส่มาไม่ครบจำนวน) */
  inserted: boolean
  /** จำนวนลิงก์ไป URL ปลายทางที่มีในบทความหลังจัดการแล้ว */
  count: number
}

function inSystemBlock(a: HTMLElement): boolean {
  let cur: Node | null = a.parentNode
  while (cur && cur.nodeType === NodeType.ELEMENT_NODE) {
    if (SYSTEM_BLOCK_RE.test((cur as HTMLElement).getAttribute('class') || '')) return true
    cur = cur.parentNode
  }
  return false
}

function unwrap(a: HTMLElement): boolean {
  const parent = a.parentNode as HTMLElement | null
  if (!parent) return false
  const idx = parent.childNodes.indexOf(a)
  if (idx < 0) return false
  for (const n of a.childNodes) n.parentNode = parent
  parent.childNodes.splice(idx, 1, ...a.childNodes)
  return true
}

/**
 * ครอบลิงก์ให้ keyword ที่มีอยู่แล้วในเนื้อหา (ไม่แก้ถ้อยคำ) ไล่จากต้นบทความ ย่อหน้า/รายการละ 1 ลิงก์
 * ข้ามย่อหน้าที่มีลิงก์อยู่แล้ว หัวข้อ และกล่องของระบบ — คืนจำนวนที่ครอบได้จริง (ไม่เกิน need)
 */
function wrapKeyword(html: string, backlink: UploadLinkPair, need: number): { html: string; added: number } {
  const keyword = backlink.keyword.trim()
  if (need <= 0 || keyword.length < 2) return { html, added: 0 }
  const root = parse(html, { comment: true, ...PARSE_OPTIONS })
  const taken = new Set<HTMLElement>()
  for (const a of root.querySelectorAll('a')) {
    const container = blockedOrContainer(a)
    if (container) taken.add(container)
  }
  const needle = escapeHtml(keyword)
  let added = 0
  for (const tn of textNodes(root)) {
    if (added >= need) break
    const container = blockedOrContainer(tn)
    if (!container || taken.has(container)) continue
    const raw = tn.rawText
    const at = findWholeWord(raw, needle)
    if (at < 0) continue
    const parent = tn.parentNode as HTMLElement
    const idx = parent.childNodes.indexOf(tn)
    if (idx < 0) continue
    const matched = raw.slice(at, at + needle.length)
    const fragment = parse(
      `${raw.slice(0, at)}<a href="${escapeAttr(backlink.url)}" ${INSERTED_LINK_ATTR}="1">${matched}</a>${raw.slice(at + needle.length)}`,
      PARSE_OPTIONS,
    ).childNodes
    for (const n of fragment) n.parentNode = parent
    parent.childNodes.splice(idx, 1, ...fragment)
    taken.add(container)
    added++
  }
  return { html: added ? root.toString() : html, added }
}

/**
 * บังคับให้บทความ PBN มีลิงก์ไป URL ปลายทางตามจำนวนที่เลือก (ค่าเริ่มต้น 1) และไม่มีลิงก์อื่น:
 * - ลิงก์อื่นทุกตัวในเนื้อหา (ยกเว้น #anchor ในหน้าและกล่องของระบบ) ถูกถอดเหลือแต่ข้อความ
 * - ลิงก์ไป URL ปลายทางเก็บไว้ count ตัวแรก (href ตั้งเป็น URL ที่ทีมใส่คำต่อคำ) ตัวที่เกินถอดเหลือข้อความ
 * - AI ใส่มาไม่ครบ = ครอบ keyword ที่เจอในย่อหน้า/รายการที่ยังไม่มีลิงก์ จนครบหรือจนคำหมด (ไม่แก้ถ้อยคำ)
 */
export function enforcePbnBacklink(html: string, backlink: UploadLinkPair, count = 1): EnforceBacklinkResult {
  if (!html) return { html, removed: 0, present: false, inserted: false, count: 0 }
  const want = cleanPbnBacklinkCount(count)
  const root = parse(html, { comment: true, ...PARSE_OPTIONS })
  const target = normalizeUrl(backlink.url)
  let removed = 0
  let kept = 0
  for (const a of root.querySelectorAll('a')) {
    if (inSystemBlock(a)) continue
    const href = (a.getAttribute('href') || '').trim()
    if (href.startsWith('#')) continue
    const isTarget = /^https?:\/\//i.test(href) && normalizeUrl(href) === target
    if (isTarget && kept < want) {
      kept++
      a.setAttribute('href', backlink.url)
      continue
    }
    if (unwrap(a)) removed++
  }
  const out = removed || kept ? root.toString() : html
  if (kept >= want) return { html: out, removed, present: true, inserted: false, count: kept }
  // parse ใหม่จากข้อความที่ถอดลิงก์แล้ว — คำที่เคยถูกลิงก์คั่นกลางกลับมาเป็นข้อความก้อนเดียว
  const ins = wrapKeyword(out, backlink, want - kept)
  return { html: ins.html, removed, present: kept + ins.added > 0, inserted: ins.added > 0, count: kept + ins.added }
}
