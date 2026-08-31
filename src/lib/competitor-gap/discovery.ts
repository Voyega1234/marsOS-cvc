/**
 * Competitor Gap — URL discovery แบบฟรี: robots.txt → sitemap.xml (+ index) → internal links
 * ไม่ใช้ DataForSEO OnPage API และไม่เสียเงินในขั้นนี้
 */

import { fetchText } from './fetcher'
import { isCrawlWorthy, normalizeUrl, sameDomain } from './urls'

export const MAX_DISCOVER_URLS = 2000        // เพดาน URL ต่อโดเมน (กัน URL explosion)
const MAX_SITEMAP_FILES = 25

export interface RobotsInfo {
  found: boolean
  sitemaps: string[]
  disallow: string[]
  blocksRoot: boolean
}

export function parseRobots(txt: string): RobotsInfo {
  const info: RobotsInfo = { found: true, sitemaps: [], disallow: [], blocksRoot: false }
  let applies = false
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'sitemap') {
      const u = normalizeUrl(value)
      if (u) info.sitemaps.push(u)
      continue
    }
    if (key === 'user-agent') {
      applies = value === '*' || /marsos/i.test(value)
      continue
    }
    if (key === 'disallow' && applies && value) {
      info.disallow.push(value)
      if (value === '/') info.blocksRoot = true
    }
  }
  return info
}

export function isDisallowed(url: string, robots: RobotsInfo): boolean {
  if (!robots.found || robots.disallow.length === 0) return false
  try {
    const path = new URL(url).pathname
    return robots.disallow.some(rule => {
      if (rule === '/') return true
      const clean = rule.replace(/\*$/, '')
      return clean.length > 1 && path.startsWith(clean)
    })
  } catch {
    return false
  }
}

export async function fetchRobots(origin: string): Promise<RobotsInfo> {
  const txt = await fetchText(`${origin}/robots.txt`)
  if (!txt || !/user-agent|sitemap|disallow/i.test(txt)) {
    return { found: false, sitemaps: [], disallow: [], blocksRoot: false }
  }
  return parseRobots(txt)
}

function locsFromXml(xml: string): string[] {
  const out: string[] = []
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()
      // XML escape ใน <loc> — ถ้าไม่ถอด จะได้ URL ปลอมแบบ ...&amp;p=2
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    if (raw.startsWith('http')) out.push(raw)
  }
  return out
}

/** ดึง URL ทั้งหมดจาก sitemap (รองรับ sitemap index หลายชั้น) */
export async function fetchSitemapUrls(origin: string, domain: string, seeds: string[]): Promise<string[]> {
  const candidates = seeds.length
    ? seeds.slice()
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`, `${origin}/wp-sitemap.xml`, `${origin}/sitemap/sitemap.xml`]

  const queue = candidates.slice(0, MAX_SITEMAP_FILES)
  const visited = new Set<string>()
  const urls = new Set<string>()

  while (queue.length && visited.size < MAX_SITEMAP_FILES && urls.size < MAX_DISCOVER_URLS) {
    const file = queue.shift()!
    if (visited.has(file)) continue
    visited.add(file)

    const xml = await fetchText(file)
    if (!xml || !/<loc>/i.test(xml)) continue

    const locs = locsFromXml(xml)
    const isIndex = /<sitemapindex/i.test(xml)
    for (const loc of locs) {
      if (isIndex || /\.xml(\.gz)?($|\?)/i.test(loc)) {
        if (sameDomain(loc, domain) && !visited.has(loc) && queue.length < MAX_SITEMAP_FILES) queue.push(loc)
        continue
      }
      const n = normalizeUrl(loc)
      if (n && sameDomain(n, domain) && isCrawlWorthy(n)) urls.add(n)
      if (urls.size >= MAX_DISCOVER_URLS) break
    }
  }

  return Array.from(urls)
}
