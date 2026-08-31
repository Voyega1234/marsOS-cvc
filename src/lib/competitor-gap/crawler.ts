/**
 * Competitor Gap — self-hosted crawler (HTTP ก่อน, JS เป็น fallback)
 *
 * งบ crawl ต่อโดเมนจำกัดเสมอ: discovery ไม่เกิน MAX_DISCOVER_URLS (2,000)
 * และ "ดึงจริง" ไม่เกิน budget ที่ผู้ใช้ตั้ง — ไม่มี crawl ไม่รู้จบ
 */

import type { CrawlCoverage, PageRecord } from './types'
import { fetchHtml, getBrowserUnavailableReason, renderWithBrowser } from './fetcher'
import { extractPage, needsJsRender, type ExtractedPage } from './pageExtract'
import { MAX_DISCOVER_URLS, fetchRobots, fetchSitemapUrls, isDisallowed } from './discovery'
import { isCrawlWorthy, normalizeUrl, sameDomain } from './urls'

const CONCURRENCY = 6
const TIME_BUDGET_MS = 90_000

function depthOf(url: string): number {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length
  } catch {
    return 99
  }
}

function firstSegment(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] ?? ''
  } catch {
    return ''
  }
}

/**
 * เรียงคิว crawl ให้ "กระจายทั้งเว็บ" ไม่ใช่กองอยู่โฟลเดอร์เดียว:
 * หน้าตื้นก่อน แล้ววนทีละ section (round-robin ตาม path แรก)
 */
function orderFrontier(urls: string[], origin: string): string[] {
  const home = normalizeUrl(origin) ?? origin
  const buckets = new Map<string, string[]>()
  for (const u of urls) {
    if (u === home) continue
    const seg = firstSegment(u)
    const arr = buckets.get(seg) ?? []
    arr.push(u)
    buckets.set(seg, arr)
  }
  for (const arr of Array.from(buckets.values())) {
    arr.sort((a, b) => depthOf(a) - depthOf(b) || a.length - b.length)
  }
  const keys = Array.from(buckets.keys()).sort()
  const ordered: string[] = [home]
  let added = true
  let i = 0
  while (added) {
    added = false
    for (const k of keys) {
      const arr = buckets.get(k)!
      if (i < arr.length) {
        ordered.push(arr[i])
        added = true
      }
    }
    i++
  }
  return ordered
}

function toRecord(url: string, status: number, ex: ExtractedPage, rendered: boolean, redirectedTo: string | null): PageRecord {
  let path = url
  try { path = new URL(url).pathname } catch { /* keep url */ }

  const noindex = /\bnoindex\b/.test(ex.robotsMeta)
  const canonicalElsewhere = !!ex.canonical && normalizeUrl(ex.canonical) !== normalizeUrl(url)
  let nonIndexableReason: string | null = null
  if (status !== 200) nonIndexableReason = `HTTP ${status}`
  else if (noindex) nonIndexableReason = 'meta robots noindex'
  else if (canonicalElsewhere) nonIndexableReason = 'canonical ชี้ไปหน้าอื่น'
  // redirect ที่ปลายทางคือหน้านี้เอง (เช่น www → non-www) ไม่ทำให้หน้าปลายทาง index ไม่ได้
  // จะนับว่า index ไม่ได้ ต่อเมื่อปลายทางเป็นคนละ URL กับที่บันทึกไว้จริง
  else if (redirectedTo && normalizeUrl(redirectedTo) !== normalizeUrl(url)) nonIndexableReason = 'redirect'

  return {
    url,
    path,
    status,
    canonical: ex.canonical,
    indexable: nonIndexableReason === null,
    nonIndexableReason,
    title: ex.title.slice(0, 200),
    metaDescription: ex.metaDescription.slice(0, 300),
    h1: ex.h1.slice(0, 200),
    h2: ex.h2.slice(0, 12),
    wordCount: ex.wordCount,
    internalLinks: ex.internalLinks,
    schemaTypes: ex.schemaTypes,
    publishedDate: ex.publishedDate,
    modifiedDate: ex.modifiedDate,
    jsSuspected: ex.jsSuspected,
    jsRendered: rendered,
    hasList: ex.hasList,
    hasTable: ex.hasTable,
    numberDensity: Number(ex.numberDensity.toFixed(4)),
    pageType: 'other',
    classifiedBy: 'unknown',
    relevant: false,
    relevanceScore: 0,
    sample: [ex.metaDescription, ex.text].join(' ').replace(/\s+/g, ' ').trim().slice(0, 450),
    qualityScore: null,
    qualityDims: undefined,
  }
}

export interface CrawlOptions {
  budget: number
  jsFallback: boolean
}

export interface CrawlOutput {
  pages: PageRecord[]
  coverage: CrawlCoverage
}

export async function crawlDomain(origin: string, domain: string, opts: CrawlOptions): Promise<CrawlOutput> {
  const started = Date.now()
  const notes: string[] = []
  const coverage: CrawlCoverage = {
    robotsFound: false, robotsBlockedRoot: false, sitemapUrls: 0, discovered: 0,
    crawled: 0, ok: 0, redirects: 0, nonIndexable: 0, blocked: 0, errors: 0,
    jsSuspected: 0, jsRendered: 0, truncated: false, confidence: 'low', notes,
  }

  const robots = await fetchRobots(origin)
  coverage.robotsFound = robots.found
  coverage.robotsBlockedRoot = robots.blocksRoot
  if (robots.blocksRoot) notes.push('robots.txt ปิดทั้งเว็บสำหรับบอททั่วไป — เก็บได้เท่าที่ sitemap เปิดให้')

  const sitemapUrls = await fetchSitemapUrls(origin, domain, robots.sitemaps)
  coverage.sitemapUrls = sitemapUrls.length
  if (sitemapUrls.length === 0) notes.push('ไม่พบ sitemap.xml — ใช้การไล่ลิงก์ภายในแทน (ความครอบคลุมต่ำกว่า)')

  const discovered = new Set<string>()
  const home = normalizeUrl(origin)
  if (home) discovered.add(home)
  for (const u of sitemapUrls) {
    if (discovered.size >= MAX_DISCOVER_URLS) break
    if (!isDisallowed(u, robots)) discovered.add(u)
  }

  const pages: PageRecord[] = []
  const visited = new Set<string>()
  /** URL ปลายทางที่บันทึกเป็นหน้าไปแล้ว (กันนับซ้ำจาก redirect หลายต้นทาง) */
  const recorded = new Set<string>()
  let jsRenderTried = 0

  const crawlOne = async (url: string): Promise<void> => {
    if (visited.has(url)) return
    visited.add(url)
    coverage.crawled++

    const res = await fetchHtml(url)
    if (res.blocked) { coverage.blocked++; return }
    if (!res.ok) { coverage.errors++; return }
    if (res.redirected) coverage.redirects++

    let ex = extractPage(res.html, res.finalUrl || url, domain)
    let rendered = false

    if (ex.jsSuspected) {
      coverage.jsSuspected++
      if (opts.jsFallback && jsRenderTried < 8) {
        jsRenderTried++
        const r = await renderWithBrowser(url)
        if (r?.ok) {
          ex = extractPage(r.html, r.finalUrl || url, domain)
          rendered = true
          coverage.jsRendered++
        }
      }
    }

    const rec = toRecord(res.finalUrl || url, res.status, ex, rendered, res.redirected ? res.finalUrl : null)
    // หลาย URL ต้นทางอาจ redirect มาลงหน้าเดียวกัน — นับเป็นหน้าเดียว ไม่งั้นสถิติหน้าจะเฟ้อ
    const finalKey = normalizeUrl(rec.url) ?? rec.url
    if (recorded.has(finalKey)) return
    recorded.add(finalKey)
    visited.add(finalKey)
    coverage.ok++
    if (!rec.indexable) coverage.nonIndexable++
    pages.push(rec)

    // เก็บลิงก์ภายในไว้ขยาย frontier (สำคัญมากเมื่อไม่มี sitemap)
    if (discovered.size < MAX_DISCOVER_URLS) {
      for (const href of ex.internalHrefs) {
        if (discovered.size >= MAX_DISCOVER_URLS) break
        if (!sameDomain(href, domain) || !isCrawlWorthy(href)) continue
        if (isDisallowed(href, robots)) continue
        discovered.add(href)
      }
    }
  }

  // รอบแรก: หน้าแรก (ได้ลิงก์ภายในมาต่อยอด frontier)
  if (home) await crawlOne(home)

  while (pages.length + coverage.errors + coverage.blocked < opts.budget) {
    if (Date.now() - started > TIME_BUDGET_MS) { coverage.truncated = true; notes.push('หยุดตามเวลาที่จัดสรรต่อโดเมน'); break }
    const frontier = orderFrontier(Array.from(discovered), origin).filter(u => !visited.has(u))
    if (frontier.length === 0) break
    const room = Math.max(0, opts.budget - (pages.length + coverage.errors + coverage.blocked))
    const batch = frontier.slice(0, Math.min(CONCURRENCY, room))
    if (batch.length === 0) break
    await Promise.all(batch.map(crawlOne))
  }

  coverage.discovered = discovered.size
  if (discovered.size >= MAX_DISCOVER_URLS) {
    coverage.truncated = true
    notes.push(`หยุดค้นหา URL ที่เพดาน ${MAX_DISCOVER_URLS} ต่อโดเมน`)
  }
  if (visited.size < discovered.size) {
    coverage.truncated = true
  }

  const browserNote = getBrowserUnavailableReason()
  if (coverage.jsSuspected > 0 && coverage.jsRendered === 0 && browserNote) {
    notes.push('พบหน้าที่เนื้อหาน่าจะ render ด้วย JavaScript แต่ระบบ render ไม่ได้ในสภาพแวดล้อมนี้ — หน้ากลุ่มนี้อาจถูกนับต่ำกว่าจริง')
  }

  // ความเชื่อมั่นของความครอบคลุม — อ้างอิงสัดส่วนที่เก็บได้จริงเทียบกับที่ค้นพบ
  const ratio = coverage.discovered > 0 ? coverage.ok / coverage.discovered : 0
  if (coverage.ok === 0) coverage.confidence = 'low'
  else if (!coverage.truncated && ratio >= 0.8) coverage.confidence = 'high'
  else if (ratio >= 0.35 || coverage.ok >= 60) coverage.confidence = 'medium'
  else coverage.confidence = 'low'

  if (coverage.blocked > 0) notes.push(`${coverage.blocked} URL ถูกบล็อก (403/401/429) — วิเคราะห์ต่อด้วยข้อมูลเท่าที่มี`)

  return { pages, coverage }
}
