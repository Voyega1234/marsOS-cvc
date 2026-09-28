// ─── Upload Article — push บทความขึ้น WordPress ─────────────────────────────
// คัดลอก/ปรับจากตรรกะใน src/app/api/push/publish/route.ts (ห้ามแก้ไฟล์เดิม)
// เป็น pure function ล้วน — ไม่แตะ prisma/session, รับ credentials ตรงจากผู้เรียก

import { safeFetch } from './safe-fetch'

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
  /** วัน-เวลาเผยแพร่ (ISO UTC) — ส่งเป็น date_gmt; ถ้าเป็นอนาคตและโหมด publish = ตั้งเวลา (status future) */
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
}

export function normalizeWpUrl(raw: string): string {
  return raw.trim().replace(/\/(wp-admin|wp-login\.php)(\/.*)?$/, '').replace(/\/$/, '')
}

function buildElementorData(html: string): string {
  const uid = () => Math.random().toString(16).slice(2, 10)
  const data = [{
    id: uid(), elType: 'section',
    settings: { layout: 'full_width', content_width: { unit: '%', size: 100 } },
    elements: [{
      id: uid(), elType: 'column',
      settings: { _column_size: 100, _inline_size: null },
      elements: [{
        id: uid(), elType: 'widget', widgetType: 'html',
        settings: { html },
        elements: [],
      }],
    }],
  }]
  return JSON.stringify(data)
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
async function replaceInlineImages(
  wpUrl: string, creds: string, html: string, title: string, known: Map<string, string>,
): Promise<string> {
  const re = /src="(data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+))"/gi
  const found = new Map<string, { mime: string; base64: string }>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) found.set(m[1], { mime: m[2].toLowerCase(), base64: m[3] })
  const toUpload = Array.from(found.entries()).filter(([dataUri]) => !known.has(dataUri))
  const uploadedNow = new Map<string, string>()
  await mapWithConcurrency(toUpload, 3, async ([dataUri, img]) => {
    const result = await uploadMedia(wpUrl, creds, img.base64, img.mime, title, title)
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

  const htmlWithAlt = input.html.replace(
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

  const content = input.useElementor ? '' : htmlLinked
  const publishDate = input.publishAt ? new Date(input.publishAt) : null
  const dateGmt = publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate.toISOString().slice(0, 19) : ''
  const isFuture = Boolean(publishDate && publishDate.getTime() > Date.now() + 60_000)
  const wpStatus = input.publishMode === 'publish' ? (isFuture ? 'future' : 'publish') : 'draft'
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
  if (input.useElementor) {
    wpMeta['_elementor_edit_mode'] = 'builder'
    wpMeta['_elementor_template_type'] = isPage ? 'wp-page' : 'wp-post'
  }
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

    // Yoast meta + Elementor data ผ่าน convert-cake plugin (มี fallback ถ้าไม่มี plugin) — เฉพาะตอนใช้ Elementor เท่านั้น
    if (postId) {
      if (input.useElementor) {
        const ccEndpoint = `${wpUrl}/wp-json/convert-cake/v1/elementor-meta`
        const elementorData = buildElementorData(htmlLinked)
        const ccRes = await safeFetch(ccEndpoint, {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            post_id: postId,
            elementor_data_b64: Buffer.from(elementorData).toString('base64'),
            edit_mode: 'builder',
            template_type: isPage ? 'wp-page' : 'wp-post',
            yoast_meta: wpMeta,
          }),
          signal: AbortSignal.timeout(30000),
        }, { requireHttps: true, sameHostOnly: true }).catch(() => null)

        if (!ccRes?.ok) {
          const fallbackEndpoint = `${wpUrl}/wp-json/wp/v2/${isPage ? 'pages' : 'posts'}/${postId}`
          await safeFetch(fallbackEndpoint, {
            method: 'POST',
            headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: htmlLinked }),
            signal: AbortSignal.timeout(20000),
          }, { requireHttps: true, sameHostOnly: true }).catch(() => {})
        }
      } else if (Object.keys(wpMeta).length > 0) {
        // ไม่ใช้ Elementor — ส่ง Yoast meta ผ่านการอัพเดตโพสต์ปกติ ไม่ตั้ง Elementor builder mode
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

    return { ok: true, postId, postUrl, status: data.status, slug: data.slug ?? finalSlug }
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
