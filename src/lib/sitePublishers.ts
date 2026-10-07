/**
 * Site Publishers — เชื่อม + ลงบทความกับแพลตฟอร์มที่ไม่ใช่ WordPress
 * (WordPress ยังใช้เส้นทางเดิมใน /api/push/publish — ไม่แตะ)
 *
 * รองรับ:
 * - shopify : Admin REST API — บทความลง Blog (body_html รับ HTML ตรง)
 * - webflow : Data API v2 — สร้าง CMS item (RichText field รับ HTML ตรง)
 * - wix     : Blog v3 — draft post ผ่าน Ricos โดยห่อ HTML ใน HTML node
 * - custom  : Webhook กลาง — POST JSON ไปยัง endpoint ของเว็บลูกค้าเอง
 *
 * credentials เก็บใน Project.siteConnection (JSON) ตาม shape ด้านล่าง
 */

import { createHash } from 'crypto'

export interface SiteConnectionConfig {
  shopify?: { storeDomain?: string; accessToken?: string; blogId?: string; blogHandle?: string }
  webflow?: { apiToken?: string; siteId?: string; collectionId?: string; bodyField?: string; siteUrl?: string }
  wix?: { apiKey?: string; siteId?: string; memberId?: string }
  custom?: { webhookUrl?: string; secret?: string }
}

export type SitePlatform = 'webflow' | 'wix' | 'shopify' | 'custom'

export interface ConnectionTestResult {
  ok: boolean
  name?: string
  url?: string
  /** Webflow: id ของเว็บที่ token เห็น — บันทึกไว้ใช้อัปโหลดรูปตอน push */
  siteId?: string
  error?: string
  /** ตัวเลือกให้ผู้ใช้เลือกต่อ (Shopify: blog / Webflow: collection) */
  choices?: {
    blogs?: Array<{ id: string; title: string; handle: string }>
    collections?: Array<{ id: string; name: string; slug: string }>
    /** Wix: ผู้เขียน (Member) ที่เลือกเป็น memberId */
    members?: Array<{ id: string; name: string }>
  }
}

export interface PublishPayload {
  title: string
  html: string
  slug?: string
  excerpt?: string
  coverBase64?: string
  coverMimeType?: string
  publishMode: 'draft' | 'publish'
  /** id ของโพสต์ที่เคย push ไว้ — มีค่า = แก้ของเดิมแทนสร้างใหม่ (Shopify/Wix/Custom) */
  existingId?: string
  metaTitle?: string
  metaDescription?: string
  coverAlt?: string
}

export interface PublishResult {
  ok: boolean
  postUrl?: string
  postId?: string
  error?: string
  /** push สำเร็จแต่มีบางส่วนไม่ครบ (เช่น รูปอัปโหลดไม่ได้) */
  warning?: string
}

const TIMEOUT = 20_000
const SHOPIFY_API_VERSION = '2024-07'

function normalizeShopifyDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  return `HTTP ${res.status}: ${text.slice(0, 250)}`
}

// ── Shopify ───────────────────────────────────────────────────────────────────

async function shopifyTest(cfg: NonNullable<SiteConnectionConfig['shopify']>): Promise<ConnectionTestResult> {
  const domain = normalizeShopifyDomain(cfg.storeDomain ?? '')
  if (!domain || !cfg.accessToken) return { ok: false, error: 'ต้องใส่ Store domain และ Admin API access token' }
  const headers = { 'X-Shopify-Access-Token': cfg.accessToken, 'Content-Type': 'application/json' }
  const shopRes = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
    headers, signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!shopRes.ok) return { ok: false, error: `เชื่อม Shopify ไม่ได้ — ${await readError(shopRes)}` }
  const shop = (await shopRes.json()).shop
  const blogsRes = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/blogs.json`, {
    headers, signal: AbortSignal.timeout(TIMEOUT),
  })
  const blogs = blogsRes.ok ? ((await blogsRes.json()).blogs ?? []) : []
  return {
    ok: true,
    name: shop?.name ?? domain,
    url: shop?.domain ? `https://${shop.domain}` : `https://${domain}`,
    choices: { blogs: blogs.map((b: { id: number; title: string; handle: string }) => ({ id: String(b.id), title: b.title, handle: b.handle })) },
  }
}

const SHOPIFY_FILES_WARNING = 'อัปโหลดรูปในบทความเข้า Shopify ไม่สำเร็จ (ต้องมีสิทธิ์ write_files) — รูปในเนื้อหาถูกตัดออก'
const DATA_IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*(["'])(data:image\/[a-z0-9.+-]+;base64,[^"']+)\1[^>]*>/gi

async function shopifyGraphql(domain: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) throw new Error(await readError(res))
  const json = await res.json()
  if (Array.isArray(json.errors) && json.errors.length) throw new Error(JSON.stringify(json.errors).slice(0, 250))
  return json.data
}

/** อัปโหลดรูป data URI หนึ่งรูปเข้า Shopify Files → คืน URL บน CDN */
async function shopifyUploadImage(domain: string, token: string, dataUri: string, alt: string, index: number): Promise<string> {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUri)
  if (!m) throw new Error('data URI ไม่ถูกต้อง')
  const mime = m[1].toLowerCase()
  const bytes = Buffer.from(m[2], 'base64')
  const ext = mime.split('/')[1].replace('jpeg', 'jpg').replace(/\+.*$/, '')
  const filename = `article-${Date.now()}-${index}.${ext}`

  const staged = await shopifyGraphql(domain, token,
    `mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}`,
    { input: [{ resource: 'IMAGE', filename, mimeType: mime, httpMethod: 'POST', fileSize: String(bytes.length) }] })
  const sErr = staged?.stagedUploadsCreate?.userErrors?.[0]
  if (sErr) throw new Error(sErr.message)
  const target = staged?.stagedUploadsCreate?.stagedTargets?.[0]
  if (!target) throw new Error('ไม่ได้ staged target')

  const form = new FormData()
  for (const prm of target.parameters ?? []) form.append(prm.name, prm.value)
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename)
  const up = await fetch(target.url, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
  if (!up.ok) throw new Error(await readError(up))

  const created = await shopifyGraphql(domain, token,
    `mutation($files:[FileCreateInput!]!){fileCreate(files:$files){files{id} userErrors{field message}}}`,
    { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt }] })
  const cErr = created?.fileCreate?.userErrors?.[0]
  if (cErr) throw new Error(cErr.message)
  const fileId = created?.fileCreate?.files?.[0]?.id
  if (!fileId) throw new Error('สร้างไฟล์ไม่สำเร็จ')

  // รอให้ Shopify ประมวลผลรูปเสร็จ (สูงสุด ~15 วินาที)
  for (let i = 0; i < 15; i++) {
    const node = await shopifyGraphql(domain, token,
      `query($id:ID!){node(id:$id){... on MediaImage{fileStatus image{url}}}}`, { id: fileId })
    if (node?.node?.fileStatus === 'FAILED') throw new Error('Shopify ประมวลผลรูปไม่สำเร็จ')
    if (node?.node?.fileStatus === 'READY' && node.node.image?.url) return node.node.image.url
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('รอรูปประมวลผลนานเกินไป')
}

/** แทน data URI ในเนื้อหาด้วย URL จริงบน Shopify — รูปที่อัปโหลดไม่ได้จะถูกตัด <img> ทิ้ง */
async function shopifyReplaceInlineImages(domain: string, token: string, html: string): Promise<{ html: string; failed: boolean }> {
  const uniq = new Map<string, { uri: string; alt: string }>()
  for (const m of Array.from(html.matchAll(DATA_IMG_RE))) {
    const key = createHash('sha1').update(m[2]).digest('hex')
    if (!uniq.has(key)) uniq.set(key, { uri: m[2], alt: /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? '' })
  }
  if (uniq.size === 0) return { html, failed: false }
  const items = Array.from(uniq.values())
  const results = new Map<string, string>() // uri → url
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const idx = next++
      try {
        results.set(items[idx].uri, await shopifyUploadImage(domain, token, items[idx].uri, items[idx].alt, idx))
      } catch {
        // ไม่ใส่ใน results = ถือว่าล้มเหลว
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker))
  let failed = false
  const out = html.replace(DATA_IMG_RE, (tag, _q, uri: string) => {
    const url = results.get(uri)
    if (!url) { failed = true; return '' }
    return tag.split(uri).join(url)
  })
  return { html: out, failed }
}

async function shopifyPublish(cfg: NonNullable<SiteConnectionConfig['shopify']>, p: PublishPayload): Promise<PublishResult> {
  const domain = normalizeShopifyDomain(cfg.storeDomain ?? '')
  if (!domain || !cfg.accessToken) return { ok: false, error: 'Shopify ยังตั้งค่าไม่ครบ (domain/token)' }
  const headers = { 'X-Shopify-Access-Token': cfg.accessToken, 'Content-Type': 'application/json' }

  // ไม่ได้เลือก blog ไว้ → ใช้ blog แรกของร้าน
  let blogId = cfg.blogId
  let blogHandle = cfg.blogHandle
  if (!blogId) {
    const blogsRes = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/blogs.json`, {
      headers, signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!blogsRes.ok) return { ok: false, error: `หา Blog ของร้านไม่เจอ — ${await readError(blogsRes)}` }
    const first = ((await blogsRes.json()).blogs ?? [])[0]
    if (!first) return { ok: false, error: 'ร้านนี้ยังไม่มี Blog ใน Shopify — สร้าง Blog ก่อน' }
    blogId = String(first.id)
    blogHandle = first.handle
  }

  // รูปในเนื้อหา (data URI) → อัปโหลดเข้า Shopify Files แล้วแทนด้วย URL
  let warning: string | undefined
  let html = p.html
  try {
    const r = await shopifyReplaceInlineImages(domain, cfg.accessToken, p.html)
    html = r.html
    if (r.failed) warning = SHOPIFY_FILES_WARNING
  } catch {
    html = p.html.replace(DATA_IMG_RE, '')
    warning = SHOPIFY_FILES_WARNING
  }

  const metafields = [
    ...(p.metaTitle ? [{ namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: p.metaTitle }] : []),
    ...(p.metaDescription ? [{ namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: p.metaDescription }] : []),
  ]
  const article: Record<string, unknown> = {
    title: p.title,
    body_html: html,
    published: p.publishMode === 'publish',
    ...(p.slug ? { handle: p.slug } : {}),
    ...(p.excerpt ? { summary_html: `<p>${p.excerpt}</p>` } : {}),
    ...(p.coverBase64 ? { image: { attachment: p.coverBase64, alt: p.coverAlt || p.title } } : {}),
    ...(metafields.length ? { metafields } : {}),
  }
  const base = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blogId}/articles`
  let res: Response | null = null
  if (p.existingId) {
    // push ซ้ำ → แก้บทความเดิม (ถ้าถูกลบไปแล้ว 404 → สร้างใหม่)
    res = await fetch(`${base}/${p.existingId}.json`, {
      method: 'PUT', headers, body: JSON.stringify({ article: { ...article, id: Number(p.existingId) || p.existingId } }), signal: AbortSignal.timeout(60_000),
    })
    if (res.status === 404) res = null
  }
  if (!res) {
    res = await fetch(`${base}.json`, {
      method: 'POST', headers, body: JSON.stringify({ article }), signal: AbortSignal.timeout(60_000),
    })
  }
  if (!res.ok) return { ok: false, error: `ลงบทความ Shopify ไม่สำเร็จ — ${await readError(res)}` }
  const created = (await res.json()).article

  // โดเมนหลักของร้าน (ไม่ใช่ myshopify) — ดึงครั้งเดียว ล้มก็ใช้โดเมนที่ตั้งไว้
  let publicDomain = domain
  try {
    const shopRes = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, { headers, signal: AbortSignal.timeout(TIMEOUT) })
    if (shopRes.ok) publicDomain = (await shopRes.json()).shop?.domain || domain
  } catch { /* ใช้ domain เดิม */ }
  const postUrl = blogHandle && created?.handle
    ? `https://${publicDomain}/blogs/${blogHandle}/${created.handle}`
    : `https://${domain}/admin/blogs/${blogId}/articles/${created?.id ?? ''}`
  return { ok: true, postUrl, postId: String(created?.id ?? ''), ...(warning ? { warning } : {}) }
}

// ── Webflow ───────────────────────────────────────────────────────────────────

const WF = 'https://api.webflow.com/v2'

async function webflowTest(cfg: NonNullable<SiteConnectionConfig['webflow']>): Promise<ConnectionTestResult> {
  if (!cfg.apiToken) return { ok: false, error: 'ต้องใส่ Webflow API token (Site settings › Apps & integrations)' }
  const headers = { Authorization: `Bearer ${cfg.apiToken}` }
  const sitesRes = await fetch(`${WF}/sites`, { headers, signal: AbortSignal.timeout(TIMEOUT) })
  if (!sitesRes.ok) return { ok: false, error: `เชื่อม Webflow ไม่ได้ — ${await readError(sitesRes)}` }
  const sites = (await sitesRes.json()).sites ?? []
  if (sites.length === 0) return { ok: false, error: 'Token นี้ไม่เห็นเว็บไซต์ไหนเลย — เช็คสิทธิ์ของ token' }
  const site = cfg.siteId ? sites.find((s: { id: string }) => s.id === cfg.siteId) ?? sites[0] : sites[0]
  const colRes = await fetch(`${WF}/sites/${site.id}/collections`, { headers, signal: AbortSignal.timeout(TIMEOUT) })
  const collections = colRes.ok ? ((await colRes.json()).collections ?? []) : []
  return {
    ok: true,
    name: site.displayName ?? site.shortName,
    siteId: site.id,
    url: site.customDomains?.[0]?.url ?? (site.shortName ? `https://${site.shortName}.webflow.io` : ''),
    choices: {
      collections: collections.map((c: { id: string; displayName?: string; slug: string }) => ({
        id: c.id, name: c.displayName ?? c.slug, slug: c.slug,
      })),
    },
  }
}

/** หา field ชนิด RichText ใน collection สำหรับใส่เนื้อหา */
async function webflowResolveBodyField(cfg: NonNullable<SiteConnectionConfig['webflow']>): Promise<string | null> {
  if (cfg.bodyField) return cfg.bodyField
  const res = await fetch(`${WF}/collections/${cfg.collectionId}`, {
    headers: { Authorization: `Bearer ${cfg.apiToken}` }, signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) return null
  const fields = (await res.json()).fields ?? []
  const rich = fields.find((f: { type: string; slug: string }) => f.type === 'RichText')
  return rich?.slug ?? null
}

async function webflowPublish(cfg: NonNullable<SiteConnectionConfig['webflow']>, p: PublishPayload): Promise<PublishResult> {
  if (!cfg.apiToken || !cfg.collectionId) return { ok: false, error: 'Webflow ยังตั้งค่าไม่ครบ — ทดสอบการเชื่อมต่อแล้วเลือก Collection ก่อน' }
  const bodyField = await webflowResolveBodyField(cfg)
  if (!bodyField) return { ok: false, error: 'Collection นี้ไม่มี RichText field สำหรับใส่เนื้อหาบทความ' }
  const live = p.publishMode === 'publish'
  const res = await fetch(`${WF}/collections/${cfg.collectionId}/items${live ? '/live' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      isDraft: !live,
      isArchived: false,
      fieldData: {
        name: p.title,
        slug: p.slug || undefined,
        [bodyField]: p.html,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) return { ok: false, error: `ลงบทความ Webflow ไม่สำเร็จ — ${await readError(res)}` }
  const item = await res.json()
  const slug = item?.fieldData?.slug ?? p.slug ?? ''
  const postUrl = cfg.siteUrl && slug ? `${cfg.siteUrl.replace(/\/$/, '')}/${slug}` : ''
  return { ok: true, postUrl, postId: item?.id ?? '' }
}

// ── Wix ───────────────────────────────────────────────────────────────────────

async function wixHeaders(cfg: NonNullable<SiteConnectionConfig['wix']>) {
  return {
    Authorization: cfg.apiKey ?? '',
    'wix-site-id': cfg.siteId ?? '',
    'Content-Type': 'application/json',
  }
}

async function wixTest(cfg: NonNullable<SiteConnectionConfig['wix']>): Promise<ConnectionTestResult> {
  if (!cfg.apiKey || !cfg.siteId) return { ok: false, error: 'ต้องใส่ Wix API Key และ Site ID (จาก wix.com/my-account/api-keys)' }
  const res = await fetch('https://www.wixapis.com/blog/v3/posts?paging.limit=1', {
    headers: await wixHeaders(cfg), signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) return { ok: false, error: `เชื่อม Wix ไม่ได้ — ${await readError(res)}` }
  // รายชื่อผู้เขียน (Member) ให้เลือกเป็น memberId — ดึงไม่ได้ก็ยังถือว่าเชื่อมต่อผ่าน
  let members: Array<{ id: string; name: string }> = []
  try {
    const mRes = await fetch('https://www.wixapis.com/members/v1/members?paging.limit=100&fieldsets=PUBLIC', {
      headers: await wixHeaders(cfg), signal: AbortSignal.timeout(TIMEOUT),
    })
    if (mRes.ok) {
      const list = (await mRes.json()).members ?? []
      members = list.map((m: { id: string; profile?: { nickname?: string }; contact?: { firstName?: string; lastName?: string }; loginEmail?: string }) => ({
        id: m.id,
        name: m.profile?.nickname || [m.contact?.firstName, m.contact?.lastName].filter(Boolean).join(' ') || m.loginEmail || m.id,
      }))
    }
  } catch { /* members = [] */ }
  return { ok: true, name: 'Wix Blog', url: '', choices: { members } }
}

/** อัปโหลดรูปปกเข้า Wix Media Manager → คืน image object สำหรับ draftPost.media */
async function wixUploadCover(cfg: NonNullable<SiteConnectionConfig['wix']>, p: PublishPayload): Promise<Record<string, unknown>> {
  const mime = p.coverMimeType || 'image/jpeg'
  const fileName = `cover-${Date.now()}.${mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`
  const genRes = await fetch('https://www.wixapis.com/site-media/v1/files/generate-upload-url', {
    method: 'POST', headers: await wixHeaders(cfg), body: JSON.stringify({ mimeType: mime, fileName }), signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!genRes.ok) throw new Error(await readError(genRes))
  const uploadUrl = (await genRes.json()).uploadUrl
  if (!uploadUrl) throw new Error('ไม่ได้ uploadUrl')
  const bytes = Buffer.from(p.coverBase64 as string, 'base64')
  const upRes = await fetch(`${uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
    method: 'PUT', headers: { 'Content-Type': mime }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(60_000),
  })
  if (!upRes.ok) throw new Error(await readError(upRes))
  const file = (await upRes.json()).file
  const img = file?.media?.image?.image
  if (img?.id || img?.url) return img
  if (file?.id && file?.url) return { id: file.id, url: file.url }
  throw new Error('Wix ไม่ตอบข้อมูลรูป')
}

async function wixPublish(cfg: NonNullable<SiteConnectionConfig['wix']>, p: PublishPayload): Promise<PublishResult> {
  if (!cfg.apiKey || !cfg.siteId) return { ok: false, error: 'Wix ยังตั้งค่าไม่ครบ (API Key / Site ID)' }
  if (!cfg.memberId) return { ok: false, error: 'Wix ต้องเลือกผู้เขียน (Member ID) — กดทดสอบการเชื่อมต่อแล้วเลือกผู้เขียน' }
  const live = p.publishMode === 'publish'
  const headers = await wixHeaders(cfg)

  let warning: string | undefined
  let media: Record<string, unknown> | undefined
  if (p.coverBase64) {
    try {
      const image = await wixUploadCover(cfg, p)
      media = { wixMedia: { image }, displayed: true, custom: true }
    } catch (e) {
      warning = `อัปโหลดรูปปกเข้า Wix ไม่สำเร็จ — ลงบทความโดยไม่มีรูปปก (${e instanceof Error ? e.message.slice(0, 120) : String(e)})`
    }
  }

  // Wix รับเฉพาะ Ricos — ห่อ HTML ทั้งบทความใน HTML node (แสดงเป็น embed บล็อกเดียว)
  const draftPost: Record<string, unknown> = {
    title: p.title.slice(0, 200),
    ...(p.excerpt ? { excerpt: p.excerpt.slice(0, 500) } : {}),
    memberId: cfg.memberId,
    richContent: {
      nodes: [{
        type: 'HTML',
        id: 'content-article-html',
        htmlData: { html: p.html, source: 'HTML' },
      }],
      metadata: { version: 1 },
    },
    ...(p.slug ? { seoSlug: p.slug } : {}),
    ...(media ? { media } : {}),
    ...(p.metaTitle || p.metaDescription ? {
      seoData: {
        tags: [
          ...(p.metaTitle ? [{ type: 'title', children: p.metaTitle }] : []),
          ...(p.metaDescription ? [{ type: 'meta', props: { name: 'description', content: p.metaDescription } }] : []),
        ],
      },
    } : {}),
  }

  let res: Response | null = null
  if (p.existingId) {
    // push ซ้ำ → แก้ draft เดิม (ถ้าถูกลบไปแล้ว 404 → สร้างใหม่)
    res = await fetch(`https://www.wixapis.com/blog/v3/draft-posts/${encodeURIComponent(p.existingId)}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ draftPost: { id: p.existingId, ...draftPost }, action: live ? 'UPDATE_PUBLISH' : 'UPDATE' }),
      signal: AbortSignal.timeout(60_000),
    })
    if (res.status === 404) res = null
  }
  if (!res) {
    res = await fetch('https://www.wixapis.com/blog/v3/draft-posts', {
      method: 'POST', headers, body: JSON.stringify({ draftPost, publish: live, fieldsets: ['URL'] }), signal: AbortSignal.timeout(60_000),
    })
  }
  if (!res.ok) return { ok: false, error: `ลงบทความ Wix ไม่สำเร็จ — ${await readError(res)}` }
  const json = await res.json().catch(() => ({}))
  const postId: string = json?.draftPost?.id ?? p.existingId ?? ''

  // URL ของโพสต์ที่เผยแพร่แล้ว — ดึงไม่ได้ก็คืนว่าง
  let postUrl = ''
  if (live && postId) {
    try {
      const pRes = await fetch(`https://www.wixapis.com/blog/v3/posts/${encodeURIComponent(postId)}?fieldsets=URL`, {
        headers, signal: AbortSignal.timeout(TIMEOUT),
      })
      if (pRes.ok) {
        const u = (await pRes.json()).post?.url
        postUrl = typeof u === 'string' ? u : u?.base && u?.path ? `${String(u.base).replace(/\/$/, '')}${u.path}` : ''
      }
    } catch { /* postUrl ว่าง */ }
  }
  return { ok: true, postId, postUrl, ...(warning ? { warning } : {}) }
}

// ── Custom webhook ────────────────────────────────────────────────────────────

async function customHeaders(cfg: NonNullable<SiteConnectionConfig['custom']>) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'ContentPublisher/1.0',
    ...(cfg.secret ? { 'X-Content-Secret': cfg.secret } : {}),
  }
}

async function customTest(cfg: NonNullable<SiteConnectionConfig['custom']>): Promise<ConnectionTestResult> {
  if (!cfg.webhookUrl) return { ok: false, error: 'ต้องใส่ Webhook URL ของระบบเว็บลูกค้า' }
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST', headers: await customHeaders(cfg),
    body: JSON.stringify({ event: 'ping', source: 'content-publisher' }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) return { ok: false, error: `Webhook ตอบ ${await readError(res)}` }
  return { ok: true, name: 'Custom Webhook', url: cfg.webhookUrl }
}

async function customPublish(cfg: NonNullable<SiteConnectionConfig['custom']>, p: PublishPayload): Promise<PublishResult> {
  if (!cfg.webhookUrl) return { ok: false, error: 'ยังไม่ได้ตั้ง Webhook URL' }
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST', headers: await customHeaders(cfg),
    body: JSON.stringify({
      event: 'article.publish',
      title: p.title, slug: p.slug ?? '', html: p.html, excerpt: p.excerpt ?? '',
      coverImageBase64: p.coverBase64 ?? '', coverMimeType: p.coverMimeType ?? '',
      publishMode: p.publishMode,
      ...(p.existingId ? { existingId: p.existingId } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) return { ok: false, error: `Webhook ตอบ ${await readError(res)}` }
  const data = await res.json().catch(() => ({}))
  return { ok: true, postUrl: data.url ?? data.postUrl ?? '', postId: String(data.id ?? data.postId ?? '') }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function testSiteConnection(platform: SitePlatform, conn: SiteConnectionConfig): Promise<ConnectionTestResult> {
  try {
    if (platform === 'shopify') return await shopifyTest(conn.shopify ?? {})
    if (platform === 'webflow') return await webflowTest(conn.webflow ?? {})
    if (platform === 'wix') return await wixTest(conn.wix ?? {})
    if (platform === 'custom') return await customTest(conn.custom ?? {})
    return { ok: false, error: `ไม่รู้จักแพลตฟอร์ม: ${platform}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function publishToSite(platform: SitePlatform, conn: SiteConnectionConfig, payload: PublishPayload): Promise<PublishResult> {
  try {
    if (platform === 'shopify') return await shopifyPublish(conn.shopify ?? {}, payload)
    if (platform === 'webflow') return await webflowPublish(conn.webflow ?? {}, payload)
    if (platform === 'wix') return await wixPublish(conn.wix ?? {}, payload)
    if (platform === 'custom') return await customPublish(conn.custom ?? {}, payload)
    return { ok: false, error: `ไม่รู้จักแพลตฟอร์ม: ${platform}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
