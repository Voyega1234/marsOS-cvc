/**
 * ส่งบทความไป Google Docs — ใช้ได้เฉพาะฝั่งเบราว์เซอร์
 *
 * ทำงาน 2 ชั้น:
 * - ตั้ง NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID แล้ว: ขอสิทธิ์ drive.file ผ่าน Google Identity Services (popup ครั้งแรก)
 *   อัปโหลด .docx ตัวเดียวกับปุ่ม Word ให้ Drive แปลงเป็น Google Doc ใน Drive ของคนกด แล้วเปิดแท็บใหม่
 *   ต้องเปิด Google Drive API + ใส่โดเมนระบบใน Authorized JavaScript origins ของ OAuth Client นั้น
 * - ยังไม่ตั้ง: คัดลอกบทความแบบมีรูปแบบลง clipboard แล้วเปิด docs.new ให้กดวาง
 *
 * token อยู่ในหน่วยความจำของแท็บเท่านั้น ไม่ส่งเข้าเซิร์ฟเวอร์ MarsOS ไม่ลง storage
 * ไฟล์นี้ไม่มี import หนัก — import แบบ static ได้ เพื่อให้ popup / clipboard เรียกได้ในจังหวะคลิก
 */
import { boxKeyTakeaways } from '@/lib/article-structure'

const CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID || '').trim()
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id'
export const NEW_DOC_URL = 'https://docs.new'

export interface GoogleDocsSource {
  html: string
  title: string
  coverSrc?: string
  coverAlt?: string
}

export interface GoogleDocsResult {
  mode: 'drive' | 'clipboard'
  url: string
  opened: boolean
}

export function isDriveExportConfigured(): boolean {
  return CLIENT_ID.length > 0
}

// ───────────────────────── Google Identity Services ─────────────────────────

interface TokenResponse { access_token?: string; expires_in?: number | string; scope?: string; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(o?: { prompt?: string }): void }
interface GisOAuth2 {
  initTokenClient(c: {
    client_id: string
    scope: string
    callback: (r: TokenResponse) => void
    error_callback?: (e: { type?: string }) => void
  }): TokenClient
  hasGrantedAllScopes?(r: TokenResponse, scope: string, ...rest: string[]): boolean
}
declare global {
  interface Window { google?: { accounts?: { oauth2?: GisOAuth2 } } }
}

let gisPromise: Promise<GisOAuth2> | null = null
let tokenClient: TokenClient | null = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null
let cached: { token: string; exp: number } | null = null
// คนกดเอาติ๊ก Drive ออกในหน้าขอสิทธิ์ — รอบหน้าต้องบังคับให้หน้าขอสิทธิ์ขึ้นอีกครั้ง
let needConsent = false

const GIS_LOAD_TIMEOUT_MS = 20_000
// เผื่อเวลาให้คนอ่าน/กดหน้าขอสิทธิ์ — เกินนี้ถือว่าหน้าต่างค้าง ปุ่มจะได้ไม่ค้างตลอด
const TOKEN_TIMEOUT_MS = 180_000

function loadGis(): Promise<GisOAuth2> {
  const ready = window.google?.accounts?.oauth2
  if (ready) return Promise.resolve(ready)
  if (!gisPromise) {
    gisPromise = new Promise<GisOAuth2>((resolve, reject) => {
      const s = document.createElement('script')
      const fail = () => {
        clearTimeout(timer)
        s.remove()
        reject(new Error('โหลด Google Sign-In ไม่สำเร็จ — เช็คเน็ตหรือตัวบล็อกโฆษณา'))
      }
      const timer = setTimeout(fail, GIS_LOAD_TIMEOUT_MS)
      s.src = GIS_SRC
      s.async = true
      s.onload = () => {
        clearTimeout(timer)
        const o = window.google?.accounts?.oauth2
        if (o) resolve(o)
        else reject(new Error('โหลด Google Sign-In ไม่สำเร็จ'))
      }
      s.onerror = fail
      document.head.appendChild(s)
    })
    gisPromise.catch(() => { gisPromise = null }) // ให้กดใหม่แล้วโหลดใหม่ได้
  }
  return gisPromise
}

/** โหลดสคริปต์ Google ไว้ก่อน (ตอนเอาเมาส์ชี้ปุ่ม) — คลิกจริงจะได้เปิด popup ขอสิทธิ์ได้ทันที ไม่โดนบล็อก */
export function preloadGoogleDocsExport(): void {
  if (CLIENT_ID && typeof window !== 'undefined') loadGis().catch(() => {})
}

export function hasDriveToken(): boolean {
  return !!cached && cached.exp - 60_000 > Date.now()
}

export function tokenErrorMessage(type: string | undefined): string {
  if (type === 'popup_failed_to_open') return 'เบราว์เซอร์บล็อกหน้าต่างขอสิทธิ์ Google — อนุญาต popup แล้วกดอีกครั้ง'
  if (type === 'popup_closed') return 'ปิดหน้าต่าง Google ก่อนให้สิทธิ์ — กดอีกครั้ง'
  if (type === 'access_denied') return 'ไม่ได้อนุญาตให้สร้างไฟล์ใน Google Drive'
  if (type === 'scope_not_granted') return 'ไม่ได้ติ๊กอนุญาตให้สร้างไฟล์ใน Google Drive — กดอีกครั้งแล้วติ๊กช่อง Drive'
  if (type === 'timeout') return 'รอหน้าต่างขอสิทธิ์ Google นานเกินไป — ปิดหน้าต่างนั้นแล้วกดอีกครั้ง'
  return 'ขอสิทธิ์ Google ไม่สำเร็จ' + (type ? ` (${type})` : '')
}

function requestToken(oauth2: GisOAuth2): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pending?.reject(new Error('มีการกดซ้ำ — ใช้คำขอล่าสุดแทน'))
    const me = { resolve, reject }
    pending = me
    setTimeout(() => {
      if (pending !== me) return
      pending = null
      reject(new Error(tokenErrorMessage('timeout')))
    }, TOKEN_TIMEOUT_MS)
    if (!tokenClient) {
      tokenClient = oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: r => {
          const p = pending
          pending = null
          if (!p) return
          if (r.error || !r.access_token) return p.reject(new Error(tokenErrorMessage(r.error)))
          if (oauth2.hasGrantedAllScopes && !oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
            needConsent = true
            return p.reject(new Error(tokenErrorMessage('scope_not_granted')))
          }
          needConsent = false
          const sec = Number(r.expires_in) || 3600
          cached = { token: r.access_token, exp: Date.now() + sec * 1000 }
          p.resolve(r.access_token)
        },
        error_callback: e => {
          const p = pending
          pending = null
          p?.reject(new Error(tokenErrorMessage(e?.type)))
        },
      })
    }
    tokenClient.requestAccessToken({ prompt: needConsent ? 'consent' : '' })
  })
}

/** ถ้าสคริปต์โหลดไว้แล้ว popup จะถูกเรียกแบบ synchronous ภายในคลิก (ก่อน await แรก) */
function getDriveToken(): Promise<string> {
  if (hasDriveToken()) return Promise.resolve(cached!.token)
  const ready = window.google?.accounts?.oauth2
  return ready ? requestToken(ready) : loadGis().then(requestToken)
}

// ───────────────────────── Drive upload ─────────────────────────

interface DriveErrorBody {
  error?: {
    message?: string
    errors?: { reason?: string }[]
    details?: { reason?: string }[]
  }
}

function driveErrorReasons(body: unknown): string[] {
  const err = (body as DriveErrorBody | null)?.error
  return [...(err?.errors ?? []), ...(err?.details ?? [])].map(x => x?.reason ?? '')
}

function isScopeError(body: unknown): boolean {
  const reasons = driveErrorReasons(body)
  return reasons.includes('insufficientPermissions') || reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')
}

export function driveErrorMessage(status: number, body: unknown): string {
  const err = (body as DriveErrorBody | null)?.error
  const has = (r: string) => driveErrorReasons(body).includes(r)
  if (status === 401) return 'สิทธิ์ Google หมดอายุ — กดอีกครั้ง'
  if (has('accessNotConfigured') || has('SERVICE_DISABLED')) {
    return 'ยังไม่ได้เปิด Google Drive API ในโปรเจกต์ Google Cloud — แจ้งแอดมิน'
  }
  if (has('storageQuotaExceeded')) return 'Google Drive เต็ม — ลบไฟล์หรือเพิ่มพื้นที่ก่อน'
  if (isScopeError(body)) {
    return 'ไม่ได้ให้สิทธิ์สร้างไฟล์ใน Drive — กดอีกครั้งแล้วติ๊กอนุญาต'
  }
  if (status === 413) return 'ไฟล์ใหญ่เกินที่ Google Docs รับ — ลดจำนวน/ขนาดรูปก่อน'
  if (status === 429 || has('rateLimitExceeded') || has('userRateLimitExceeded')) {
    return 'Google Drive ปฏิเสธเพราะกดถี่เกินไป — รอสักครู่แล้วลองใหม่'
  }
  return `Google Drive ตอบกลับ ${status}` + (err?.message ? `: ${err.message}` : '')
}

async function uploadDocxAsGoogleDoc(docx: Blob, title: string, token: string): Promise<string> {
  const form = new FormData()
  form.append('metadata', new Blob(
    [JSON.stringify({ name: title.trim() || 'บทความ', mimeType: 'application/vnd.google-apps.document' })],
    { type: 'application/json' },
  ))
  form.append('file', new Blob([docx], { type: DOCX_MIME }))
  const res = await fetch(UPLOAD_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const data = await res.json().catch(() => null) as { id?: string } | null
  if (!res.ok || !data?.id) {
    // ทิ้ง token เฉพาะตอนหมดอายุ/สิทธิ์ไม่พอ — Drive เต็ม / API ปิด / กดถี่ ไม่ต้องขอสิทธิ์ใหม่
    if (res.status === 401 || isScopeError(data)) {
      cached = null
      if (res.status !== 401) needConsent = true
    }
    throw new Error(driveErrorMessage(res.status, data))
  }
  return `https://docs.google.com/document/d/${encodeURIComponent(data.id)}/edit`
}

// ───────────────────────── Clipboard ─────────────────────────

const STRIP_SEL = [
  'script', 'style', 'noscript', 'template', 'link', 'meta', 'base',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'form',
  'nav.content-toc', 'nav.content-breadcrumb', '[hidden]',
].join(',')
const TEXT_BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,div,blockquote,figure,figcaption,table,tr,ul,ol,section,article,header,footer'

/** ตัวหนังสือสำรอง — ขึ้นบรรทัดใหม่ระหว่างย่อหน้า/หัวข้อ ไม่งั้น textContent จะติดกันเป็นก้อน */
function plainText(body: HTMLElement): string {
  const c = body.cloneNode(true) as HTMLElement
  c.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
  c.querySelectorAll('td,th').forEach(td => td.append('\t'))
  c.querySelectorAll(TEXT_BLOCK_SEL).forEach(el => el.append('\n\n'))
  return (c.textContent || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** บทความเป็น HTML ล้วน (ไม่มี style/script) สำหรับวางใน Google Docs + ตัวหนังสือสำรอง */
export function buildDocsClipboard(o: GoogleDocsSource): { html: string; text: string } {
  const doc = new DOMParser().parseFromString(boxKeyTakeaways(o.html || ''), 'text/html')
  const body = doc.body
  body.querySelectorAll(STRIP_SEL).forEach(n => n.remove())
  // Google Docs กรองเองตอนวางอยู่แล้ว แต่ clipboard อาจไปวางที่อื่น — ตัดตัวสั่งงานทิ้งก่อน
  body.querySelectorAll('*').forEach(el => {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase()
      const isUrlAttr = name === 'href' || name === 'src' || name === 'action' || name === 'formaction' || name === 'xlink:href'
      if (name.startsWith('on') || (isUrlAttr && /^\s*(javascript|vbscript):/i.test(a.value))) el.removeAttribute(a.name)
    }
  })
  // Google Docs ไม่มี details/summary — คลี่ FAQ เป็นย่อหน้าธรรมดา คำถามตัวหนา
  body.querySelectorAll('summary').forEach(s => {
    const p = doc.createElement('p')
    const b = doc.createElement('strong')
    b.append(...Array.from(s.childNodes))
    p.append(b)
    s.replaceWith(p)
  })
  body.querySelectorAll('details').forEach(d => {
    const div = doc.createElement('div')
    div.append(...Array.from(d.childNodes))
    d.replaceWith(div)
  })
  // Google Docs ดึงรูปจาก URL เอง — URL แบบ relative ต้องเติมโดเมนระบบ
  body.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src')
    if (!src || src.startsWith('data:')) return
    try { img.setAttribute('src', new URL(src, window.location.href).href) } catch { /* ปล่อยตามเดิม */ }
  })
  if (o.coverSrc && !(o.html || '').includes('content-cover')) {
    const img = doc.createElement('img')
    img.setAttribute('src', o.coverSrc)
    img.setAttribute('alt', o.coverAlt ?? o.title)
    body.prepend(img)
  }
  if (!body.querySelector('h1') && o.title) {
    const h = doc.createElement('h1')
    h.textContent = o.title
    body.prepend(h)
  }
  return { html: `<meta charset="utf-8">${body.innerHTML}`, text: plainText(body) }
}

async function copyForGoogleDocs(o: GoogleDocsSource): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('เบราว์เซอร์นี้คัดลอกแบบมีรูปแบบไม่ได้ — ใช้ปุ่ม Word แล้วอัปโหลดเข้า Google Drive แทน')
  }
  const c = buildDocsClipboard(o)
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([c.html], { type: 'text/html' }),
    'text/plain': new Blob([c.text], { type: 'text/plain' }),
  })])
}

// ───────────────────────── ปุ่ม Google Docs ─────────────────────────

/** เปิดแท็บ — คืน false เมื่อโดนบล็อก popup (ให้ UI แสดงปุ่มเปิดเองแทน) */
function openTab(url: string): boolean {
  const w = window.open(url, '_blank')
  if (!w) return false
  w.opener = null
  return true
}

function openPendingTab(): Window | null {
  const tab = window.open('', '_blank')
  if (tab) {
    try {
      tab.document.title = 'Google Docs'
      tab.document.body.style.cssText = 'font-family:system-ui,sans-serif;color:#475569;padding:48px;text-align:center'
      tab.document.body.textContent = 'กำลังสร้าง Google Doc…'
    } catch { /* แท็บว่างของบางเบราว์เซอร์เขียนไม่ได้ — ไม่เป็นไร */ }
  }
  return tab
}

/**
 * เรียกตรงจาก onClick — ห้าม await อะไรก่อนเรียกฟังก์ชันนี้ ไม่งั้นเบราว์เซอร์บล็อก popup ขอสิทธิ์ / แท็บใหม่
 * buildDocx = ตัวสร้าง .docx เดียวกับปุ่ม Word (import แบบ dynamic จาก article-export)
 */
export async function sendToGoogleDocs(o: GoogleDocsSource, buildDocx: () => Promise<Blob>): Promise<GoogleDocsResult> {
  if (!isDriveExportConfigured()) {
    await copyForGoogleDocs(o)
    return { mode: 'clipboard', url: NEW_DOC_URL, opened: openTab(NEW_DOC_URL) }
  }
  // มี token แล้ว = ไม่มี popup ขอสิทธิ์ — เปิดแท็บรอไว้ตอนคลิกเลย
  const tab = hasDriveToken() ? openPendingTab() : null
  try {
    const [token, docx] = await Promise.all([getDriveToken(), buildDocx()])
    const url = await uploadDocxAsGoogleDoc(docx, o.title, token)
    if (tab && !tab.closed) {
      tab.opener = null
      tab.location.href = url
      return { mode: 'drive', url, opened: true }
    }
    return { mode: 'drive', url, opened: openTab(url) }
  } catch (e) {
    tab?.close()
    throw e
  }
}

/** ข้อความแจ้งผลหลังกดปุ่ม — action = ปุ่มเปิดเองเมื่อแท็บโดนบล็อก */
export function googleDocsResultNotice(r: GoogleDocsResult): { message: string; action?: { label: string; url: string } } {
  if (r.mode === 'clipboard') {
    return r.opened
      ? { message: 'คัดลอกบทความแล้ว — กด ⌘V / Ctrl+V ในแท็บ Google Docs ที่เปิดขึ้น' }
      : { message: 'คัดลอกบทความแล้ว — เปิด Google Docs แล้วกด ⌘V / Ctrl+V', action: { label: 'เปิด Google Docs', url: r.url } }
  }
  return r.opened
    ? { message: 'สร้าง Google Doc ใน Drive ของคุณแล้ว' }
    : { message: 'สร้าง Google Doc ใน Drive ของคุณแล้ว', action: { label: 'เปิด Google Doc', url: r.url } }
}
