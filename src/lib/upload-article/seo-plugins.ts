// ─── ปลั๊กอิน SEO บน WordPress — ตรวจว่าเว็บใช้ตัวไหน + ส่ง SEO title/description ไปช่องของตัวนั้น ───
// Yoast ส่งแบบเดิมใน wp-push / push/publish (meta _yoast_wpseo_* + ปลั๊กอิน convert-cake) — ไฟล์นี้ไม่แตะ Yoast
// ช่องที่ใช้ตรวจจากซอร์สปลั๊กอินจริง (2026-10-29): AIOSEO 5.0.4, Rank Math 1.0.280, SEOPress 10.3, Slim SEO
// ไฟล์นี้ไม่ import ของฝั่งเซิร์ฟเวอร์ — หน้า UI ใช้ label/note ได้

export type SeoPluginKey = 'yoast' | 'rankmath' | 'aioseo' | 'seopress' | 'slimseo' | 'tsf' | 'squirrly' | 'smartcrawl'

interface SeoPluginDef {
  key: SeoPluginKey
  label: string
  /** namespace ใน /wp-json/ ที่ปลั๊กอินลงทะเบียน */
  namespace?: string
  /** ร่องรอยใน HTML หน้าเว็บ (คอมเมนต์ / meta generator ที่ปลั๊กอินพิมพ์ใน <head>) */
  html?: RegExp
  /** โฟลเดอร์ปลั๊กอิน /wp-content/plugins/<slug>/ */
  slugs: string[]
  /** รับ title/description ผ่าน REST ได้ */
  writable: boolean
}

export const SEO_PLUGINS: SeoPluginDef[] = [
  { key: 'yoast', label: 'Yoast SEO', namespace: 'yoast/v1', html: /<!--\s*This site is optimized with the Yoast SEO/i, slugs: ['wordpress-seo', 'wordpress-seo-premium'], writable: true },
  { key: 'rankmath', label: 'Rank Math', namespace: 'rankmath/v1', html: /Search Engine Optimization by Rank Math/i, slugs: ['seo-by-rank-math', 'seo-by-rank-math-pro'], writable: true },
  { key: 'aioseo', label: 'All in One SEO (AIOSEO)', namespace: 'aioseo/v1', html: /<!--\s*All in One SEO|name="generator"[^>]+content="All in One SEO/i, slugs: ['all-in-one-seo-pack', 'all-in-one-seo-pack-pro'], writable: true },
  { key: 'seopress', label: 'SEOPress', namespace: 'seopress/v1', slugs: ['wp-seopress', 'wp-seopress-pro'], writable: true },
  { key: 'slimseo', label: 'Slim SEO', namespace: 'slim-seo', slugs: ['slim-seo'], writable: true },
  { key: 'tsf', label: 'The SEO Framework', html: /<!--\s*The SEO Framework/i, slugs: ['autodescription'], writable: false },
  { key: 'squirrly', label: 'Squirrly SEO', slugs: ['squirrly-seo'], writable: false },
  { key: 'smartcrawl', label: 'SmartCrawl', slugs: ['smartcrawl-seo', 'wpmu-dev-seo'], writable: false },
]

const BY_KEY = new Map(SEO_PLUGINS.map((p) => [p.key, p]))

export function isSeoPluginKey(v: unknown): v is SeoPluginKey {
  return typeof v === 'string' && BY_KEY.has(v as SeoPluginKey)
}

export function seoPluginLabel(key: SeoPluginKey): string {
  return BY_KEY.get(key)?.label ?? key
}

function ordered(keys: Iterable<SeoPluginKey>): SeoPluginKey[] {
  const set = new Set(keys)
  return SEO_PLUGINS.filter((p) => set.has(p.key)).map((p) => p.key)
}

/** ตรวจจาก HTML หน้าเว็บ — คอมเมนต์ใน <head> + โฟลเดอร์ปลั๊กอินที่โหลดไฟล์ */
export function detectSeoPluginsFromHtml(html: string): SeoPluginKey[] {
  const slugs = new Set(Array.from(html.matchAll(/\/wp-content\/plugins\/([a-z0-9_.-]+)\//gi), (m) => m[1].toLowerCase()))
  return ordered(SEO_PLUGINS.filter((p) => p.html?.test(html) || p.slugs.some((s) => slugs.has(s))).map((p) => p.key))
}

/** ตรวจจาก namespaces ของ /wp-json/ — แม่นสุด (ปลั๊กอินที่เปิดใช้อยู่จริงเท่านั้นที่ลงทะเบียน) */
export function detectSeoPluginsFromNamespaces(namespaces: unknown): SeoPluginKey[] {
  if (!Array.isArray(namespaces)) return []
  const ns = new Set(namespaces.filter((n): n is string => typeof n === 'string'))
  return ordered(SEO_PLUGINS.filter((p) => p.namespace && ns.has(p.namespace)).map((p) => p.key))
}

/** สรุปให้ทีมอ่าน: title/description จะไปลงช่องไหน */
export function seoPluginNote(keys: SeoPluginKey[] | undefined): { text: string; warn: boolean } {
  const list = ordered(keys ?? [])
  if (!list.length) return { text: 'ไม่เจอปลั๊กอิน SEO — ส่ง title/description แบบ Yoast + ใส่คำอธิบายเป็น excerpt (เหมือนเดิม)', warn: false }
  const writable = list.filter((k) => BY_KEY.get(k)?.writable)
  const manual = list.filter((k) => !BY_KEY.get(k)?.writable)
  const parts: string[] = []
  if (writable.length) parts.push(`ส่ง SEO title/description ไปช่องของ ${writable.map(seoPluginLabel).join(' + ')}`)
  if (manual.length) parts.push(`${manual.map(seoPluginLabel).join(' + ')} รับค่าผ่าน REST ไม่ได้ — กรอก title/description เองในหลังบ้าน (คำอธิบายใส่เป็น excerpt ให้แล้ว)`)
  return { text: parts.join(' · '), warn: manual.length > 0 && !writable.length }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** อ่าน namespaces ของ /wp-json/ — null = อ่านไม่ได้ (REST ปิด/บล็อก) */
export async function fetchWpSeoPlugins(wpUrl: string, fetcher: Fetcher): Promise<SeoPluginKey[] | null> {
  try {
    const res = await fetcher(`${wpUrl}/wp-json/?_fields=namespaces`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { namespaces?: unknown } | null
    return Array.isArray(body?.namespaces) ? detectSeoPluginsFromNamespaces(body.namespaces) : null
  } catch {
    return null
  }
}

export interface SeoSyncInput {
  wpUrl: string
  /** base64 ของ user:application-password */
  creds: string
  postId: number
  isPage: boolean
  title?: string | null
  description?: string | null
  /** response ของ REST ตอนสร้าง/อัปเดตโพสต์ — ใช้ดูร่องรอยปลั๊กอิน (aioseo_meta_data, meta.slim_seo) */
  post?: unknown
  /** ผลสแกนเว็บที่เก็บไว้ — ใช้เมื่ออ่าน /wp-json/ ไม่ได้ */
  hint?: unknown
  fetcher: Fetcher
}

export interface SeoSyncResult {
  plugins: SeoPluginKey[]
  written: SeoPluginKey[]
  warning?: string
}

function hintsFromPost(post: unknown): SeoPluginKey[] {
  if (!post || typeof post !== 'object') return []
  const p = post as Record<string, unknown>
  const out: SeoPluginKey[] = []
  if ('aioseo_meta_data' in p) out.push('aioseo')
  if ('yoast_head_json' in p) out.push('yoast')
  const meta = p.meta
  if (meta && typeof meta === 'object' && 'slim_seo' in meta) out.push('slimseo')
  return out
}

/**
 * ส่ง SEO title/description ไปปลั๊กอินที่เว็บใช้ (นอกจาก Yoast) — คำขอแยกหลังโพสต์บันทึกแล้วเสมอ
 * (AIOSEO ปฏิเสธทั้งคำขอถ้าผู้ใช้ไม่มีสิทธิ์ SEO — ห้ามปนกับคำขอสร้างโพสต์)
 * ไม่เจอปลั๊กอินพวกนี้ = ไม่ยิงอะไรเพิ่ม (เว็บเดิมทำงานเหมือนเดิม) · ล้ม = คืน warning ไม่ทำให้ push ล้ม
 */
export async function syncSeoPluginMeta(input: SeoSyncInput): Promise<SeoSyncResult> {
  const title = (input.title ?? '').trim()
  const description = (input.description ?? '').trim().slice(0, 160)
  const fromNs = await fetchWpSeoPlugins(input.wpUrl, input.fetcher)
  const fromHint = fromNs === null && Array.isArray(input.hint) ? input.hint.filter(isSeoPluginKey) : []
  const plugins = ordered([...(fromNs ?? []), ...fromHint, ...hintsFromPost(input.post)])
  const result: SeoSyncResult = { plugins, written: [] }
  if (!title && !description) return result

  const auth = { Authorization: `Basic ${input.creds}`, 'Content-Type': 'application/json' }
  const postEndpoint = `${input.wpUrl}/wp-json/wp/v2/${input.isPage ? 'pages' : 'posts'}/${input.postId}`
  const send = async (url: string, method: string, body: unknown): Promise<string | null> => {
    try {
      const res = await input.fetcher(url, { method, headers: auth, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
      return res.ok ? null : `HTTP ${res.status}`
    } catch (e) {
      return e instanceof Error ? e.message.slice(0, 80) : 'เชื่อมต่อไม่ได้'
    }
  }
  // ส่งเฉพาะช่องที่มีค่า — ค่าว่างใน Rank Math / SEOPress = ลบค่าเดิมทิ้ง
  const fields = { ...(title && { title }), ...(description && { description }) }

  const writers: Partial<Record<SeoPluginKey, () => Promise<string | null>>> = {
    // AIOSEO: field aioseo_meta_data ของ wp/v2 (array_replace กับค่าเดิม — ช่องอื่นไม่หาย)
    aioseo: () => send(postEndpoint, 'POST', { aioseo_meta_data: fields }),
    // Rank Math: rankmath/v1/updateMeta (หน้าเพจก็ objectType 'post')
    rankmath: () => send(`${input.wpUrl}/wp-json/rankmath/v1/updateMeta`, 'POST', {
      objectType: 'post',
      objectID: input.postId,
      meta: { ...(title && { rank_math_title: title }), ...(description && { rank_math_description: description }) },
    }),
    // SEOPress: PUT seopress/v1/posts/{id}/title-description-metas (ใช้ได้ทั้งโพสต์และเพจ)
    seopress: () => send(`${input.wpUrl}/wp-json/seopress/v1/posts/${input.postId}/title-description-metas`, 'PUT', fields),
    // Slim SEO: meta slim_seo เป็น object ก้อนเดียว — อ่านของเดิมก่อน ไม่งั้น canonical/noindex หาย
    slimseo: async () => {
      try {
        const res = await input.fetcher(`${postEndpoint}?context=edit&_fields=meta`, { headers: { Authorization: auth.Authorization }, signal: AbortSignal.timeout(15000) })
        if (!res.ok) return `อ่านค่าเดิมไม่ได้ HTTP ${res.status}`
        const cur = ((await res.json().catch(() => null)) as { meta?: { slim_seo?: unknown } } | null)?.meta?.slim_seo
        const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}
        return send(postEndpoint, 'POST', { meta: { slim_seo: { ...base, ...fields } } })
      } catch (e) {
        return e instanceof Error ? e.message.slice(0, 80) : 'เชื่อมต่อไม่ได้'
      }
    },
  }

  const failed: string[] = []
  for (const key of plugins) {
    const write = writers[key]
    if (!write) continue
    const err = await write()
    if (err) failed.push(`${seoPluginLabel(key)} (${err})`)
    else result.written.push(key)
  }

  const warnings: string[] = []
  if (failed.length) warnings.push(`ส่ง SEO title/description ไป ${failed.join(', ')} ไม่สำเร็จ — กรอกเองในหลังบ้าน WordPress`)
  const manual = plugins.filter((k) => !BY_KEY.get(k)?.writable)
  if (manual.length && !plugins.some((k) => BY_KEY.get(k)?.writable)) {
    warnings.push(`เว็บใช้ ${manual.map(seoPluginLabel).join(' + ')} ซึ่งรับ SEO title/description ทาง REST ไม่ได้ — กรอกเองในหลังบ้าน (คำอธิบายใส่เป็น excerpt ให้แล้ว)`)
  }
  if (warnings.length) result.warning = warnings.join(' · ')
  return result
}
