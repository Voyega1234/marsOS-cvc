/**
 * ตัวยิง HTTP ที่ปลอดภัยของเมนู Upload Article
 * - กัน SSRF ทุก hop: redirect แบบ manual แล้วเช็ค assertCrawlable ทุกปลายทาง
 *   (ตัว fetcher ของ competitor-gap เช็คแค่ URL แรกแล้ว follow redirect เอง)
 * - เว็บที่ต้องส่งรหัสผ่าน (WordPress) ต้องเป็น https และเป็นโฮสต์สาธารณะเท่านั้น
 */
import { assertCrawlable } from '@/lib/competitor-gap/urls'

const MAX_HOPS = 5
const TIMEOUT_MS = 12_000
const MAX_BYTES = 1_500_000

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
}

/** ตรวจ URL เว็บ WordPress ก่อนส่งรหัสผ่านไป — คืนข้อความ error ภาษาไทย หรือ null ถ้าผ่าน */
export async function checkCredentialUrl(url: string): Promise<string | null> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'URL เว็บไม่ถูกต้อง'
  }
  if (u.protocol !== 'https:') return 'URL เว็บต้องขึ้นต้นด้วย https:// (กันรหัสผ่านรั่วระหว่างทาง)'
  if (u.username || u.password) return 'URL เว็บห้ามมีชื่อผู้ใช้/รหัสผ่านฝังมา'
  const guard = await assertCrawlable(url)
  if (!guard.ok) return `ยิงไปเว็บนี้ไม่ได้ (${guard.reason})`
  return null
}

/**
 * fetch ที่ตามรีไดเรกต์เองทีละ hop และเช็ค SSRF ทุก hop
 * requireHttps = true ใช้กับคำขอที่มี credential — ห้ามถูกพาไป http หรือโดเมนอื่น
 * (รีไดเรกต์ไปโดเมนอื่นพร้อม Authorization = ส่งรหัสผ่านให้คนอื่น)
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: { requireHttps?: boolean; sameHostOnly?: boolean } = {},
): Promise<Response> {
  let current = url
  const firstHost = new URL(url).host
  let method = (init.method || 'GET').toUpperCase()
  let body = init.body
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(current)
    if (opts.requireHttps && u.protocol !== 'https:') throw new Error('ถูกพาไปที่ URL ที่ไม่ใช่ https')
    if (opts.sameHostOnly && u.host !== firstHost) throw new Error(`เว็บรีไดเรกต์ไปโดเมนอื่น (${u.host})`)
    const guard = await assertCrawlable(current)
    if (!guard.ok) throw new Error(`ยิงไปปลายทางนี้ไม่ได้ (${guard.reason})`)
    const res = await fetch(current, { ...init, method, body, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      current = new URL(loc, current).toString()
      // 303 และ 301/302 ของ POST → GET ตามพฤติกรรมเบราว์เซอร์
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
      }
      continue
    }
    return res
  }
  throw new Error('รีไดเรกต์หลายทอดเกินไป')
}

export interface SafeFetchResult {
  ok: boolean
  status: number
  html: string
  finalUrl: string
  blocked: boolean
  error: string | null
}

const EMPTY: SafeFetchResult = { ok: false, status: 0, html: '', finalUrl: '', blocked: false, error: null }

/** ดึงหน้า HTML (ไม่มี credential) ผ่าน SSRF guard ทุก hop — หน้าตาผลเหมือน fetchHtml ของ competitor-gap */
export async function safeFetchHtml(url: string): Promise<SafeFetchResult> {
  try {
    let current = url
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const guard = await assertCrawlable(current)
      if (!guard.ok) return { ...EMPTY, finalUrl: current, blocked: true, error: `blocked: ${guard.reason}` }
      const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: BROWSER_HEADERS })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location') as string, current).toString()
        continue
      }
      const status = res.status
      if (status === 401 || status === 403 || status === 429) return { ...EMPTY, status, finalUrl: current, blocked: true, error: `HTTP ${status}` }
      if (!res.ok) return { ...EMPTY, status, finalUrl: current, error: `HTTP ${status}` }
      const ctype = res.headers.get('content-type') ?? ''
      if (ctype && !/text\/|application\/(?:xhtml|json|xml)|\+json|\+xml/i.test(ctype)) {
        return { ...EMPTY, status, finalUrl: current, error: `content-type ${ctype.split(';')[0]}` }
      }
      const buf = await res.arrayBuffer()
      const sliced = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
      return { ok: true, status, html: new TextDecoder('utf-8', { fatal: false }).decode(sliced), finalUrl: current, blocked: false, error: null }
    }
    return { ...EMPTY, finalUrl: current, error: 'too many redirects' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...EMPTY, finalUrl: url, error: /timeout|abort/i.test(msg) ? 'timeout' : msg.slice(0, 120) }
  }
}

/** ดึงไฟล์ text (CSS / JSON) ผ่าน SSRF guard ทุก hop — คืน null ถ้าไม่สำเร็จ */
export async function safeFetchText(url: string): Promise<string | null> {
  const r = await safeFetchHtml(url)
  return r.ok ? r.html : null
}
