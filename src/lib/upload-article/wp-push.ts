// ─── Upload Article — push บทความขึ้น WordPress ─────────────────────────────
// คัดลอก/ปรับจากตรรกะใน src/app/api/push/publish/route.ts (ห้ามแก้ไฟล์เดิม)
// เป็น pure function ล้วน — ไม่แตะ prisma/session, รับ credentials ตรงจากผู้เรียก

import { safeFetch, safeFetchHtml } from './safe-fetch'
import { flattenEmbeddedNewlines } from '@/lib/articleComponents'

export interface WpPushInput {
  wpUrl: string
  wpUser: string
  wpPass: string
  title: string
  html: string
  slug?: string
  metaTitle?: string
  metaDescription?: string
  focusKeyword?: string
  coverBase64?: string // base64 ล้วน (ไม่มี data: prefix)
  coverMimeType?: string
  coverAlt?: string
  publishMode: 'draft' | 'publish'
  /** วัน-เวลาเผยแพร่ (ISO UTC) — ส่งเป็น date_gmt และขึ้นเป็น Draft เสมอ (ทีมกด Publish เองใน WordPress) */
  publishAt?: string
  useElementor?: boolean
  wpPostType?: 'post' | 'page'
  /** post/page ที่เคย push ไว้แล้ว — re-push ต้องอัพเดตตัวนี้ ไม่ใช่สร้างใหม่ */
  existingPostId?: number
}

export interface WpPushResult {
  ok: boolean
  postUrl?: string
  postId?: number
  slug?: string
  status?: string
  error?: string
  /** push สำเร็จ แต่ตรวจซ้ำแล้วหน้าเว็บอาจยังไม่แสดงเวอร์ชันนี้ */
  warning?: string
}

export function normalizeWpUrl(raw: string): string {
  return raw.trim().replace(/\/(wp-admin|wp-login\.php)(\/.*)?$/, '').replace(/\/$/, '')
}

/** id แบบที่ Elementor ใช้ (hex 7 ตัว) */
const elementorId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0')

/**
 * เอกสาร Elementor = 1 section → 1 column → HTML widget ที่ถือ HTML ชุดเดียวกับ post_content ทั้งก้อน
 * ไม่แยกเป็น Text Editor ราย H2 — TinyMCE ตัด <summary> (FAQ) + ใส่ <br> ใน <style>
 * และ CSS บทความผูกกับ .content-article ตัวเดียว แยก widget แล้วหน้าตาเพี้ยน
 * section เต็มความกว้าง + คอลัมน์ไม่มีช่องไฟ (gap no) → หน้าเว็บออกมาเหมือนตอนไม่ใช้ Elementor
 */
export function buildElementorData(html: string, widgetId: string = elementorId()): string {
  const data = [{
    id: elementorId(), elType: 'section',
    settings: { layout: 'full_width', gap: 'no', content_width: { unit: '%', size: 100 } },
    elements: [{
      id: elementorId(), elType: 'column',
      settings: { _column_size: 100, _inline_size: null },
      elements: [{
        id: widgetId, elType: 'widget', widgetType: 'html',
        settings: { html },
        elements: [],
      }],
    }],
  }]
  return JSON.stringify(data)
}

type WpFetcher = (url: string, init: RequestInit) => Promise<Response>
/** ดึง HTML หน้าเว็บจริงแบบไม่ล็อกอิน — null = ดึงไม่ได้ (บล็อก/timeout/ไม่ใช่ 200) */
type PageFetcher = (url: string) => Promise<string | null>

export const ELEMENTOR_STUCK_WARNING =
  'โพสต์นี้ถูกเปิดแก้ด้วย Elementor — หน้าเว็บอาจยังแสดงเวอร์ชันเก่าจาก Elementor และระบบสลับกลับให้ไม่ได้ ' +
  'ให้กด "กลับไปใช้ตัวแก้ไข WordPress" ในหน้าแก้โพสต์ แล้ว push ใหม่'
export const ELEMENTOR_WRITE_WARNING =
  'เขียนข้อมูล Elementor ไม่สำเร็จ — หน้าเว็บแสดงเวอร์ชันใหม่แล้ว แต่กด "Edit with Elementor" จะเจอเวอร์ชันเก่า'
export const ELEMENTOR_NOT_APPLIED_WARNING =
  'ติ๊ก Elementor ไว้ แต่เว็บไม่ยอมให้เขียนเอกสาร Elementor — หน้าเว็บแสดงเวอร์ชันใหม่แบบปกติ (ไม่ผ่าน Elementor)'
export const ELEMENTOR_STALE_WARNING =
  'ติ๊ก Elementor ไว้ แต่ยืนยันไม่ได้ว่าหน้าเว็บแสดงเอกสาร Elementor ชุดใหม่ (ล้าง cache ของ Elementor ไม่ได้) — ' +
  'ระบบสลับกลับให้หน้าเว็บแสดงเวอร์ชันใหม่แบบปกติแทน ถ้าต้องการเอกสาร Elementor ให้กด Elementor → Tools → Regenerate CSS & Data แล้ว push ใหม่'
export const ELEMENTOR_PLUGIN_STALE_WARNING =
  'เขียนเอกสาร Elementor ผ่านปลั๊กอิน convert-cake แล้ว แต่ยืนยันไม่ได้ว่าหน้าเว็บแสดงชุดใหม่ (ล้าง cache ของ Elementor ไม่ได้) — ' +
  'ให้กด Elementor → Tools → Regenerate CSS & Data แล้วเปิดหน้าเว็บดู'
export const ELEMENTOR_UNSUPPORTED_WARNING =
  'ติ๊ก Elementor ไว้ แต่เว็บนี้ไม่เปิดให้เขียน Elementor ผ่าน REST และไม่มีปลั๊กอิน convert-cake — หน้าเว็บแสดงเวอร์ชันใหม่แบบปกติ (ไม่ผ่าน Elementor)'

export interface ElementorSyncOptions {
  wpUrl: string
  creds: string
  postId: number
  isPage: boolean
  useElementor: boolean
  html: string
  fetcher: WpFetcher
  /** โพสต์เดิม (re-push) — Elementor อาจมี cache ของหน้านี้ค้างอยู่ */
  isUpdate?: boolean
  /** ลิงก์หน้าเว็บ เมื่อโพสต์ publish แล้ว — ใช้ตรวจว่าหน้าเว็บแสดงเวอร์ชันนี้จริง */
  liveUrl?: string
  pageFetcher?: PageFetcher
}

/** คำขอ REST ของ Elementor สำหรับโพสต์เดียว — ใช้ทั้งทาง REST และหลังเรียกปลั๊กอิน convert-cake */
function elementorRest(opts: ElementorSyncOptions) {
  const { creds, postId, isPage, fetcher } = opts
  const postEndpoint = `${opts.wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${postId}`
  const auth = { Authorization: `Basic ${creds}` }

  const readMeta = async (): Promise<Record<string, unknown> | null> => {
    const res = await fetcher(`${postEndpoint}?context=edit&_fields=meta`, {
      headers: auth,
      signal: AbortSignal.timeout(15000),
    }).catch(() => null)
    if (!res?.ok) return null
    const data = await res.json().catch(() => null)
    return data?.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : null
  }
  const update = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetcher(postEndpoint, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null)
    return !!res?.ok
  }
  // ล้าง cache ของ Elementor ทั้งเว็บ (เท่ากับปุ่ม Regenerate CSS & Data) — ต้องเป็นสิทธิ์ admin
  const clearCache = async (): Promise<boolean> => {
    const res = await fetcher(`${opts.wpUrl}/wp-json/elementor/v1/cache`, {
      method: 'DELETE',
      headers: auth,
      signal: AbortSignal.timeout(30000),
    }).catch(() => null)
    return !!res?.ok
  }
  // Elementor ใส่ data-id และ class elementor-element-<id> ให้ทุก element — id ของ widget ชุดนี้ใหม่ทุก push
  // ดูเฉพาะใน attribute class (ไม่นับ selector ใน <style> ที่ Elementor สร้างแยกจาก cache ของ HTML)
  // query string กัน page cache (WP Rocket ไม่ cache URL ที่มี query, Cloudflare แยก key ตาม query)
  const liveShowsWidget = async (widgetId: string): Promise<boolean | null> => {
    if (!opts.liveUrl || !opts.pageFetcher) return null
    const url = `${opts.liveUrl}${opts.liveUrl.includes('?') ? '&' : '?'}mars_v=${widgetId}`
    const page = await opts.pageFetcher(url).catch(() => null)
    if (page == null) return null
    return page.includes(`data-id="${widgetId}"`) || new RegExp(`class="[^"]*\\belementor-element-${widgetId}\\b`).test(page)
  }
  /**
   * หลังเปิด builder ด้วย widget ชุดนี้: หน้าเว็บแสดงชุดนี้จริงไหม
   * ok = แสดงแล้ว / ยังไม่ publish ของโพสต์ใหม่ (ไม่มี cache) / ล้าง cache แล้ว
   * stale = ยังเป็นของเก่า หรือ re-push ที่ตรวจหน้าเว็บไม่ได้และล้าง cache ไม่ได้
   */
  const verifyLive = async (widgetId: string): Promise<'ok' | 'stale'> => {
    const live = await liveShowsWidget(widgetId)
    if (live === true) return 'ok'
    if (live === null) {
      if (!opts.isUpdate) return 'ok'
      if (await clearCache()) {
        await update({})
        return 'ok'
      }
      return 'stale'
    }
    if (!(await clearCache())) return 'stale'
    await update({})
    return (await liveShowsWidget(widgetId)) === false ? 'stale' : 'ok'
  }
  // ออกจากโหมด builder → หน้าเว็บแสดง post_content (ที่เพิ่ง push) | false = ยังติด builder หรืออ่านสถานะไม่ได้
  const exitBuilder = async (): Promise<boolean> => {
    await update({ meta: { _elementor_edit_mode: '' } })
    // meta ถูกเขียนหลัง save_post — แตะโพสต์อีกรอบให้ปลั๊กอิน cache (WP Rocket) ล้างหน้าเว็บตามสถานะใหม่
    await update({})
    const after = await readMeta()
    return after != null && after._elementor_edit_mode !== 'builder'
  }
  return { readMeta, update, clearCache, verifyLive, exitBuilder }
}

/**
 * จัดโหมด Elementor ของโพสต์ให้ตรงกับที่ติ๊ก และให้หน้าเว็บแสดงเนื้อหาที่เพิ่ง push จริง
 * Elementor เปิด meta พวกนี้ให้เขียนผ่าน REST (context=edit) ได้เอง ไม่ต้องมีปลั๊กอิน convert-cake
 * - ไม่ใช้ Elementor: โพสต์ที่ถูกเปิดใน Elementor ไปแล้ว → ออกจากโหมด builder (หน้าเว็บแสดง post_content)
 * - ใช้ Elementor: เขียน HTML widget ชุดใหม่ + โหมด builder → เป็นเอกสาร Elementor จริง ทีมแก้ต่อใน Elementor ได้
 *   Elementor แสดงผลจาก cache ของตัวเอง ซึ่งการเขียน meta ผ่าน REST ไม่ล้าง (mfactors 5248 2026-10-26)
 *   จึงเปิดหน้าเว็บจริงดูว่ามี widget ชุดนี้ไหม — ไม่มี = ล้าง cache ของ Elementor แล้วดูซ้ำ
 *   ยังไม่มีอีก = กลับไปโหมดปกติ หน้าเว็บต้องเป็นเวอร์ชันใหม่เสมอ ห้ามค้างของเก่า
 * supported = false → เว็บไม่เปิด meta ของ Elementor ผ่าน REST (ไม่มี Elementor / รุ่นเก่า / อ่านไม่ได้)
 * builder = true → จบที่เอกสาร Elementor
 */
export async function syncElementorDocument(opts: ElementorSyncOptions): Promise<{ supported: boolean; builder?: boolean; warning?: string }> {
  const { isPage, useElementor, html } = opts
  const { readMeta, update, verifyLive, exitBuilder } = elementorRest(opts)
  const dataHas = (meta: Record<string, unknown> | null, widgetId: string) =>
    JSON.stringify(meta?._elementor_data ?? '').includes(widgetId)
  const templateType = isPage ? 'wp-page' : 'wp-post'

  const before = await readMeta()
  if (!before || !('_elementor_edit_mode' in before)) return { supported: false }
  const wasBuilder = before._elementor_edit_mode === 'builder'

  if (!useElementor) {
    // โพสต์ที่ไม่เคยเปิดใน Elementor และไม่ได้เลือก Elementor = ไม่ต้องแตะ
    if (!wasBuilder) return { supported: true }
    // _elementor_data เขียนเป็น HTML widget ชุดเดียวกัน — กด "Edit with Elementor" แล้วได้เวอร์ชันนี้
    // ไม่ใช่ Text Editor ที่ Elementor แปลงจาก content เอง (TinyMCE ตัด <summary> + ใส่ <br> ใน <style>)
    const widgetId = elementorId()
    // แยกคำขอ — data ใหญ่ถูกปฏิเสธก็ไม่ลากการออกจาก builder (ตัวที่ทำให้หน้าเว็บถูก) ล้มไปด้วย
    await update({ meta: { _elementor_edit_mode: '' } })
    await update({ meta: { _elementor_template_type: templateType, _elementor_data: buildElementorData(html, widgetId) } })
    await update({})
    const after = await readMeta()
    // อ่านสถานะไม่ได้ = ไม่รู้ว่าออกจาก builder แล้วหรือยัง → เตือนให้ตรวจเอง
    if (!after || after._elementor_edit_mode === 'builder') return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
    return dataHas(after, widgetId) ? { supported: true } : { supported: true, warning: ELEMENTOR_WRITE_WARNING }
  }

  // ── ใช้ Elementor ──
  const widgetId = elementorId()
  // data ก่อน แล้วค่อยเปิด builder — เปิด builder ทั้งที่ data ไม่เข้า = หน้าเว็บแสดงของเก่า/หน้าว่าง
  await update({ meta: { _elementor_template_type: templateType, _elementor_data: buildElementorData(html, widgetId) } })
  if (!dataHas(await readMeta(), widgetId)) {
    if (wasBuilder && !(await exitBuilder())) return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
    return { supported: true, builder: false, warning: ELEMENTOR_NOT_APPLIED_WARNING }
  }
  if (!wasBuilder) await update({ meta: { _elementor_edit_mode: 'builder' } })
  await update({})
  const after = await readMeta()
  // อ่านสถานะไม่ได้ = อาจเปิด builder ไปแล้ว → ถอยกลับให้แน่ใจ ไม่ปล่อยค้างโดยไม่ได้ตรวจหน้าเว็บ
  if (!after) {
    if (!(await exitBuilder())) return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
    return { supported: true, builder: false, warning: ELEMENTOR_NOT_APPLIED_WARNING }
  }
  if (after._elementor_edit_mode !== 'builder') {
    // เปิด builder ไม่ได้ — หน้าเว็บยังแสดง post_content ชุดใหม่ ไม่พัง
    return { supported: true, builder: false, warning: ELEMENTOR_NOT_APPLIED_WARNING }
  }

  if ((await verifyLive(widgetId)) === 'ok') return { supported: true, builder: true }
  // หน้าเว็บยังเป็นของเก่า (cache ของ Elementor) หรือยืนยันไม่ได้ → กลับโหมดปกติ
  if (!(await exitBuilder())) return { supported: true, warning: ELEMENTOR_STUCK_WARNING }
  return { supported: true, builder: false, warning: ELEMENTOR_STALE_WARNING }
}

/** หน้าเว็บจริงผ่าน SSRF guard (ไม่ส่งรหัสผ่าน) */
const fetchLivePage: PageFetcher = async (url) => {
  const r = await safeFetchHtml(url)
  return r.ok ? r.html : null
}

/**
 * หลังบันทึกโพสต์: จัดโหมด Elementor ตามที่ติ๊ก — ใช้ร่วมกันทั้ง Upload Article และ SEO/SME push
 * REST ก่อน — เว็บที่ไม่เปิด meta ของ Elementor ผ่าน REST หรือไม่ยอมให้เขียนผ่าน REST ค่อยใช้ปลั๊กอิน convert-cake
 * คืนคำเตือน (ถ้ามี) — push สำเร็จเสมอ เพราะ post_content ใส่เนื้อหาจริงไปตั้งแต่คำขอแรก
 */
export async function applyElementorMode(
  opts: Omit<ElementorSyncOptions, 'pageFetcher'> & { yoastMeta: Record<string, string>; pageFetcher?: PageFetcher },
): Promise<string | undefined> {
  const full: ElementorSyncOptions = { ...opts, pageFetcher: opts.pageFetcher ?? fetchLivePage }
  const sync = await syncElementorDocument(full)
  if (!opts.useElementor) return sync.warning
  // จบทาง REST: เป็นเอกสาร Elementor แล้ว / ถอยกลับเพราะ cache ค้าง (ปลั๊กอินเปิด builder ซ้ำก็เจอ cache เดิม)
  if (sync.supported && (sync.builder || sync.warning === ELEMENTOR_STALE_WARNING)) return sync.warning
  // เหลือ: REST ไม่มี / REST ไม่ยอมเขียน data หรือ builder / ค้าง builder — ปลั๊กอินเขียน data แบบ base64 + เปิด builder
  const widgetId = elementorId()
  const ccRes = await opts.fetcher(`${opts.wpUrl}/wp-json/convert-cake/v1/elementor-meta`, {
    method: 'POST',
    headers: { Authorization: `Basic ${opts.creds}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_id: opts.postId,
      elementor_data_b64: Buffer.from(buildElementorData(opts.html, widgetId)).toString('base64'),
      edit_mode: 'builder',
      template_type: opts.isPage ? 'wp-page' : 'wp-post',
      yoast_meta: opts.yoastMeta,
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null)
  if (!ccRes?.ok) return sync.supported ? sync.warning : ELEMENTOR_UNSUPPORTED_WARNING
  // ปลั๊กอินเปิด builder ด้วย widget ชุดนี้แล้ว — ตรวจหน้าเว็บเหมือนทาง REST
  const rest = elementorRest(full)
  if ((await rest.verifyLive(widgetId)) === 'ok') return undefined
  if (!sync.supported) return ELEMENTOR_PLUGIN_STALE_WARNING
  return (await rest.exitBuilder()) ? ELEMENTOR_STALE_WARNING : ELEMENTOR_STUCK_WARNING
}

/** เรียก fn กับ items พร้อมกันไม่เกิน limit ตัว — คงลำดับผลลัพธ์ตาม items เดิม */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

/**
 * รูปที่ฝังเป็น data:image ในเนื้อหา → อัปขึ้น Media Library แล้วเปลี่ยน src เป็นลิงก์จริง
 * (HTML สั้นลงมาก และ WordPress บางเว็บตัด data: URI ทิ้ง) อัปไม่สำเร็จ = คงรูปเดิมไว้
 * อัปพร้อมกันไม่เกิน 3 รูป — data URI ซ้ำ (Map dedupe โดย key) อัปครั้งเดียว
 */
/** alt ของแท็ก <img> ที่ครอบตำแหน่ง pos (ตำแหน่ง src ใน html) — ถอด entity พื้นฐาน, ไม่มี = '' */
function imgAltAt(html: string, pos: number): string {
  const start = html.lastIndexOf('<img', pos)
  const end = html.indexOf('>', pos)
  if (start < 0 || end < 0) return ''
  const tag = html.slice(start, end + 1)
  const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] || ''
  return alt.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

async function replaceInlineImages(
  wpUrl: string, creds: string, html: string, title: string, known: Map<string, string>,
): Promise<string> {
  const re = /src="(data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+))"/gi
  const found = new Map<string, { mime: string; base64: string; alt: string }>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (found.get(m[1])?.alt) continue
    found.set(m[1], { mime: m[2].toLowerCase(), base64: m[3], alt: imgAltAt(html, m.index) })
  }
  const toUpload = Array.from(found.entries()).filter(([dataUri]) => !known.has(dataUri))
  const uploadedNow = new Map<string, string>()
  await mapWithConcurrency(toUpload, 3, async ([dataUri, img]) => {
    // ชื่อรูปใน Media Library = alt ของรูปนั้น (ไม่มี alt = ชื่อบทความแบบเดิม)
    const name = img.alt || title
    const result = await uploadMedia(wpUrl, creds, img.base64, img.mime, name, name)
    if (result?.url) uploadedNow.set(dataUri, result.url)
  })
  let out = html
  for (const [dataUri] of Array.from(found)) {
    const url = known.get(dataUri) ?? uploadedNow.get(dataUri)
    if (url) out = out.split(dataUri).join(url)
  }
  return out
}

async function uploadMedia(
  wpUrl: string, creds: string, imageBase64: string, mimeType: string, title: string, altText: string,
): Promise<{ id: number; url: string } | null> {
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64')
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp'
    const boundary = `----WPUpload${Date.now()}`
    const filename = `cover-${Date.now()}.${ext}`

    const titleBuf = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="alt_text"\r\n\r\n${altText}\r\n`,
    )
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    )
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([titleBuf, header, imageBuffer, footer])

    const res = await safeFetch(`${wpUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    }, { requireHttps: true, sameHostOnly: true })

    if (!res.ok) return null
    const data = await res.json()
    return data.id ? { id: Number(data.id), url: String(data.source_url || '') } : null
  } catch {
    return null
  }
}

/** push บทความหนึ่งชิ้นขึ้น WordPress (สร้างใหม่ หรืออัพเดตถ้ามี slug ชนกัน) */
export async function pushArticleToWordPress(input: WpPushInput): Promise<WpPushResult> {
  const wpUrl = normalizeWpUrl(input.wpUrl)
  const wpUser = input.wpUser.trim()
  const wpPass = input.wpPass
  if (!wpUrl || !wpUser || !wpPass) {
    return { ok: false, error: 'ไม่พบ WordPress credentials' }
  }
  if (!input.html || !input.title) {
    return { ok: false, error: 'html และ title จำเป็น' }
  }

  const creds = Buffer.from(`${wpUser}:${wpPass.replace(/\s+/g, '')}`).toString('base64')
  const isPage = input.wpPostType === 'page'
  const finalMetaTitle = input.metaTitle || input.title
  const finalMetaDesc = input.metaDescription || ''
  const finalSlug = input.slug?.trim() || ''
  const coverAltText = input.coverAlt || finalMetaTitle

  // WordPress แปลงขึ้นบรรทัดใหม่เป็น <br /> แม้ใน <style> — CSS ทั้งก้อนพัง (FAQ ไม่มีการ์ด) ต้องยุบเป็นบรรทัดเดียว
  const htmlWithAlt = flattenEmbeddedNewlines(input.html).replace(
    /<img(?![^>]*\balt=)([^>]*?)(\s*\/?>)/gi,
    `<img alt="${finalMetaTitle.replace(/"/g, '&quot;')}"$1$2`,
  )

  let featuredMediaId: number | null = null
  const uploaded = new Map<string, string>()
  if (input.coverBase64) {
    const mime = input.coverMimeType || 'image/webp'
    const cover = await uploadMedia(wpUrl, creds, input.coverBase64, mime, finalMetaTitle, coverAltText)
    featuredMediaId = cover?.id ?? null
    // ปกในเนื้อหาเป็นรูปเดียวกับ featured image — ใช้ลิงก์ที่อัปแล้ว ไม่อัปซ้ำ
    if (cover?.url) uploaded.set(`data:${mime};base64,${input.coverBase64}`, cover.url)
  }
  const htmlLinked = await replaceInlineImages(wpUrl, creds, htmlWithAlt, finalMetaTitle, uploaded)

  // ใส่เนื้อหาเสมอแม้ใช้ Elementor — เขียน Elementor ไม่สำเร็จ หน้าเว็บก็ยังแสดงเนื้อหาจริง ไม่ใช่หน้าว่าง
  const content = htmlLinked
  const publishDate = input.publishAt ? new Date(input.publishAt) : null
  const dateGmt = publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate.toISOString().slice(0, 19) : ''
  // ตั้งวันเผยแพร่ไว้ = วาง Draft พร้อมวันที่นั้น ไม่ publish/ตั้งเวลาเอง (เจ้าของสั่ง 2026-09-28)
  const wpStatus = dateGmt ? 'draft' : input.publishMode === 'publish' ? 'publish' : 'draft'
  const payload: Record<string, unknown> = {
    title: input.title,
    content,
    excerpt: finalMetaDesc ? finalMetaDesc.slice(0, 160) : undefined,
    status: wpStatus,
    ...(dateGmt && { date_gmt: dateGmt }),
    ...(finalSlug && { slug: finalSlug }),
    ...(featuredMediaId && { featured_media: featuredMediaId }),
  }

  const wpMeta: Record<string, string> = {}
  if (finalMetaTitle) wpMeta['_yoast_wpseo_title'] = finalMetaTitle
  if (finalMetaDesc) wpMeta['_yoast_wpseo_metadesc'] = finalMetaDesc.slice(0, 160)
  if (input.focusKeyword) wpMeta['_yoast_wpseo_focuskw'] = input.focusKeyword

  const wpEndpoint = isPage ? `${wpUrl}/wp-json/wp/v2/pages` : `${wpUrl}/wp-json/wp/v2/posts`
  // โหมด Elementor ตั้งใน syncElementorDocument หลังสร้างโพสต์ — ไม่ปนในคำขอแรก (ล้ม = retry ทิ้ง Yoast meta ไปด้วย)
  if (Object.keys(wpMeta).length > 0) payload.meta = wpMeta

  // หา post ที่มีอยู่แล้ว: re-push ใช้ existingPostId ตรง ๆ ก่อน ถ้าไม่มีค่อยตรวจ slug ชนกัน
  const findBySlug = async (): Promise<number | null> => {
    if (!finalSlug) return null
    const checkUrl = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}?slug=${encodeURIComponent(finalSlug)}&status=any&_fields=id&per_page=1`
    const checkRes = await safeFetch(checkUrl, {
      headers: { Authorization: `Basic ${creds}` },
      signal: AbortSignal.timeout(10000),
    }, { requireHttps: true, sameHostOnly: true }).catch(() => null)
    if (checkRes?.ok) {
      const found = await checkRes.json().catch(() => [])
      if (Array.isArray(found) && found.length > 0) return found[0].id
    }
    return null
  }

  let existingPostId: number | null = input.existingPostId ?? null
  if (!existingPostId) existingPostId = await findBySlug()

  try {
    let endpoint = existingPostId
      ? `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${existingPostId}`
      : wpEndpoint

    let res = await safeFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    }, { requireHttps: true, sameHostOnly: true })

    // post ที่เคย push ไว้ถูกลบไปแล้วบน WP → หา slug ใหม่ / สร้างใหม่แทน
    if (res.status === 404 && input.existingPostId && existingPostId === input.existingPostId) {
      existingPostId = await findBySlug()
      endpoint = existingPostId
        ? `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${existingPostId}`
        : wpEndpoint
      res = await safeFetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      }, { requireHttps: true, sameHostOnly: true })
    }

    if (!res.ok && payload.meta) {
      const retryPayload = { ...payload }
      delete retryPayload.meta
      res = await safeFetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
        signal: AbortSignal.timeout(30000),
      }, { requireHttps: true, sameHostOnly: true })
    }

    if (!res.ok) {
      const errText = await res.text()
      return { ok: false, error: `WordPress API error ${res.status}: ${errText.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}` }
    }

    const data = await res.json()
    const postId: number = data.id
    const postUrl: string = data.link ?? ''

    // Elementor: ติ๊ก = เอกสาร Elementor (HTML widget ชุดเดียวกับ content) ไม่ติ๊ก = ออกจาก builder
    let warning: string | undefined
    if (postId) {
      warning = await applyElementorMode({
        wpUrl, creds, postId, isPage,
        useElementor: !!input.useElementor,
        html: htmlLinked,
        isUpdate: existingPostId != null,
        liveUrl: data.status === 'publish' && postUrl ? postUrl : undefined,
        yoastMeta: wpMeta,
        fetcher: (url, init) => safeFetch(url, init, { requireHttps: true, sameHostOnly: true }),
      })
      if (Object.keys(wpMeta).length > 0) {
        // ส่ง Yoast meta ซ้ำทุกโหมด (รวม Elementor) — คำขอแรกอาจ retry แบบตัด meta ทิ้งไปแล้ว
        const normalEndpoint = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${postId}`
        await safeFetch(normalEndpoint, {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ meta: wpMeta }),
          signal: AbortSignal.timeout(20000),
        }, { requireHttps: true, sameHostOnly: true }).catch(() => {})
      }

      if (isPage && Object.keys(wpMeta).length) {
        const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
        const customFields = Object.entries(wpMeta).map(([key, value]) =>
          `<value><struct><member><name>key</name><value><string>${escXml(key)}</string></value></member><member><name>value</name><value><string>${escXml(value)}</string></value></member></struct></value>`,
        ).join('')
        const cleanPass = wpPass.replace(/\s+/g, '')
        const xmlBody = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<methodCall><methodName>wp.editPost</methodName><params>',
          `<param><value><int>1</int></value></param>`,
          `<param><value><string>${escXml(wpUser)}</string></value></param>`,
          `<param><value><string>${escXml(cleanPass)}</string></value></param>`,
          `<param><value><int>${postId}</int></value></param>`,
          `<param><value><struct><member><name>custom_fields</name><value><array><data>${customFields}</data></array></value></member></struct></value></param>`,
          '</params></methodCall>',
        ].join('')
        await safeFetch(`${wpUrl}/xmlrpc.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
          body: xmlBody,
          signal: AbortSignal.timeout(15000),
        }, { requireHttps: true, sameHostOnly: true }).catch(() => null)
      }
    }

    return { ok: true, postId, postUrl, status: data.status, slug: data.slug ?? finalSlug, ...(warning && { warning }) }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Push ล้มเหลว: ${msg}` }
  }
}

/** ทดสอบการเชื่อมต่อ WordPress (คัดลอกจาก src/app/api/push/connect/route.ts) */
export async function testWordPressConnection(
  wpUrl: string, wpUser: string, wpPass: string,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const url = normalizeWpUrl(wpUrl)
  if (!url || !wpUser || !wpPass) {
    return { ok: false, error: 'ไม่พบ WordPress credentials' }
  }
  try {
    const cleanPass = wpPass.replace(/\s+/g, '')
    const creds = Buffer.from(`${wpUser}:${cleanPass}`).toString('base64')
    const authHeaders = {
      Authorization: `Basic ${creds}`,
      'User-Agent': 'MarsOS/1.0',
      'Content-Type': 'application/json',
    }

    const meRes = await safeFetch(`${url}/wp-json/wp/v2/users/me`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(10000),
    }, { requireHttps: true, sameHostOnly: true })
    if (meRes.ok) {
      const me = await meRes.json()
      return { ok: true, name: me.name ?? wpUser }
    }

    const rootRes = await safeFetch(`${url}/wp-json/wp/v2`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(10000),
    }, { requireHttps: true, sameHostOnly: true })
    if (rootRes.ok) {
      const data = await rootRes.json()
      return { ok: true, name: data.name ?? '' }
    }

    return {
      ok: false,
      error: `WordPress ตอบ ${meRes.status} — ${meRes.status === 401
        ? 'Application Password ไม่ถูกต้อง หรือ user ไม่มีสิทธิ์ REST API'
        : meRes.status === 403
        ? 'WordPress บล็อก REST API — ตรวจสอบ plugin หรือ .htaccess'
        : 'ตรวจสอบ URL และ Application Password'}`,
    }
  } catch (e: unknown) {
    return { ok: false, error: `เชื่อมต่อไม่ได้: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * อ่านสถานะจริงของโพสต์บน WordPress (publish/draft/future/...) + ลิงก์ถาวร
 * ใช้ก่อน Request Index — บทความที่ตั้งวันเผยแพร่ขึ้นไปเป็น Draft ทีมจะกด Publish ใน WordPress เอง
 */
export async function getWordPressPostStatus(
  wpUrl: string, wpUser: string, wpPass: string, postId: string, postType: 'post' | 'page' = 'post',
): Promise<{ ok: boolean; status?: string; link?: string; error?: string }> {
  const url = normalizeWpUrl(wpUrl)
  if (!url || !wpUser || !wpPass) return { ok: false, error: 'ไม่พบ WordPress credentials' }
  if (!/^\d+$/.test(postId)) return { ok: false, error: 'ไม่พบ ID โพสต์บน WordPress' }
  const creds = Buffer.from(`${wpUser}:${wpPass.replace(/\s+/g, '')}`).toString('base64')
  const headers = { Authorization: `Basic ${creds}`, 'User-Agent': 'MarsOS/1.0' }
  // ไม่รู้ว่าเคย push เป็น post หรือ page — ลองชนิดที่ตั้งไว้ก่อน แล้วค่อยลองอีกชนิด
  const types = postType === 'page' ? ['pages', 'posts'] : ['posts', 'pages']
  try {
    let lastStatus = 0
    for (const t of types) {
      const res = await safeFetch(`${url}/wp-json/wp/v2/${t}/${postId}?context=edit&_fields=status,link`, {
        headers,
        signal: AbortSignal.timeout(10000),
      }, { requireHttps: true, sameHostOnly: true })
      if (res.ok) {
        const data = await res.json() as { status?: string; link?: string }
        return { ok: true, status: data.status, link: data.link }
      }
      lastStatus = res.status
      if (res.status !== 404) break
    }
    return { ok: false, error: lastStatus === 404 ? 'ไม่พบโพสต์นี้บน WordPress แล้ว (อาจถูกลบ)' : `WordPress ตอบ ${lastStatus}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
