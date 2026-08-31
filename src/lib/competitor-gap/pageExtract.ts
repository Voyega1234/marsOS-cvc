/**
 * Competitor Gap — ดึงข้อมูลหน้าเว็บจาก HTML ด้วย regex (ไม่เพิ่ม dependency)
 * เก็บเฉพาะค่าที่ "อ่านได้จริง" — ไม่มีข้อมูลคืน null/ค่าว่าง ห้ามเดา
 */

import { countWords } from '@/lib/wordgod/text/thai'
import { normalizeUrl, sameDomain } from './urls'

export interface ExtractedPage {
  title: string
  metaDescription: string
  h1: string
  h2: string[]
  canonical: string | null
  robotsMeta: string
  wordCount: number
  text: string
  internalLinks: number
  internalHrefs: string[]
  schemaTypes: string[]
  publishedDate: string | null
  modifiedDate: string | null
  jsSuspected: boolean
  hasList: boolean
  hasTable: boolean
  numberDensity: number
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
}

function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function firstMatch(html: string, re: RegExp): string {
  const m = re.exec(html)
  return m ? clean(m[1]) : ''
}

function metaContent(html: string, name: string, attr: 'name' | 'property' = 'name'): string {
  const re = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')
  const m = re.exec(html)
  if (m) return decodeEntities(m[1]).trim()
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${name}["']`, 'i')
  const m2 = re2.exec(html)
  return m2 ? decodeEntities(m2[1]).trim() : ''
}

/** ตัด nav/header/footer/script/style ออกก่อนนับคำ — ไม่งั้นเมนูจะถูกนับเป็นเนื้อหา */
function mainContent(html: string): string {
  let body = html
  body = body.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  body = body.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  body = body.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  body = body.replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
  body = body.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
  body = body.replace(/<header[\s\S]*?<\/header>/gi, ' ')
  body = body.replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
  body = body.replace(/<form[\s\S]*?<\/form>/gi, ' ')

  const article = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(body)
  const main = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(body)
  const picked = article?.[1] ?? main?.[1] ?? body
  return picked
}

function extractSchemaTypes(html: string): string[] {
  const types = new Set<string>()
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const walk = (node: any) => {
        if (!node) return
        if (Array.isArray(node)) { node.forEach(walk); return }
        if (typeof node !== 'object') return
        const t = node['@type']
        if (typeof t === 'string') types.add(t)
        else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x))
        if (node['@graph']) walk(node['@graph'])
      }
      walk(parsed)
    } catch { /* ld+json พัง — ข้าม ไม่เดา */ }
  }
  // microdata fallback
  const mi = /itemtype=["']https?:\/\/schema\.org\/([A-Za-z]+)["']/gi
  let m2: RegExpExecArray | null
  while ((m2 = mi.exec(html)) !== null) types.add(m2[1])
  return Array.from(types).slice(0, 12)
}

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  if (d.getFullYear() < 1995 || d.getFullYear() > new Date().getFullYear() + 1) return null
  return d.toISOString()
}

function extractDates(html: string): { published: string | null; modified: string | null } {
  const published =
    isoOrNull(metaContent(html, 'article:published_time', 'property')) ??
    isoOrNull(metaContent(html, 'datePublished')) ??
    isoOrNull(/"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1]) ??
    isoOrNull(/<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1])
  const modified =
    isoOrNull(metaContent(html, 'article:modified_time', 'property')) ??
    isoOrNull(metaContent(html, 'dateModified')) ??
    isoOrNull(/"dateModified"\s*:\s*"([^"]+)"/i.exec(html)?.[1])
  return { published, modified }
}

export function extractPage(html: string, pageUrl: string, domain: string): ExtractedPage {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const metaDescription = metaContent(html, 'description') || metaContent(html, 'og:description', 'property')
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)

  const h2: string[] = []
  const h2re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi
  let hm: RegExpExecArray | null
  while ((hm = h2re.exec(html)) !== null && h2.length < 25) {
    const t = clean(hm[1])
    if (t) h2.push(t.slice(0, 160))
  }

  const canonicalRaw = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1]
    ?? /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html)?.[1]
    ?? null
  const canonical = canonicalRaw ? normalizeUrl(decodeEntities(canonicalRaw), pageUrl) : null

  const robotsMeta = (metaContent(html, 'robots') + ' ' + metaContent(html, 'googlebot')).toLowerCase().trim()

  const body = mainContent(html)
  const text = clean(body)
  const wordCount = countWords(text)

  const internalHrefs: string[] = []
  const seen = new Set<string>()
  const are = /<a[^>]+href=["']([^"'#]+)["']/gi
  let am: RegExpExecArray | null
  while ((am = are.exec(html)) !== null) {
    const abs = normalizeUrl(decodeEntities(am[1]), pageUrl)
    if (!abs || !sameDomain(abs, domain)) continue
    if (seen.has(abs)) continue
    seen.add(abs)
    if (internalHrefs.length < 400) internalHrefs.push(abs)
  }

  const dates = extractDates(html)
  const numbers = (text.match(/\d[\d,.]*/g) ?? []).length
  const numberDensity = wordCount > 0 ? numbers / wordCount : 0

  // JS-rendered เดาแบบมีหลักฐาน: เนื้อหาน้อยมาก + มี root ของ SPA หรือ script เยอะกว่าข้อความ
  const spaShell = /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html)
  const jsSuspected = wordCount < 120 && (spaShell || html.length > 20_000)

  return {
    title,
    metaDescription,
    h1,
    h2,
    canonical,
    robotsMeta,
    wordCount,
    text,
    internalLinks: internalHrefs.length,
    internalHrefs,
    schemaTypes: extractSchemaTypes(html),
    publishedDate: dates.published,
    modifiedDate: dates.modified,
    jsSuspected,
    hasList: /<(ul|ol)[^>]*>[\s\S]*?<li/i.test(body),
    hasTable: /<table[^>]*>/i.test(body),
    numberDensity,
  }
}

export function needsJsRender(p: ExtractedPage): boolean {
  return p.jsSuspected
}
