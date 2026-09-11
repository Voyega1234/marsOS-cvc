// ─────────────────────────────────────────────────────────────────────────────
//  SEO Audit Scanner — ตรวจเว็บจริงแล้วบอกว่าแต่ละ task ต้องแก้อะไร พร้อมหลักฐาน
//
//  (คำสั่งเจ้าของ 2026-09-11) หน้า On-Page SEO / Technical SEO / Indexing &
//  Crawling เดิมมีแต่ checklist ให้ติ๊กเอง ตัวนี้เพิ่มปุ่มสแกนที่ไปอ่านเว็บจริง
//  แล้วคืนรายการปัญหาที่พบ ทีมเลือกได้ว่าจะสร้างเป็นงานใน SeoTask ข้อไหนบ้าง
//  และยังเพิ่มงานเองได้เหมือนเดิม
//
//  เครื่องมือที่ใช้ (ไม่เพิ่ม dependency ใหม่):
//  - crawler ของ Competitor Gap (fetchHtml / fetchText / extractPage) ผ่าน
//    SSRF guard เดิมทุกครั้ง
//  - robots.txt + sitemap.xml ของเว็บเอง
//  - PageSpeed Insights API (ไม่ต้องมี key ก็เรียกได้ แต่โควตาต่ำ —
//    ใส่ PAGESPEED_API_KEY เพื่อความเสถียร)
//
//  สิ่งที่ตรวจไม่ได้จากภายนอกจะไม่เดา แต่จะคืนไว้ใน needsTools เพื่อบอกทีมว่า
//  ต้องต่อเครื่องมืออะไรเพิ่ม (เช่น Search Console สำหรับสถานะ index)
// ─────────────────────────────────────────────────────────────────────────────

import { fetchHtml, fetchText } from '@/lib/competitor-gap/fetcher'
import { extractPage, type ExtractedPage } from '@/lib/competitor-gap/pageExtract'
import { assertCrawlable, normalizeUrl, toOrigin } from '@/lib/competitor-gap/urls'
import type { SeoTaskArea, SeoTaskPriority } from '@/lib/seo-check-templates'

export interface SeoFinding {
  /** id เสถียรพอที่ UI ใช้เป็น key และกันสร้างงานซ้ำได้ */
  id: string
  area: SeoTaskArea
  /** ต้องตรงกับ category id ใน seo-check-templates.ts */
  category: string
  title: string
  detail: string
  /** สิ่งที่อ่านได้จริงจากเว็บ — ห้ามเป็นคำแนะนำลอย ๆ */
  evidence: string
  priority: SeoTaskPriority
  severity: 'fail' | 'warn'
  /** หน้าแรกที่พบปัญหา (ถ้าเจาะจงได้) */
  url?: string
  /** จำนวนหน้าที่เจอปัญหาเดียวกัน */
  count: number
}

export interface SeoAuditPage {
  url: string
  status: number
  title: string
  titleLength: number
  metaDescription: string
  descriptionLength: number
  h1Count: number
  wordCount: number
  images: number
  imagesWithAlt: number
  internalLinks: number
  canonical: string | null
  noindex: boolean
  lang: string | null
  hasViewport: boolean
  schemaTypes: string[]
  bytes: number
  ms: number
}

export interface SeoAuditResult {
  website: string
  scannedAt: string
  pages: SeoAuditPage[]
  findings: SeoFinding[]
  /** ข้อที่ตรวจแล้วผ่าน — ให้ทีมเห็นว่าสแกนครอบคลุมอะไรบ้าง */
  passed: Array<{ area: SeoTaskArea; category: string; label: string; evidence: string }>
  /** สิ่งที่ต้องต่อเครื่องมือเพิ่มถึงจะตรวจได้ */
  needsTools: Array<{ label: string; reason: string }>
  warnings: string[]
  stats: { pagesScanned: number; linksChecked: number; brokenLinks: number; durationMs: number }
}

const DEFAULT_MAX_PAGES = 25
const HARD_MAX_PAGES = 40
const MAX_LINK_CHECKS = 60
const LINK_TIMEOUT_MS = 8_000
const UA = 'Mozilla/5.0 (compatible; MarsOS-SeoAudit/1.0; +https://convertcake.com/bot)'

// ── helpers ───────────────────────────────────────────────────────────────────

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./i, '') === new URL(b).hostname.replace(/^www\./i, '')
  } catch {
    return false
  }
}

function textOf(html: string, re: RegExp): string | null {
  const m = html.match(re)
  return m ? m[1] : null
}

function countTags(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length
}

/** ลำดับ heading ตามที่ปรากฏจริงในหน้า — ใช้ตรวจการข้ามระดับ */
function headingLevels(html: string): number[] {
  const out: number[] = []
  const re = /<h([1-6])[\s>]/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.push(Number(m[1]))
  return out
}

async function checkStatus(url: string): Promise<number> {
  const guard = await assertCrawlable(url)
  if (!guard.ok) return 0
  const opts = { signal: AbortSignal.timeout(LINK_TIMEOUT_MS), headers: { 'User-Agent': UA }, redirect: 'follow' as const }
  try {
    const head = await fetch(url, { ...opts, method: 'HEAD' })
    // บางเซิร์ฟเวอร์ไม่รองรับ HEAD แล้วตอบ 405/501 — ลองซ้ำด้วย GET
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, { ...opts, method: 'GET' })
      return get.status
    }
    return head.status
  } catch {
    return 0
  }
}

/** ดึง <loc> จาก sitemap และตาม sitemapindex ลงไปหนึ่งชั้น */
async function collectSitemapUrls(sitemapUrl: string, cap: number, warnings: string[]): Promise<{ urls: string[]; ok: boolean; isIndex: boolean }> {
  const xml = await fetchText(sitemapUrl)
  if (!xml) {
    warnings.push(`อ่าน sitemap ไม่ได้: ${sitemapUrl}`)
    return { urls: [], ok: false, isIndex: false }
  }
  const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1])
  const isIndex = /<sitemapindex/i.test(xml)
  if (!isIndex) return { urls: locs.slice(0, cap), ok: true, isIndex: false }

  const out: string[] = []
  for (const child of locs.slice(0, 5)) {
    const childXml = await fetchText(child)
    if (!childXml) continue
    out.push(...Array.from(childXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1]))
    if (out.length >= cap) break
  }
  return { urls: out.slice(0, cap), ok: true, isIndex: true }
}

interface PsiResult {
  ok: boolean
  performance: number | null
  seo: number | null
  lcpMs: number | null
  clsValue: number | null
  tbtMs: number | null
  error: string | null
}

async function runPageSpeed(url: string): Promise<PsiResult> {
  const key = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY || ''
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  api.searchParams.set('url', url)
  api.searchParams.set('strategy', 'mobile')
  api.searchParams.append('category', 'PERFORMANCE')
  api.searchParams.append('category', 'SEO')
  if (key) api.searchParams.set('key', key)
  try {
    const res = await fetch(api.toString(), { signal: AbortSignal.timeout(70_000) })
    if (!res.ok) return { ok: false, performance: null, seo: null, lcpMs: null, clsValue: null, tbtMs: null, error: `HTTP ${res.status}` }
    const json: any = await res.json()
    const cats = json?.lighthouseResult?.categories ?? {}
    const audits = json?.lighthouseResult?.audits ?? {}
    const score = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) : null)
    return {
      ok: true,
      performance: score(cats.performance?.score),
      seo: score(cats.seo?.score),
      lcpMs: typeof audits['largest-contentful-paint']?.numericValue === 'number' ? Math.round(audits['largest-contentful-paint'].numericValue) : null,
      clsValue: typeof audits['cumulative-layout-shift']?.numericValue === 'number' ? Number(audits['cumulative-layout-shift'].numericValue.toFixed(3)) : null,
      tbtMs: typeof audits['total-blocking-time']?.numericValue === 'number' ? Math.round(audits['total-blocking-time'].numericValue) : null,
      error: null,
    }
  } catch (e) {
    return { ok: false, performance: null, seo: null, lcpMs: null, clsValue: null, tbtMs: null, error: e instanceof Error ? e.message.slice(0, 120) : 'PSI ล้มเหลว' }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

export async function runSeoAudit(rawUrl: string, opts?: { maxPages?: number }): Promise<SeoAuditResult> {
  const started = Date.now()
  const origin = toOrigin(rawUrl)
  if (!origin) throw new Error('URL ไม่ถูกต้อง')
  const host = new URL(origin).hostname
  const maxPages = Math.min(Math.max(opts?.maxPages ?? DEFAULT_MAX_PAGES, 1), HARD_MAX_PAGES)

  const warnings: string[] = []
  const findings: SeoFinding[] = []
  const passed: SeoAuditResult['passed'] = []
  const needsTools: SeoAuditResult['needsTools'] = []

  const add = (f: Omit<SeoFinding, 'count'> & { count?: number }) => {
    findings.push({ ...f, count: f.count ?? 1 })
  }

  // ── 1. robots.txt ──────────────────────────────────────────────────────────
  const robotsTxt = await fetchText(`${origin}/robots.txt`)
  let sitemapFromRobots: string | null = null
  if (!robotsTxt) {
    add({
      id: 'robots-missing', area: 'TECHNICAL', category: 'robots', priority: 'HIGH', severity: 'fail',
      title: 'สร้างไฟล์ robots.txt ที่ราก domain',
      detail: 'robots.txt บอกบอทว่า crawl อะไรได้บ้าง และเป็นที่ประกาศ sitemap ให้ Google เจอเร็วขึ้น',
      evidence: `GET ${origin}/robots.txt อ่านไม่ได้หรือไม่มีไฟล์`,
      url: `${origin}/robots.txt`,
    })
  } else {
    let inStar = false
    let disallowRoot = false
    for (const line of robotsTxt.split(/\r?\n/)) {
      const t = line.trim()
      if (/^user-agent:\s*\*/i.test(t)) inStar = true
      else if (/^user-agent:/i.test(t)) inStar = false
      if (inStar && /^disallow:\s*\/\s*$/i.test(t)) disallowRoot = true
      const sm = t.match(/^sitemap:\s*(\S+)/i)
      if (sm) sitemapFromRobots = sm[1]
    }
    if (disallowRoot) {
      add({
        id: 'robots-disallow-all', area: 'TECHNICAL', category: 'robots', priority: 'CRITICAL', severity: 'fail',
        title: 'เอา Disallow: / ออกจาก robots.txt',
        detail: 'ตอนนี้ robots.txt ปิดทั้งเว็บไม่ให้บอททุกตัวเข้า ทำให้ทั้งเว็บหลุดจากผลการค้นหา',
        evidence: `พบ "User-agent: *" ตามด้วย "Disallow: /" ใน ${origin}/robots.txt`,
        url: `${origin}/robots.txt`,
      })
    }
    if (!sitemapFromRobots) {
      add({
        id: 'robots-no-sitemap', area: 'TECHNICAL', category: 'robots', priority: 'MEDIUM', severity: 'warn',
        title: 'เพิ่มบรรทัด Sitemap: ใน robots.txt',
        detail: 'ประกาศ URL ของ sitemap ใน robots.txt ให้บอทหาเจอโดยไม่ต้องเดา',
        evidence: `robots.txt มีอยู่ (${robotsTxt.length} ตัวอักษร) แต่ไม่มีบรรทัดขึ้นต้นด้วย "Sitemap:"`,
        url: `${origin}/robots.txt`,
      })
    } else if (!disallowRoot) {
      passed.push({ area: 'TECHNICAL', category: 'robots', label: 'robots.txt', evidence: `ไม่บล็อกทั้งเว็บ และประกาศ Sitemap: ${sitemapFromRobots}` })
    }
  }

  // ── 2. sitemap.xml ─────────────────────────────────────────────────────────
  const sitemapUrl = sitemapFromRobots || `${origin}/sitemap.xml`
  const sitemap = await collectSitemapUrls(sitemapUrl, 300, warnings)
  if (!sitemap.ok) {
    add({
      id: 'sitemap-missing', area: 'TECHNICAL', category: 'sitemap', priority: 'HIGH', severity: 'fail',
      title: 'สร้าง XML sitemap และส่งเข้า Search Console',
      detail: 'sitemap ช่วยให้ Google เจอหน้าสำคัญครบและรู้ว่าหน้าไหนเพิ่งอัปเดต',
      evidence: `GET ${sitemapUrl} ไม่คืน XML ที่อ่านได้`,
      url: sitemapUrl,
    })
  } else if (sitemap.urls.length === 0) {
    add({
      id: 'sitemap-empty', area: 'TECHNICAL', category: 'sitemap', priority: 'HIGH', severity: 'fail',
      title: 'เติม URL ลงใน sitemap',
      detail: 'sitemap มีอยู่แต่ไม่มี <loc> เลย บอทจึงไม่ได้รายชื่อหน้าจากไฟล์นี้',
      evidence: `${sitemapUrl} เป็น XML ที่อ่านได้ แต่นับ <loc> ได้ 0 รายการ`,
      url: sitemapUrl,
    })
  } else {
    passed.push({
      area: 'TECHNICAL', category: 'sitemap', label: 'Sitemap',
      evidence: `${sitemapUrl} มี ${sitemap.urls.length} URL${sitemap.isIndex ? ' (เป็น sitemapindex)' : ''}`,
    })
  }

  // ── 3. https / www ─────────────────────────────────────────────────────────
  try {
    const res = await fetch(`http://${host}`, { redirect: 'manual', signal: AbortSignal.timeout(LINK_TIMEOUT_MS), headers: { 'User-Agent': UA } })
    const loc = res.headers.get('location') || ''
    if (res.status >= 300 && res.status < 400 && loc.startsWith('https://')) {
      passed.push({ area: 'TECHNICAL', category: 'https-security', label: 'HTTPS redirect', evidence: `http://${host} ตอบ ${res.status} ไปยัง ${loc}` })
    } else {
      add({
        id: 'https-no-redirect', area: 'TECHNICAL', category: 'https-security', priority: 'HIGH', severity: 'fail',
        title: 'บังคับ redirect จาก http ไป https ทั้งเว็บ',
        detail: 'ให้ http ทุก URL ตอบ 301 ไป https ตัวเดียวกัน กันเนื้อหาซ้ำและปิดช่องส่งข้อมูลแบบไม่เข้ารหัส',
        evidence: `http://${host} ตอบ HTTP ${res.status}${loc ? ` ไปยัง ${loc}` : ' โดยไม่มี Location'}`,
        url: `http://${host}`,
      })
    }
  } catch {
    warnings.push(`เชื่อมต่อ http://${host} ไม่ได้ — ข้ามการตรวจ redirect`)
  }

  const altHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`
  try {
    const res = await fetch(`https://${altHost}`, { redirect: 'follow', signal: AbortSignal.timeout(LINK_TIMEOUT_MS), headers: { 'User-Agent': UA } })
    const finalHost = res.ok ? new URL(res.url).hostname : ''
    if (finalHost && finalHost === altHost) {
      add({
        id: 'www-duplicate', area: 'INDEXING', category: 'duplicate-without-canonical', priority: 'HIGH', severity: 'fail',
        title: `รวมโดเมนให้เหลือชุดเดียว (${host} หรือ ${altHost})`,
        detail: 'ตอนนี้เปิดได้ทั้งสองโดเมนโดยไม่ redirect หากัน Google จะเห็นเป็นเว็บซ้ำสองชุด',
        evidence: `https://${altHost} ตอบ ${res.status} และจบที่ ${finalHost} ไม่ได้ redirect มาที่ ${host}`,
        url: `https://${altHost}`,
      })
    } else if (finalHost) {
      passed.push({ area: 'INDEXING', category: 'duplicate-without-canonical', label: 'www / non-www', evidence: `https://${altHost} จบที่ ${finalHost}` })
    }
  } catch {
    passed.push({ area: 'INDEXING', category: 'duplicate-without-canonical', label: 'www / non-www', evidence: `https://${altHost} เข้าไม่ได้ — มีโดเมนหลักชุดเดียว` })
  }

  // ── 4. หน้า 404 ────────────────────────────────────────────────────────────
  const probe404 = `${origin}/marsos-404-probe-${Date.now()}`
  const probeStatus = await checkStatus(probe404)
  if (probeStatus === 200) {
    add({
      id: 'soft-404', area: 'INDEXING', category: 'not-found-redirect', priority: 'HIGH', severity: 'fail',
      title: 'ให้ URL ที่ไม่มีจริงคืนสถานะ 404',
      detail: 'ตอนนี้ URL มั่วก็ยังตอบ 200 (soft 404) ทำให้ Google เก็บหน้าขยะเข้า index และกิน crawl budget',
      evidence: `GET ${probe404} คืน HTTP 200 ทั้งที่ไม่มีหน้านี้จริง`,
      url: probe404,
    })
  } else if (probeStatus === 404 || probeStatus === 410) {
    passed.push({ area: 'INDEXING', category: 'not-found-redirect', label: 'สถานะ 404', evidence: `URL ที่ไม่มีจริงคืน HTTP ${probeStatus}` })
  }

  // ── 5. crawl หน้าเว็บ ──────────────────────────────────────────────────────
  const queue: string[] = []
  const seen = new Set<string>()
  const push = (u: string | null) => {
    if (!u) return
    if (!sameHost(u, origin)) return
    if (seen.has(u)) return
    seen.add(u)
    queue.push(u)
  }
  push(normalizeUrl(origin))
  for (const u of sitemap.urls) push(normalizeUrl(u))

  const pages: SeoAuditPage[] = []
  const extracted = new Map<string, ExtractedPage>()
  const rawHtml = new Map<string, string>()
  const allInternalHrefs = new Set<string>()
  const linkedTo = new Set<string>()
  const serverErrors: Array<{ url: string; status: number }> = []

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!
    const t0 = Date.now()
    const r = await fetchHtml(url)
    const ms = Date.now() - t0
    if (!r.ok) {
      if (r.status >= 500) serverErrors.push({ url, status: r.status })
      if (r.blocked) warnings.push(`ถูกบล็อกที่ ${url} (${r.error ?? 'blocked'})`)
      continue
    }
    const page = extractPage(r.html, r.finalUrl || url, host)
    extracted.set(url, page)
    rawHtml.set(url, r.html)

    const h1Count = countTags(r.html, 'h1')
    const noindex = /noindex/i.test(page.robotsMeta) || /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(r.html)
    const lang = textOf(r.html, /<html[^>]+lang=["']([^"']+)["']/i)
    pages.push({
      url,
      status: r.status,
      title: page.title,
      titleLength: page.title.length,
      metaDescription: page.metaDescription,
      descriptionLength: page.metaDescription.length,
      h1Count,
      wordCount: page.wordCount,
      images: page.images,
      imagesWithAlt: page.imagesWithAlt,
      internalLinks: page.internalLinks,
      canonical: page.canonical,
      noindex,
      lang,
      hasViewport: /<meta[^>]+name=["']viewport["']/i.test(r.html),
      schemaTypes: page.schemaTypes,
      bytes: r.bytes,
      ms,
    })

    for (const href of page.internalHrefs) {
      const n = normalizeUrl(href, url)
      if (!n || !sameHost(n, origin)) continue
      allInternalHrefs.add(n)
      linkedTo.add(n)
      push(n)
    }
  }

  if (pages.length === 0) {
    throw new Error(`อ่านหน้าเว็บไม่ได้เลยจาก ${origin} — ตรวจ URL หรือระบบป้องกันบอทของเว็บ`)
  }

  // ── 6. ปัญหาระดับหน้า ──────────────────────────────────────────────────────
  const group = <T>(items: T[], label: (t: T) => string) => items.map(label)

  const noTitle = pages.filter((p) => !p.title.trim())
  if (noTitle.length) {
    add({
      id: 'title-missing', area: 'ONPAGE', category: 'title-meta', priority: 'CRITICAL', severity: 'fail',
      title: `ใส่ <title> ให้หน้าที่ยังไม่มี (${noTitle.length} หน้า)`,
      detail: 'ทุกหน้าต้องมี title ที่ไม่ซ้ำกันและมีคีย์เวิร์ดหลักของหน้านั้น',
      evidence: group(noTitle.slice(0, 10), (p) => p.url).join('\n'),
      url: noTitle[0].url, count: noTitle.length,
    })
  }

  const badTitleLen = pages.filter((p) => p.title.trim() && (p.titleLength < 30 || p.titleLength > 65))
  if (badTitleLen.length) {
    add({
      id: 'title-length', area: 'ONPAGE', category: 'title-meta', priority: 'MEDIUM', severity: 'warn',
      title: `ปรับความยาว title ให้อยู่ราว 50-60 ตัวอักษร (${badTitleLen.length} หน้า)`,
      detail: 'title สั้นเกินไปสื่อไม่ครบ ยาวเกินไปถูกตัดในหน้าผลการค้นหา',
      evidence: group(badTitleLen.slice(0, 10), (p) => `${p.titleLength} ตัวอักษร — ${p.url}\n  "${p.title.slice(0, 80)}"`).join('\n'),
      url: badTitleLen[0].url, count: badTitleLen.length,
    })
  }

  const dupTitles = new Map<string, string[]>()
  for (const p of pages) {
    const k = p.title.trim().toLowerCase()
    if (!k) continue
    dupTitles.set(k, [...(dupTitles.get(k) ?? []), p.url])
  }
  const dupTitleGroups = Array.from(dupTitles.entries()).filter(([, urls]) => urls.length > 1)
  if (dupTitleGroups.length) {
    add({
      id: 'title-duplicate', area: 'ONPAGE', category: 'title-meta', priority: 'HIGH', severity: 'fail',
      title: `แก้ title ที่ซ้ำกัน (${dupTitleGroups.length} ชุด)`,
      detail: 'title ซ้ำทำให้ Google แยกไม่ออกว่าหน้าไหนควรติดอันดับ และเสี่ยงถูกมองเป็นเนื้อหาซ้ำ',
      evidence: dupTitleGroups.slice(0, 5).map(([t, urls]) => `"${t.slice(0, 60)}"\n  ${urls.slice(0, 4).join('\n  ')}`).join('\n'),
      url: dupTitleGroups[0][1][0], count: dupTitleGroups.length,
    })
  }

  const noDesc = pages.filter((p) => !p.metaDescription.trim())
  if (noDesc.length) {
    add({
      id: 'meta-desc-missing', area: 'ONPAGE', category: 'title-meta', priority: 'HIGH', severity: 'fail',
      title: `เขียน meta description ให้หน้าที่ยังไม่มี (${noDesc.length} หน้า)`,
      detail: 'meta description คือข้อความชวนคลิกใต้ title ในหน้าผลการค้นหา ยาว 120-158 ตัวอักษร',
      evidence: group(noDesc.slice(0, 10), (p) => p.url).join('\n'),
      url: noDesc[0].url, count: noDesc.length,
    })
  }

  const badDescLen = pages.filter((p) => p.metaDescription.trim() && (p.descriptionLength < 80 || p.descriptionLength > 170))
  if (badDescLen.length) {
    add({
      id: 'meta-desc-length', area: 'ONPAGE', category: 'title-meta', priority: 'LOW', severity: 'warn',
      title: `ปรับความยาว meta description ให้อยู่ราว 120-158 ตัวอักษร (${badDescLen.length} หน้า)`,
      detail: 'สั้นเกินไปไม่พอชวนคลิก ยาวเกินไปถูกตัดกลางประโยค',
      evidence: group(badDescLen.slice(0, 10), (p) => `${p.descriptionLength} ตัวอักษร — ${p.url}`).join('\n'),
      url: badDescLen[0].url, count: badDescLen.length,
    })
  }

  const noH1 = pages.filter((p) => p.h1Count === 0)
  if (noH1.length) {
    add({
      id: 'h1-missing', area: 'ONPAGE', category: 'heading', priority: 'HIGH', severity: 'fail',
      title: `เพิ่ม H1 ให้หน้าที่ยังไม่มี (${noH1.length} หน้า)`,
      detail: 'H1 คือหัวข้อหลักของหน้า ควรมีหนึ่งอันและมีคีย์เวิร์ดหลัก',
      evidence: group(noH1.slice(0, 10), (p) => p.url).join('\n'),
      url: noH1[0].url, count: noH1.length,
    })
  }

  const multiH1 = pages.filter((p) => p.h1Count > 1)
  if (multiH1.length) {
    add({
      id: 'h1-multiple', area: 'ONPAGE', category: 'heading', priority: 'MEDIUM', severity: 'warn',
      title: `ลด H1 ให้เหลือหน้าละหนึ่งอัน (${multiH1.length} หน้า)`,
      detail: 'H1 หลายอันทำให้ลำดับชั้นหัวข้อกำกวม เปลี่ยนอันที่เหลือเป็น H2',
      evidence: group(multiH1.slice(0, 10), (p) => `${p.h1Count} อัน — ${p.url}`).join('\n'),
      url: multiH1[0].url, count: multiH1.length,
    })
  }

  const skipped: string[] = []
  rawHtml.forEach((html, url) => {
    const levels = headingLevels(html)
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        skipped.push(`${url} — H${levels[i - 1]} ตามด้วย H${levels[i]}`)
        break
      }
    }
  })
  if (skipped.length) {
    add({
      id: 'heading-skip', area: 'ONPAGE', category: 'heading', priority: 'LOW', severity: 'warn',
      title: `แก้ลำดับ heading ที่ข้ามระดับ (${skipped.length} หน้า)`,
      detail: 'ไล่ H2 ไป H3 ตามลำดับ อย่ากระโดดข้ามระดับ',
      evidence: skipped.slice(0, 10).join('\n'),
      count: skipped.length,
    })
  }

  const thin = pages.filter((p) => p.wordCount > 0 && p.wordCount < 300)
  if (thin.length) {
    add({
      id: 'thin-content', area: 'ONPAGE', category: 'content-expansion', priority: 'MEDIUM', severity: 'warn',
      title: `เพิ่มเนื้อหาให้หน้าที่บางเกินไป (${thin.length} หน้า)`,
      detail: 'หน้าที่เนื้อหาน้อยกว่า 300 คำมักไม่ถูก index หรือติดอันดับไม่ได้',
      evidence: group(thin.slice(0, 10), (p) => `${p.wordCount} คำ — ${p.url}`).join('\n'),
      url: thin[0].url, count: thin.length,
    })
  }

  const weakLead: string[] = []
  extracted.forEach((p, url) => {
    if (p.wordCount >= 300 && !p.answersInLead) weakLead.push(`${url} — ย่อหน้าแรก ${p.leadWordCount} คำ ไม่ได้ตอบคำถามหลักตรง ๆ`)
  })
  if (weakLead.length) {
    add({
      id: 'lead-weak', area: 'ONPAGE', category: 'intro-description', priority: 'MEDIUM', severity: 'warn',
      title: `เขียนย่อหน้าแรกให้ตอบคำถามหลักภายใน 2-3 บรรทัด (${weakLead.length} หน้า)`,
      detail: 'ย่อหน้าแรกที่ตอบตรงช่วยทั้งผู้อ่านและเครื่องมือตอบคำถาม (AEO)',
      evidence: weakLead.slice(0, 10).join('\n'),
      count: weakLead.length,
    })
  }

  const noToc: string[] = []
  rawHtml.forEach((html, url) => {
    const wc = extracted.get(url)?.wordCount ?? 0
    if (wc > 1000 && !/href=["']#[^"']+["']/i.test(html)) noToc.push(`${url} — ${wc} คำ ไม่พบลิงก์ anchor (#) ในหน้า`)
  })
  if (noToc.length) {
    add({
      id: 'toc-missing', area: 'ONPAGE', category: 'table-of-contents', priority: 'LOW', severity: 'warn',
      title: `เพิ่มสารบัญให้บทความยาว (${noToc.length} หน้า)`,
      detail: 'บทความเกิน 1,000 คำควรมีสารบัญที่ลิงก์ไป anchor ของแต่ละหัวข้อ',
      evidence: noToc.slice(0, 10).join('\n'),
      count: noToc.length,
    })
  }

  const missingAlt = pages.filter((p) => p.images > 0 && p.imagesWithAlt < p.images)
  if (missingAlt.length) {
    const total = missingAlt.reduce((s, p) => s + (p.images - p.imagesWithAlt), 0)
    add({
      id: 'image-alt', area: 'ONPAGE', category: 'image-seo', priority: 'MEDIUM', severity: 'fail',
      title: `ใส่ alt text ให้รูปที่ยังไม่มี (${total} รูป ใน ${missingAlt.length} หน้า)`,
      detail: 'alt text ช่วยให้ Google เข้าใจรูป และจำเป็นกับผู้ใช้ screen reader',
      evidence: group(missingAlt.slice(0, 10), (p) => `${p.images - p.imagesWithAlt}/${p.images} รูปไม่มี alt — ${p.url}`).join('\n'),
      url: missingAlt[0].url, count: missingAlt.length,
    })
  }

  const fewLinks = pages.filter((p) => p.internalLinks < 3)
  if (fewLinks.length) {
    add({
      id: 'internal-links-few', area: 'ONPAGE', category: 'internal-links', priority: 'MEDIUM', severity: 'warn',
      title: `เพิ่มลิงก์ภายในให้หน้าที่ลิงก์น้อย (${fewLinks.length} หน้า)`,
      detail: 'แต่ละหน้าควรมีลิงก์ไปหน้าที่เกี่ยวข้องอย่างน้อย 3-5 ลิงก์ เพื่อกระจาย authority',
      evidence: group(fewLinks.slice(0, 10), (p) => `${p.internalLinks} ลิงก์ — ${p.url}`).join('\n'),
      url: fewLinks[0].url, count: fewLinks.length,
    })
  }

  const orphans = sitemap.urls
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => Boolean(u) && sameHost(u!, origin))
    .filter((u) => !linkedTo.has(u) && u !== normalizeUrl(origin))
  if (orphans.length) {
    add({
      id: 'orphan-pages', area: 'ONPAGE', category: 'internal-links', priority: 'MEDIUM', severity: 'warn',
      title: `เพิ่มลิงก์ภายในชี้ไปหน้าที่ไม่มีใครลิงก์ถึง (${orphans.length} หน้า)`,
      detail: 'หน้าที่อยู่ใน sitemap แต่ไม่มีลิงก์ภายในชี้ถึงเลย (orphan page) ถูก crawl ยากและแทบไม่ได้ authority',
      evidence: `จากหน้าที่สแกน ${pages.length} หน้า ไม่พบลิงก์ชี้ไปยัง:\n${orphans.slice(0, 10).join('\n')}`,
      count: orphans.length,
    })
  }

  const noCitation: string[] = []
  extracted.forEach((p, url) => {
    if (p.wordCount >= 600 && p.citationLinks === 0) noCitation.push(url)
  })
  if (noCitation.length) {
    add({
      id: 'external-links-none', area: 'ONPAGE', category: 'external-links', priority: 'LOW', severity: 'warn',
      title: `อ้างอิงแหล่งข้อมูลภายนอกในบทความยาว (${noCitation.length} หน้า)`,
      detail: 'บทความยาวที่ไม่มีลิงก์อ้างอิงเลยดูขาดหลักฐาน กระทบสัญญาณ E-E-A-T',
      evidence: noCitation.slice(0, 10).join('\n'),
      count: noCitation.length,
    })
  }

  // ── 7. technical ระดับหน้า ─────────────────────────────────────────────────
  const noindexed = pages.filter((p) => p.noindex)
  if (noindexed.length) {
    add({
      id: 'noindex-pages', area: 'TECHNICAL', category: 'robots-tag', priority: 'CRITICAL', severity: 'fail',
      title: `ตรวจหน้าที่ตั้ง noindex ไว้ (${noindexed.length} หน้า)`,
      detail: 'ถ้าไม่ได้ตั้งใจ ให้เอา noindex ออก เพราะหน้านี้จะไม่ขึ้นผลการค้นหาเลย',
      evidence: group(noindexed.slice(0, 10), (p) => p.url).join('\n'),
      url: noindexed[0].url, count: noindexed.length,
    })
  }

  const noLang = pages.filter((p) => !p.lang)
  if (noLang.length) {
    add({
      id: 'lang-missing', area: 'TECHNICAL', category: 'language-tag', priority: 'MEDIUM', severity: 'warn',
      title: `ใส่ lang ที่แท็ก <html> (${noLang.length} หน้า)`,
      detail: 'เว็บภาษาไทยควรเป็น <html lang="th"> เพื่อบอกภาษาหลักของหน้า',
      evidence: group(noLang.slice(0, 10), (p) => p.url).join('\n'),
      url: noLang[0].url, count: noLang.length,
    })
  }

  const noViewport = pages.filter((p) => !p.hasViewport)
  if (noViewport.length) {
    add({
      id: 'viewport-missing', area: 'TECHNICAL', category: 'pagespeed', priority: 'HIGH', severity: 'fail',
      title: `เพิ่ม meta viewport (${noViewport.length} หน้า)`,
      detail: 'ไม่มี viewport หน้าเว็บจะไม่ responsive บนมือถือ กระทบ mobile usability โดยตรง',
      evidence: group(noViewport.slice(0, 10), (p) => p.url).join('\n'),
      url: noViewport[0].url, count: noViewport.length,
    })
  }

  const noCanonical = pages.filter((p) => !p.canonical)
  if (noCanonical.length) {
    add({
      id: 'canonical-missing', area: 'TECHNICAL', category: 'canonical', priority: 'HIGH', severity: 'fail',
      title: `ใส่ canonical แบบ self-referencing (${noCanonical.length} หน้า)`,
      detail: 'ทุกหน้าควรมี <link rel="canonical"> ชี้ URL ของตัวเอง กันเนื้อหาซ้ำจาก parameter และ www',
      evidence: group(noCanonical.slice(0, 10), (p) => p.url).join('\n'),
      url: noCanonical[0].url, count: noCanonical.length,
    })
  }

  const crossCanonical = pages.filter((p) => {
    if (!p.canonical) return false
    const c = normalizeUrl(p.canonical, p.url)
    return Boolean(c) && c !== p.url
  })
  if (crossCanonical.length) {
    add({
      id: 'canonical-cross', area: 'INDEXING', category: 'duplicate-without-canonical', priority: 'MEDIUM', severity: 'warn',
      title: `ตรวจหน้าที่ canonical ชี้ไป URL อื่น (${crossCanonical.length} หน้า)`,
      detail: 'ถ้าไม่ได้ตั้งใจรวมหน้า หน้านี้จะไม่ถูก index เพราะยกเครดิตให้ URL อื่น',
      evidence: group(crossCanonical.slice(0, 10), (p) => `${p.url}\n  canonical: ${p.canonical}`).join('\n'),
      url: crossCanonical[0].url, count: crossCanonical.length,
    })
  }

  const noSchema = pages.filter((p) => p.schemaTypes.length === 0)
  if (noSchema.length) {
    add({
      id: 'schema-missing', area: 'TECHNICAL', category: 'structured-data', priority: 'MEDIUM', severity: 'warn',
      title: `เพิ่ม Schema Markup (JSON-LD) ให้หน้าที่ยังไม่มี (${noSchema.length} หน้า)`,
      detail: 'บทความใช้ Article/FAQPage หน้าองค์กรใช้ Organization หน้าสินค้าใช้ Product เพื่อให้ได้ Rich Snippet',
      evidence: group(noSchema.slice(0, 10), (p) => p.url).join('\n'),
      url: noSchema[0].url, count: noSchema.length,
    })
  } else {
    passed.push({ area: 'TECHNICAL', category: 'structured-data', label: 'Schema Markup', evidence: `ทุกหน้าที่สแกนมี JSON-LD (พบชนิด: ${Array.from(new Set(pages.flatMap((p) => p.schemaTypes))).slice(0, 8).join(', ')})` })
  }

  const mixed: string[] = []
  rawHtml.forEach((html, url) => {
    const m = html.match(/(?:src|href)=["']http:\/\/[^"']+["']/i)
    if (m) mixed.push(`${url} — ${m[0].slice(0, 100)}`)
  })
  if (mixed.length) {
    add({
      id: 'mixed-content', area: 'TECHNICAL', category: 'https-security', priority: 'MEDIUM', severity: 'warn',
      title: `แก้ทรัพยากรที่ยังโหลดผ่าน http (${mixed.length} หน้า)`,
      detail: 'ไฟล์ที่โหลดผ่าน http บนหน้า https ทำให้เบราว์เซอร์เตือนไม่ปลอดภัยหรือบล็อกทิ้ง',
      evidence: mixed.slice(0, 10).join('\n'),
      count: mixed.length,
    })
  }

  const hreflangPages: string[] = []
  let hreflangHasDefault = false
  rawHtml.forEach((html, url) => {
    const tags = html.match(/<link[^>]+hreflang=["'][^"']+["'][^>]*>/gi) || []
    if (tags.length) {
      hreflangPages.push(url)
      if (tags.some((t) => /hreflang=["']x-default["']/i.test(t))) hreflangHasDefault = true
    }
  })
  if (hreflangPages.length && !hreflangHasDefault) {
    add({
      id: 'hreflang-no-default', area: 'TECHNICAL', category: 'hreflang', priority: 'LOW', severity: 'warn',
      title: 'เพิ่ม hreflang="x-default" ให้ชุด hreflang',
      detail: 'x-default บอก Google ว่าจะส่งผู้ใช้ที่ไม่ตรงภาษาใดไปหน้าไหน',
      evidence: `พบ hreflang ใน ${hreflangPages.length} หน้า แต่ไม่มี x-default เลย\n${hreflangPages.slice(0, 5).join('\n')}`,
      count: hreflangPages.length,
    })
  } else if (!hreflangPages.length) {
    passed.push({ area: 'TECHNICAL', category: 'hreflang', label: 'Hreflang', evidence: 'ไม่พบแท็ก hreflang — ปกติสำหรับเว็บภาษาเดียว' })
  }

  // ── 8. PageSpeed Insights ─────────────────────────────────────────────────
  const psi = await runPageSpeed(origin)
  if (!psi.ok) {
    needsTools.push({ label: 'PageSpeed Insights API', reason: `เรียกไม่สำเร็จ (${psi.error}) — ตั้งค่า PAGESPEED_API_KEY เพื่อเลี่ยงโควตาแบบไม่ระบุตัวตน` })
  } else {
    const bits = [
      psi.performance !== null ? `Performance ${psi.performance}/100` : '',
      psi.seo !== null ? `SEO ${psi.seo}/100` : '',
      psi.lcpMs !== null ? `LCP ${(psi.lcpMs / 1000).toFixed(1)}s` : '',
      psi.clsValue !== null ? `CLS ${psi.clsValue}` : '',
      psi.tbtMs !== null ? `TBT ${psi.tbtMs}ms` : '',
    ].filter(Boolean).join(' · ')
    const slow = (psi.performance !== null && psi.performance < 70) || (psi.lcpMs !== null && psi.lcpMs > 2500)
    if (slow) {
      add({
        id: 'pagespeed-slow', area: 'TECHNICAL', category: 'pagespeed', priority: psi.performance !== null && psi.performance < 50 ? 'HIGH' : 'MEDIUM', severity: 'fail',
        title: 'ปรับความเร็วหน้าแรกให้ผ่านเกณฑ์ Core Web Vitals',
        detail: 'เป้าหมาย LCP ไม่เกิน 2.5 วินาที CLS ไม่เกิน 0.1 และ TBT ไม่เกิน 200 มิลลิวินาที บนมือถือ',
        evidence: `PageSpeed Insights (mobile) ของ ${origin}: ${bits}`,
        url: origin,
      })
    } else {
      passed.push({ area: 'TECHNICAL', category: 'pagespeed', label: 'Page Speed', evidence: `PageSpeed Insights (mobile): ${bits}` })
    }
  }

  // ── 9. ลิงก์เสีย / 5xx ────────────────────────────────────────────────────
  const scannedSet = new Set(pages.map((p) => p.url))
  const toCheck = Array.from(allInternalHrefs).filter((u) => !scannedSet.has(u)).slice(0, MAX_LINK_CHECKS)
  const broken: Array<{ url: string; status: number }> = []
  for (const u of toCheck) {
    const st = await checkStatus(u)
    if (st === 404 || st === 410) broken.push({ url: u, status: st })
    else if (st >= 500) serverErrors.push({ url: u, status: st })
  }
  if (broken.length) {
    add({
      id: 'broken-internal', area: 'INDEXING', category: 'broken-url-check', priority: 'HIGH', severity: 'fail',
      title: `แก้ลิงก์ภายในที่เสีย (${broken.length} ลิงก์)`,
      detail: 'แก้ปลายทางให้ถูก หรือทำ 301 ไปหน้าที่เนื้อหาใกล้เคียงที่สุด',
      evidence: broken.slice(0, 15).map((b) => `HTTP ${b.status} — ${b.url}`).join('\n'),
      url: broken[0].url, count: broken.length,
    })
  } else if (toCheck.length) {
    passed.push({ area: 'INDEXING', category: 'broken-url-check', label: 'Broken URL', evidence: `ตรวจลิงก์ภายใน ${toCheck.length} ลิงก์ ไม่พบ 404` })
  }

  if (serverErrors.length) {
    add({
      id: 'server-5xx', area: 'INDEXING', category: 'server-error-5xx', priority: 'CRITICAL', severity: 'fail',
      title: `แก้ URL ที่เซิร์ฟเวอร์คืน 5xx (${serverErrors.length} URL)`,
      detail: 'หน้า 5xx ทำให้ Googlebot ถอยและลดอัตรา crawl ทั้งเว็บ',
      evidence: serverErrors.slice(0, 15).map((e) => `HTTP ${e.status} — ${e.url}`).join('\n'),
      url: serverErrors[0].url, count: serverErrors.length,
    })
  }

  // ── 10. สิ่งที่ต้องต่อเครื่องมือเพิ่ม ─────────────────────────────────────
  needsTools.push(
    { label: 'Google Search Console', reason: 'สถานะ Crawled/Discovered - currently not indexed อ่านได้จาก Search Console เท่านั้น ตรวจจากภายนอกไม่ได้' },
    { label: 'Server log', reason: 'ความถี่ที่ Googlebot เข้าเว็บและ URL ที่ถูก crawl จริงต้องดูจาก log ของเซิร์ฟเวอร์' },
  )

  return {
    website: origin,
    scannedAt: new Date().toISOString(),
    pages,
    findings: findings.sort((a, b) => {
      const rank: Record<SeoTaskPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
      return rank[a.priority] - rank[b.priority]
    }),
    passed,
    needsTools,
    warnings,
    stats: {
      pagesScanned: pages.length,
      linksChecked: toCheck.length,
      brokenLinks: broken.length,
      durationMs: Date.now() - started,
    },
  }
}
