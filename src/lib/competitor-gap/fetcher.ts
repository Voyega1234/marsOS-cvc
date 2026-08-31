/**
 * Competitor Gap — self-hosted HTTP fetcher
 *
 * กติกา: HTTP ก่อนเสมอ. browser rendering เป็น fallback เฉพาะหน้าที่ตรวจพบว่า
 * เนื้อหาถูก render ด้วย JS เท่านั้น (ดู needsJsRender ใน pageExtract.ts)
 * — ไม่ใช่ค่า default และไม่เคยยิงทุกหน้า
 */

import { assertCrawlable } from './urls'

const TIMEOUT_MS = 12_000
const MAX_BYTES = 1_500_000
const UA = 'Mozilla/5.0 (compatible; MarsOS-CompetitorGap/1.0; +https://convertcake.com/bot)'

export interface FetchResult {
  ok: boolean
  status: number
  html: string
  finalUrl: string
  redirected: boolean
  blocked: boolean
  error: string | null
  rendered: boolean
  bytes: number
}

const EMPTY: FetchResult = {
  ok: false, status: 0, html: '', finalUrl: '', redirected: false,
  blocked: false, error: null, rendered: false, bytes: 0,
}

export async function fetchHtml(url: string): Promise<FetchResult> {
  const guard = await assertCrawlable(url)
  if (!guard.ok) return { ...EMPTY, blocked: true, error: `blocked: ${guard.reason}` }

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'th,en;q=0.8',
      },
    })

    const status = res.status
    const finalUrl = res.url || url
    const redirected = finalUrl.replace(/\/$/, '') !== url.replace(/\/$/, '')

    if (status === 403 || status === 401 || status === 429) {
      return { ...EMPTY, status, finalUrl, redirected, blocked: true, error: `HTTP ${status}` }
    }
    if (!res.ok) return { ...EMPTY, status, finalUrl, redirected, error: `HTTP ${status}` }

    const ctype = res.headers.get('content-type') ?? ''
    if (ctype && !/text\/html|application\/xhtml|text\/plain|xml/i.test(ctype)) {
      return { ...EMPTY, status, finalUrl, redirected, error: `content-type ${ctype.split(';')[0]}` }
    }

    const buf = await res.arrayBuffer()
    const sliced = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
    const html = new TextDecoder('utf-8', { fatal: false }).decode(sliced)

    return { ok: true, status, html, finalUrl, redirected, blocked: false, error: null, rendered: false, bytes: buf.byteLength }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...EMPTY, error: /timeout|abort/i.test(msg) ? 'timeout' : msg.slice(0, 120) }
  }
}

/** ดึงไฟล์ text ธรรมดา (robots.txt / sitemap.xml) — ผ่าน SSRF guard เหมือนกัน */
export async function fetchText(url: string): Promise<string | null> {
  const guard = await assertCrawlable(url)
  if (!guard.ok) return null
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA },
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const sliced = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
    return new TextDecoder('utf-8', { fatal: false }).decode(sliced)
  } catch {
    return null
  }
}

// ── JS fallback ──────────────────────────────────────────────────────────────

let browserUnavailableReason: string | null = null

/**
 * Render ด้วย browser — ใช้ playwright ที่มีอยู่แล้วใน devDependencies
 * ถ้า runtime ไม่มี browser (เช่น serverless) จะคืน null พร้อมจดเหตุผล
 * ไม่ล้มทั้ง scan
 */
export async function renderWithBrowser(url: string): Promise<FetchResult | null> {
  if (browserUnavailableReason) return null
  const guard = await assertCrawlable(url)
  if (!guard.ok) return null

  try {
    const mod: any = await import(/* webpackIgnore: true */ 'playwright')
    const browser = await mod.chromium.launch({ args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage({ userAgent: UA })
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
      await page.waitForTimeout(1200)
      const html = await page.content()
      return {
        ok: true,
        status: res?.status() ?? 200,
        html: html.slice(0, MAX_BYTES),
        finalUrl: page.url(),
        redirected: page.url() !== url,
        blocked: false,
        error: null,
        rendered: true,
        bytes: html.length,
      }
    } finally {
      await browser.close().catch(() => {})
    }
  } catch (e) {
    browserUnavailableReason = e instanceof Error ? e.message.slice(0, 160) : 'browser unavailable'
    return null
  }
}

export function getBrowserUnavailableReason(): string | null {
  return browserUnavailableReason
}
