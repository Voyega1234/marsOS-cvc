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
  error?: string
  /** ตัวเลือกให้ผู้ใช้เลือกต่อ (Shopify: blog / Webflow: collection) */
  choices?: {
    blogs?: Array<{ id: string; title: string; handle: string }>
    collections?: Array<{ id: string; name: string; slug: string }>
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
}

export interface PublishResult {
  ok: boolean
  postUrl?: string
  postId?: string
  error?: string
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

  const article: Record<string, unknown> = {
    title: p.title,
    body_html: p.html,
    published: p.publishMode === 'publish',
    ...(p.slug ? { handle: p.slug } : {}),
    ...(p.excerpt ? { summary_html: `<p>${p.excerpt}</p>` } : {}),
    ...(p.coverBase64 ? { image: { attachment: p.coverBase64, alt: p.title } } : {}),
  }
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blogId}/articles.json`, {
    method: 'POST', headers, body: JSON.stringify({ article }), signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) return { ok: false, error: `ลงบทความ Shopify ไม่สำเร็จ — ${await readError(res)}` }
  const created = (await res.json()).article
  const postUrl = blogHandle && created?.handle
    ? `https://${domain}/blogs/${blogHandle}/${created.handle}`
    : `https://${domain}/admin/blogs/${blogId}/articles/${created?.id ?? ''}`
  return { ok: true, postUrl, postId: String(created?.id ?? '') }
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
  return { ok: true, name: 'Wix Blog', url: '' }
}

async function wixPublish(cfg: NonNullable<SiteConnectionConfig['wix']>, p: PublishPayload): Promise<PublishResult> {
  if (!cfg.apiKey || !cfg.siteId) return { ok: false, error: 'Wix ยังตั้งค่าไม่ครบ (API Key / Site ID)' }
  // Wix รับเฉพาะ Ricos — ห่อ HTML ทั้งบทความใน HTML node (แสดงเป็น embed บล็อกเดียว)
  const body = {
    draftPost: {
      title: p.title.slice(0, 200),
      ...(p.excerpt ? { excerpt: p.excerpt.slice(0, 500) } : {}),
      ...(cfg.memberId ? { memberId: cfg.memberId } : {}),
      richContent: {
        nodes: [{
          type: 'HTML',
          id: 'content-article-html',
          htmlData: { html: p.html, source: 'HTML' },
        }],
        metadata: { version: 1 },
      },
    },
    ...(p.publishMode === 'publish' ? { publish: true } : {}),
  }
  const res = await fetch('https://www.wixapis.com/blog/v3/draft-posts', {
    method: 'POST', headers: await wixHeaders(cfg), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) return { ok: false, error: `ลงบทความ Wix ไม่สำเร็จ — ${await readError(res)}` }
  const draft = (await res.json()).draftPost
  return { ok: true, postId: draft?.id ?? '', postUrl: '' }
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
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) return { ok: false, error: `Webhook ตอบ ${await readError(res)}` }
  const data = await res.json().catch(() => ({}))
  return { ok: true, postUrl: data.url ?? data.postUrl ?? '', postId: String(data.id ?? '') }
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
