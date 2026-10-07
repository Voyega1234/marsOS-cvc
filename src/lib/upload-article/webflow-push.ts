// ─── Upload Article — push บทความขึ้น Webflow (Data API v2) ──────────────────
// เทียบเท่า wp-push.ts: อัปโหลดรูป data-URI + ปก เข้า Assets, อัปเดต item เดิมเมื่อ push ซ้ำ, เติม alt
// pure function — ไม่แตะ prisma/session รับ credentials ตรงจากผู้เรียก

import { createHash } from 'crypto'

const WF = 'https://api.webflow.com/v2'
const READ_TIMEOUT = 20_000
const WRITE_TIMEOUT = 60_000
const ID_RE = /^[a-f0-9]{24}$/i

export interface WebflowUploadConfig { apiToken?: string; siteId?: string; collectionId?: string; collectionSlug?: string; siteUrl?: string; bodyField?: string; imageField?: string; descriptionField?: string; seoTitleField?: string }
export interface WebflowPushInput { title: string; html: string; slug?: string; metaTitle?: string; metaDescription?: string; coverBase64?: string; coverMimeType?: string; coverAlt?: string; publishMode: 'draft' | 'publish'; existingItemId?: string | null }
export interface WebflowPushResult { ok: boolean; itemId?: string; postUrl?: string; error?: string; status?: 'draft' | 'publish' }

class WfError extends Error {}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  let msg = text.slice(0, 250)
  try {
    const j = JSON.parse(text)
    if (j?.message) msg = String(j.message)
  } catch { /* ใช้ข้อความดิบ */ }
  return `HTTP ${res.status}: ${msg}`
}

const mapped = (v?: string) => (v && v !== 'none' ? v : '')

/** เรียก fn กับ items พร้อมกันไม่เกิน limit ตัว */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** ตัด style/script และ H1 นำหน้าออก (Webflow RichText ตัดอยู่แล้ว / ชื่อ item คือ title) */
export function cleanWebflowHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, '')
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('svg')) return 'svg'
  return 'png'
}

const ASSET_ERR = 'อัปโหลดรูปเข้า Webflow Assets ไม่สำเร็จ — token ต้องมีสิทธิ์ assets:write (และ CMS read/write)'

async function uploadAsset(token: string, siteId: string, b64: string, mime: string): Promise<string> {
  const bytes = Buffer.from(b64, 'base64')
  const md5 = createHash('md5').update(bytes).digest('hex')
  const fileName = `upload-${md5.slice(0, 12)}.${extFromMime(mime)}`
  const metaRes = await fetch(`${WF}/sites/${siteId}/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, fileHash: md5 }),
    signal: AbortSignal.timeout(READ_TIMEOUT),
  })
  if (!metaRes.ok) throw new WfError(`${ASSET_ERR} (${await readError(metaRes)})`)
  const meta = await metaRes.json()
  if (!meta.uploadUrl || !meta.hostedUrl) throw new WfError(`${ASSET_ERR} (ไม่ได้รับ uploadUrl)`)
  const form = new FormData()
  for (const [k, v] of Object.entries(meta.uploadDetails ?? {})) form.append(k, String(v))
  form.append('file', new Blob([bytes], { type: mime }), fileName)
  const upRes = await fetch(meta.uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(WRITE_TIMEOUT) })
  if (!(upRes.status >= 200 && upRes.status < 300)) throw new WfError(`${ASSET_ERR} (${await readError(upRes)})`)
  return meta.hostedUrl
}

/** หา siteId ที่มี collection นี้ — Webflow v2 GET /collections/{id} ไม่ส่ง siteId กลับมา จึงต้องไล่ดูจากรายการเว็บของ token */
export async function findWebflowSiteIdForCollection(token: string, collectionId: string): Promise<string | null> {
  const auth = { Authorization: `Bearer ${token}` }
  const sitesRes = await fetch(`${WF}/sites`, { headers: auth, signal: AbortSignal.timeout(READ_TIMEOUT) })
  if (!sitesRes.ok) return null
  const sites: { id: string }[] = (await sitesRes.json()).sites ?? []
  if (sites.length === 1) return sites[0].id
  for (const s of sites) {
    const r = await fetch(`${WF}/sites/${s.id}/collections`, { headers: auth, signal: AbortSignal.timeout(READ_TIMEOUT) })
    if (!r.ok) continue
    const cols: { id: string }[] = (await r.json()).collections ?? []
    if (cols.some(c => c.id === collectionId)) return s.id
  }
  return null
}

export async function pushArticleToWebflow(cfg: WebflowUploadConfig, input: WebflowPushInput): Promise<WebflowPushResult> {
  const token = cfg.apiToken
  const cid = cfg.collectionId
  if (!token || !cid) {
    return { ok: false, error: 'Webflow ยังตั้งค่าไม่ครบ — กดทดสอบการเชื่อมต่อแล้วเลือก Collection ใน Project Setting' }
  }
  const auth = { Authorization: `Bearer ${token}` }
  try {
    // ดึง collection เฉพาะเมื่อจำเป็น (หา RichText ตัวแรก / siteId)
    let collection: { siteId?: string; fields?: { slug: string; type: string }[] } | null = null
    const getCollection = async () => {
      if (collection) return collection
      const res = await fetch(`${WF}/collections/${cid}`, { headers: auth, signal: AbortSignal.timeout(READ_TIMEOUT) })
      if (!res.ok) throw new WfError(`อ่าน Webflow Collection ไม่สำเร็จ — ${await readError(res)}`)
      collection = await res.json()
      return collection!
    }

    let bodyField = mapped(cfg.bodyField)
    if (!bodyField) {
      const c = await getCollection()
      bodyField = c.fields?.find(f => f.type === 'RichText')?.slug ?? ''
      if (!bodyField) return { ok: false, error: 'Collection นี้ไม่มีฟิลด์ RichText สำหรับเนื้อหา — เลือกฟิลด์เนื้อหาใน Project Setting' }
    }

    let html = cleanWebflowHtml(input.html)
    const alt = (input.metaTitle || input.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    // รวบรวมรูปที่ต้องอัปโหลด (data-URI ในเนื้อหา + ปก) แล้ว de-dup ด้วย md5
    const dataUriRe = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi
    const assets = new Map<string, { b64: string; mime: string }>() // md5 -> data
    const md5Of = (b64: string) => createHash('md5').update(Buffer.from(b64, 'base64')).digest('hex')
    for (const m of Array.from(html.matchAll(dataUriRe))) assets.set(md5Of(m[2]), { b64: m[2], mime: m[1] })
    let coverMd5 = ''
    if (input.coverBase64) {
      coverMd5 = md5Of(input.coverBase64)
      if (!assets.has(coverMd5)) assets.set(coverMd5, { b64: input.coverBase64, mime: input.coverMimeType || 'image/png' })
    }

    const hosted = new Map<string, string>()
    if (assets.size) {
      let siteId = cfg.siteId
      if (!siteId) siteId = (await getCollection()).siteId
      if (!siteId) siteId = (await findWebflowSiteIdForCollection(token, cid)) ?? undefined
      if (!siteId) return { ok: false, error: 'หา Webflow site ของ Collection ไม่เจอ — กดทดสอบการเชื่อมต่อใหม่' }
      const sid = siteId
      await mapLimit(Array.from(assets.entries()), 3, async ([md5, a]) => {
        hosted.set(md5, await uploadAsset(token, sid, a.b64, a.mime))
      })
      html = html.replace(dataUriRe, (_all, _mime, b64) => hosted.get(md5Of(b64)) ?? '')
    }

    // เติม alt ที่ขาดให้ img
    html = html.replace(/<img\b[^>]*>/gi, tag => (/\balt\s*=/i.test(tag) ? tag : tag.replace(/<img\b/i, `<img alt="${alt}"`)))

    const fieldData: Record<string, unknown> = { name: input.title, slug: input.slug || undefined, [bodyField]: html }
    const imageField = mapped(cfg.imageField)
    if (imageField && coverMd5 && hosted.get(coverMd5)) {
      fieldData[imageField] = { url: hosted.get(coverMd5), alt: input.coverAlt || input.title }
    }
    const descField = mapped(cfg.descriptionField)
    if (descField && input.metaDescription) fieldData[descField] = input.metaDescription
    const seoField = mapped(cfg.seoTitleField)
    if (seoField && input.metaTitle) fieldData[seoField] = input.metaTitle

    const live = input.publishMode === 'publish'
    const send = async (method: string, url: string, body: unknown) =>
      fetch(url, {
        method,
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WRITE_TIMEOUT),
      })

    let res: Response | null = null
    if (input.existingItemId && ID_RE.test(input.existingItemId)) {
      const base = `${WF}/collections/${cid}/items/${input.existingItemId}`
      res = live
        ? await send('PATCH', `${base}/live`, { isDraft: false, isArchived: false, fieldData })
        : await send('PATCH', base, { isDraft: true, fieldData })
      if (res.status === 404) res = null // item เดิมถูกลบ → สร้างใหม่
    }
    if (!res) {
      res = await send('POST', `${WF}/collections/${cid}/items${live ? '/live' : ''}`, { isArchived: false, isDraft: !live, fieldData })
    }
    if (!res.ok) {
      const err = await readError(res)
      if (res.status === 409 || /slug|unique|duplicate/i.test(err)) {
        return { ok: false, error: `Slug ซ้ำกับบทความอื่นใน Webflow — เปลี่ยน slug แล้วลองใหม่ (${err})` }
      }
      return { ok: false, error: `Webflow push ไม่สำเร็จ — ${err}` }
    }
    const item = await res.json()
    const itemSlug: string = item?.fieldData?.slug || input.slug || ''
    // customDomains[].url ของ Webflow ไม่มี protocol (เช่น www.example.com) — เติม https:// ให้
    const rawSite = (cfg.siteUrl || '').trim().replace(/\/+$/, '')
    const site = rawSite && !/^https?:\/\//i.test(rawSite) ? `https://${rawSite}` : rawSite
    // URL ของ item = /{collection slug}/{item slug} — ไม่รู้ collection slug ก็ไม่เดา URL
    const postUrl = site && cfg.collectionSlug && itemSlug ? `${site}/${cfg.collectionSlug}/${itemSlug}` : ''
    return { ok: true, itemId: item?.id, postUrl, status: live ? 'publish' : 'draft' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
