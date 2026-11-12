// ─── PBN Backlinks — keyword + URL ปลายทาง (backlink) ───────────────────────────
// บทความ PBN ทุกชิ้นต้องมีลิงก์ออก (external link) ไป URL ปลายทางของ keyword นั้น 1 ลิงก์ และห้ามมีลิงก์อื่นในเนื้อหา
// (ไม่มี internal link ของเว็บ PBN, ไม่มีลิงก์ออกไปที่อื่น) — กล่องของระบบ (CTA/Author/TOC/Breadcrumb) ไม่แตะ
// Upload Article ไม่ใช้ไฟล์นี้

import { parse, HTMLElement, Node, NodeType } from 'node-html-parser'
import { insertInternalLinks } from './link-insert'
import { normalizeUrl } from './internal-links'
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
  /** ระบบครอบลิงก์ให้เอง (AI ไม่ได้ใส่มา) */
  inserted: boolean
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
 * บังคับให้บทความ PBN มีลิงก์ไป URL ปลายทางลิงก์เดียว:
 * - ลิงก์อื่นทุกตัวในเนื้อหา (ยกเว้น #anchor ในหน้าและกล่องของระบบ) ถูกถอดเหลือแต่ข้อความ
 * - ลิงก์ไป URL ปลายทางเก็บไว้ตัวแรกตัวเดียว (href ตั้งเป็น URL ที่ทีมใส่คำต่อคำ)
 * - AI ไม่ได้ใส่มา = ครอบ keyword ครั้งแรกที่เจอในย่อหน้า/รายการ (ไม่แก้ถ้อยคำ)
 */
export function enforcePbnBacklink(html: string, backlink: UploadLinkPair): EnforceBacklinkResult {
  if (!html) return { html, removed: 0, present: false, inserted: false }
  const root = parse(html, { comment: true, ...PARSE_OPTIONS })
  const target = normalizeUrl(backlink.url)
  let removed = 0
  let kept = false
  for (const a of root.querySelectorAll('a')) {
    if (inSystemBlock(a)) continue
    const href = (a.getAttribute('href') || '').trim()
    if (href.startsWith('#')) continue
    const isTarget = /^https?:\/\//i.test(href) && normalizeUrl(href) === target
    if (isTarget && !kept) {
      kept = true
      a.setAttribute('href', backlink.url)
      continue
    }
    if (unwrap(a)) removed++
  }
  let out = removed || kept ? root.toString() : html
  if (kept) return { html: out, removed, present: true, inserted: false }
  const ins = insertInternalLinks(out, [backlink], 1)
  out = ins.html
  return { html: out, removed, present: ins.inserted.length > 0, inserted: ins.inserted.length > 0 }
}
