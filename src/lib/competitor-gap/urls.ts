/**
 * Competitor Gap — URL normalization + SSRF guard
 *
 * ทุก URL ที่จะถูก fetch ต้องผ่าน assertCrawlable() ก่อนเสมอ
 */

import { lookup } from 'dns/promises'

/** พารามิเตอร์ tracking ที่ตัดทิ้งตอน normalize (หน้าเดียวกัน ไม่ใช่หน้าใหม่) */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid', 'yclid', 'ttclid',
  'mc_cid', 'mc_eid', 'igshid', 'ref', 'ref_src', 'source', '_ga', '_gl',
  'sessionid', 'session_id', 'phpsessid', 'sid',
]

/** query string ที่มักเป็น faceted navigation / calendar loop — ข้ามไปเลย */
const TRAP_PARAMS = [
  'filter', 'filters', 'facet', 'orderby', 'order', 'sort', 'sortby',
  'price', 'color', 'size', 'brand', 'attribute', 'add-to-cart',
  'replytocom', 'share', 'print', 'calendar', 'month', 'year', 'date',
]

const TRAP_PATH = /\/(wp-json|wp-admin|wp-content\/uploads|feed|rss|atom|cart|checkout|my-account|login|signin|register|search|tag\/page|page\/\d{3,})(\/|$)/i

const NON_HTML_EXT = /\.(jpg|jpeg|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|gz|mp4|mp3|wav|avi|mov|woff2?|ttf|eot)(\?|$)/i

export function toOrigin(input: string): string {
  try {
    const u = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
    return u.origin
  } catch {
    return ''
  }
}

export function toDomain(input: string): string {
  const origin = toOrigin(input)
  if (!origin) return ''
  try {
    return new URL(origin).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

/** http/https, www/non-www, trailing slash, fragment, tracking params → รูปเดียว */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw.trim(), base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.protocol = 'https:'
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase()
    u.hash = ''
    u.username = ''
    u.password = ''
    if (u.port === '80' || u.port === '443') u.port = ''
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p)
    // เรียง param ให้ ?a=1&b=2 กับ ?b=2&a=1 เป็น URL เดียวกัน
    const entries: Array<[string, string]> = []
    u.searchParams.forEach((v, k) => { entries.push([k, v]) })
    entries.sort((a, b) => a[0].localeCompare(b[0]))
    u.search = ''
    for (const [k, v] of entries) u.searchParams.append(k, v)
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '')
    // %e0%b8 กับ %E0%B8 คือไบต์เดียวกัน — ทำให้เป็นตัวพิมพ์ใหญ่ทั้งหมด
    // ไม่งั้น URL ไทยที่เข้ารหัสคนละเคสจะถูกนับเป็นคนละหน้า และ canonical จะดูเหมือนชี้ไปหน้าอื่น
    u.pathname = u.pathname.replace(/%[0-9a-fA-F]{2}/g, m => m.toUpperCase())
    return u.toString()
  } catch {
    return null
  }
}

export function sameDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
  } catch {
    return false
  }
}

/** URL ที่ไม่ควรเสียโควตา crawl ไปกับมัน (ไฟล์, กับดัก faceted/calendar, query ยาวผิดปกติ) */
export function isCrawlWorthy(url: string): boolean {
  try {
    const u = new URL(url)
    if (NON_HTML_EXT.test(u.pathname)) return false
    if (TRAP_PATH.test(u.pathname)) return false
    if (u.pathname.split('/').filter(Boolean).length > 8) return false
    const keys: string[] = []
    u.searchParams.forEach((_v, k) => { keys.push(k) })
    if (keys.length > 2) return false
    if (keys.some(k => TRAP_PARAMS.includes(k.toLowerCase()))) return false
    return true
  } catch {
    return false
  }
}

// ── SSRF guard ───────────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'metadata.google.internal',
  'instance-data', '0.0.0.0', '[::1]', '::1',
])

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true            // this-network, private, loopback
  if (a === 169 && b === 254) return true                       // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true              // private
  if (a === 192 && b === 168) return true                       // private
  if (a === 192 && b === 0) return true                         // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true             // CGNAT
  if (a >= 224) return true                                     // multicast + reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (v === '::' || v === '::1') return true
  if (v.startsWith('fe80') || v.startsWith('fec0')) return true // link-local / site-local
  if (/^f[cd]/.test(v)) return true                             // unique local fc00::/7
  if (v.startsWith('::ffff:')) return isPrivateIPv4(v.slice(7)) // IPv4-mapped
  return false
}

export interface CrawlableCheck {
  ok: boolean
  reason?: string
}

/**
 * เช็คว่า URL นี้ยิงได้ไหม — กัน SSRF (localhost, private range, link-local,
 * cloud metadata, IPv6 ภายใน) โดย resolve DNS จริงก่อน ไม่เชื่อแค่ hostname
 */
export async function assertCrawlable(url: string): Promise<CrawlableCheck> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, reason: 'invalid url' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'protocol not allowed' }

  const host = u.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'blocked host' }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, reason: 'internal host' }
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIPv4(host)) return { ok: false, reason: 'private ip' }
  if (host.includes(':') && isPrivateIPv6(host)) return { ok: false, reason: 'private ipv6' }

  try {
    const records = await lookup(host, { all: true })
    if (!records.length) return { ok: false, reason: 'dns not resolved' }
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) return { ok: false, reason: 'resolves to private ip' }
      if (r.family === 6 && isPrivateIPv6(r.address)) return { ok: false, reason: 'resolves to private ipv6' }
    }
  } catch {
    return { ok: false, reason: 'dns lookup failed' }
  }
  return { ok: true }
}

export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(new RegExp('[^\\p{L}\\p{N}\\p{M}]+', 'gu'), '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
  return base || 'page'
}
