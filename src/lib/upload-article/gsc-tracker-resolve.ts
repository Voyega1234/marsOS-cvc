// ─── Report Monitor — แปลงลิงก์เลขโพสต์ WordPress (?p=123) เป็นลิงก์จริงที่ GSC รู้จัก ─────
// server-only: ยิง HEAD/GET ตาม redirect ด้วยมือ (ไม่อ่าน body) — กัน SSRF 2 ชั้น:
// 1) ทุก hop ต้องเป็นโฮสต์ของเว็บ GSC ที่เลือกไว้เท่านั้น 2) assertCrawlable (resolve DNS กัน private IP)
import { assertCrawlable } from '@/lib/competitor-gap/urls'
import { isIdPermalinkUrl } from './gsc-trackers'

const MAX_HOPS = 4
const HOP_TIMEOUT_MS = 5000
const OK_TTL_MS = 60 * 60 * 1000
const FAIL_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 500

const cache = new Map<string, { value: string | null; expiresAt: number }>()

function stripWww(h: string): string {
  return h.replace(/^www\./, '')
}

/** โฮสต์ที่อนุญาตสำหรับเว็บ GSC: 'sc-domain:example.com' → example.com + ซับโดเมนทั้งหมด; 'https://www.example.com/' → โฮสต์นั้น มี/ไม่มี www */
export function isHostAllowedForSite(host: string, gscSiteUrl: string): boolean {
  const h = (host || '').trim().toLowerCase().replace(/\.$/, '')
  const site = (gscSiteUrl || '').trim()
  if (!h || !site) return false
  if (site.toLowerCase().startsWith('sc-domain:')) {
    const domain = site.slice('sc-domain:'.length).trim().toLowerCase().replace(/\.$/, '')
    if (!domain || !domain.includes('.')) return false
    return h === domain || h.endsWith(`.${domain}`)
  }
  try {
    const siteHost = new URL(site).hostname.toLowerCase()
    if (!siteHost) return false
    return stripWww(h) === stripWww(siteHost)
  } catch {
    return false
  }
}

function getCached(key: string): { hit: boolean; value: string | null } {
  const e = cache.get(key)
  if (!e) return { hit: false, value: null }
  if (Date.now() > e.expiresAt) { cache.delete(key); return { hit: false, value: null } }
  return { hit: true, value: e.value }
}

function setCached(key: string, value: string | null) {
  cache.set(key, { value, expiresAt: Date.now() + (value ? OK_TTL_MS : FAIL_TTL_MS) })
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

async function fetchHop(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HOP_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarsOS-Monitor/1.0)' } })
    // ไม่อ่าน body — ยกเลิกทันที
    res.body?.cancel().catch(() => {})
    return res
  } finally {
    clearTimeout(timer)
  }
}

async function follow(url: string, gscSiteUrl: string): Promise<string | null> {
  let current = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let u: URL
    try { u = new URL(current) } catch { return null }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!isHostAllowedForSite(u.hostname, gscSiteUrl)) return null
    if (u.port !== '' && u.port !== '80' && u.port !== '443') return null
    if (!(await assertCrawlable(current)).ok) return null

    if (hop > 0 && !isIdPermalinkUrl(current)) return current
    if (hop === MAX_HOPS) return null

    let res = await fetchHop(current, 'HEAD')
    if (res.status === 405 || res.status === 501) res = await fetchHop(current, 'GET')
    if (res.status < 300 || res.status >= 400) return null
    const loc = res.headers.get('location')
    if (!loc) return null
    try { current = new URL(loc, current).toString() } catch { return null }
  }
  return null
}

/** ตามลิงก์ ?p=123 ไปยังลิงก์จริง — null เมื่อไม่ใช่ลิงก์เลขโพสต์ / โฮสต์ไม่อนุญาต / ไม่มี redirect / ผิดพลาดใด ๆ (ไม่ throw) */
export async function resolveIdPermalink(url: string, gscSiteUrl: string): Promise<string | null> {
  try {
    if (!isIdPermalinkUrl(url)) return null
    const key = `${gscSiteUrl}\u0001${url}`
    const c = getCached(key)
    if (c.hit) return c.value
    const resolved = await follow(url, gscSiteUrl)
    const final = resolved && !isIdPermalinkUrl(resolved) ? resolved : null
    setCached(key, final)
    return final
  } catch {
    return null
  }
}
