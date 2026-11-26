// ─── Upload Article — push ไปส่วนภาษา (/th, /en) บน Wix / Webflow / custom webhook ──
// pure module (ไม่แตะ prisma/session) · ใช้ global fetch กับ host ตายตัว (wixapis.com / api.webflow.com)
// กฎ: preflight อ่านอย่างเดียวก่อน (fail closed) · ไม่ทับโพสต์ที่ไม่ใช่ภาษานี้ · วาง Draft → อ่านกลับยืนยันภาษา → ค่อยเผยแพร่

import { publishToSite, wixHeaders, type PublishPayload, type PublishResult, type SiteConnectionConfig } from '../sitePublishers'
import { pushArticleToWebflow, type WebflowPushInput, type WebflowUploadConfig } from './webflow-push'

export interface PlatformLangRecord { lang: string; mode: 'platform'; postId?: string }
export type PlatformLangResult = PublishResult & { langRecord?: PlatformLangRecord; status?: 'draft' | 'publish' }

type WixCfg = NonNullable<SiteConnectionConfig['wix']>
type CustomCfg = SiteConnectionConfig

const WIX = 'https://www.wixapis.com'
const TIMEOUT = 20_000

const sameLang = (a: unknown, lang: string) =>
  typeof a === 'string' && a.split(/[-_]/)[0].toLowerCase() === lang.split(/[-_]/)[0].toLowerCase()

export async function pushWixLang(
  cfg: WixCfg,
  payload: PublishPayload,
  opts: { lang: string; existingId?: string },
): Promise<PlatformLangResult> {
  const { lang } = opts
  try {
    const headers = await wixHeaders(cfg)
    // 1. preflight (read-only, fail closed)
    const pre = await fetch(`${WIX}/site-properties/v4/properties`, { headers, signal: AbortSignal.timeout(TIMEOUT) })
    if (!pre.ok) {
      return { ok: false, error: `ตรวจภาษาของเว็บ Wix ไม่ได้ (HTTP ${pre.status}) — API Key ต้องมีสิทธิ์อ่าน Site Properties จึงจะ push ไปส่วนภาษาได้` }
    }
    const pj = await pre.json().catch(() => null) as {
      properties?: { language?: string; multilingual?: { supportedLanguages?: { languageCode?: string; isPrimary?: boolean; resolutionMethod?: string }[] } }
    } | null
    const supported = pj?.properties?.multilingual?.supportedLanguages
    if (!pj || !pj.properties || !Array.isArray(supported)) {
      return { ok: false, error: 'ตรวจภาษาของเว็บ Wix ไม่ได้ (ข้อมูลไม่ครบ) — ไม่ push' }
    }
    const entry = supported.find(l => sameLang(l.languageCode, lang))
    if (!entry) {
      return { ok: false, error: `เว็บ Wix นี้ยังไม่มีภาษา /${lang} — ติดตั้ง Wix Multilingual และเพิ่มภาษานี้ก่อน หรือเลือกปลายทาง «ปกติ»` }
    }
    if (entry.isPrimary || (sameLang(pj.properties.language, lang) && supported.length <= 1)) {
      return { ok: false, error: `ภาษา ${lang} เป็นภาษาหลักของเว็บ Wix นี้ — เลือกปลายทาง «ปกติ»` }
    }
    const resolutionMethod = entry.resolutionMethod

    let id = ''
    let warning: string | undefined
    let status: 'draft' | 'publish' = payload.publishMode

    // 2. existing id: read first, refuse when language mismatches
    let reuse = ''
    if (opts.existingId) {
      const g = await fetch(`${WIX}/blog/v3/draft-posts/${encodeURIComponent(opts.existingId)}`, { headers, signal: AbortSignal.timeout(TIMEOUT) })
      if (g.status !== 404) {
        if (!g.ok) return { ok: false, error: `อ่านโพสต์ ID ${opts.existingId} บน Wix ไม่สำเร็จ (HTTP ${g.status}) — ไม่ push ทับ` }
        const gj = await g.json().catch(() => ({})) as { draftPost?: { language?: string } }
        const got = gj?.draftPost?.language
        if (!sameLang(got, lang)) {
          return { ok: false, error: `โพสต์ ID ${opts.existingId} บน Wix เป็นภาษา «${got || 'ไม่ระบุ'}» ไม่ใช่ /${lang} — ไม่ push ทับ` }
        }
        reuse = opts.existingId
      }
    }

    if (reuse) {
      const r = await publishToSite('wix', { wix: cfg }, { ...payload, existingId: reuse, strictExisting: true, language: undefined })
      if (!r.ok) return { ok: false, error: r.error }
      id = r.postId || reuse
      warning = r.warning
    } else {
      // 3. create as draft, read back, then publish
      const c = await publishToSite('wix', { wix: cfg }, { ...payload, existingId: undefined, language: lang, publishMode: 'draft' })
      if (!c.ok) return { ok: false, error: c.error }
      id = c.postId || ''
      warning = c.warning
      const stuck = (why: string) => ({ ok: false as const, error: `${why} — Draft ID ${id} ค้างบนเว็บ ลบในหน้า Wix ได้เลย ระบบไม่เผยแพร่` })
      if (!id) return { ok: false, error: 'Wix ไม่ส่ง ID ของโพสต์กลับมา — ระบบไม่เผยแพร่ ตรวจ Draft ในหน้า Wix' }
      const rb = await fetch(`${WIX}/blog/v3/draft-posts/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(TIMEOUT) })
      if (!rb.ok) return stuck(`อ่านโพสต์กลับจาก Wix ไม่ได้เพื่อยืนยันภาษา (HTTP ${rb.status})`)
      const rj = await rb.json().catch(() => ({})) as { draftPost?: { language?: string } }
      const got = rj?.draftPost?.language
      if (!sameLang(got, lang)) return stuck(`Wix ไม่รับภาษา /${lang} ให้โพสต์นี้ (ได้ «${got || 'ไม่ระบุ'}»)`)
      const record: PlatformLangRecord = { lang, mode: 'platform', postId: id }
      status = 'draft'
      if (payload.publishMode === 'publish') {
        const pub = await fetch(`${WIX}/blog/v3/draft-posts/${encodeURIComponent(id)}/publish`, {
          method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(60_000),
        })
        if (!pub.ok) {
          return {
            ok: false, postId: id, status: 'draft', langRecord: record,
            error: `วาง Draft ภาษา /${lang} บน Wix แล้ว (ID ${id}) แต่เผยแพร่ไม่สำเร็จ — HTTP ${pub.status}`,
          }
        }
        status = 'publish'
      }
    }

    // 4. URL (best effort) + subdirectory check
    let postUrl = ''
    if (status === 'publish' && id) {
      try {
        const pRes = await fetch(`${WIX}/blog/v3/posts/${encodeURIComponent(id)}?fieldsets=URL`, { headers, signal: AbortSignal.timeout(TIMEOUT) })
        if (pRes.ok) {
          const u = (await pRes.json()).post?.url
          postUrl = typeof u === 'string' ? u : u?.base && u?.path ? `${String(u.base).replace(/\/$/, '')}${u.path}` : ''
        }
      } catch { /* postUrl ว่าง */ }
    }
    if (postUrl && resolutionMethod === 'SUBDIRECTORY' && !underLang(postUrl, lang)) {
      warning = [warning, `Wix ตอบ URL ${postUrl} ซึ่งไม่อยู่ใต้ /${lang} — ตรวจในหน้า Wix`].filter(Boolean).join(' · ')
    }
    return { ok: true, postId: id, postUrl, ...(warning ? { warning } : {}), status, langRecord: { lang, mode: 'platform', postId: id } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function underLang(url: string, lang: string): boolean {
  try {
    const p = new URL(url).pathname
    return p === `/${lang}` || p.startsWith(`/${lang}/`)
  } catch { return false }
}

export async function pushWebflowLang(
  cfg: WebflowUploadConfig,
  input: WebflowPushInput,
  opts: { lang: string },
): Promise<PlatformLangResult> {
  const r = await pushArticleToWebflow(cfg, { ...input, lang: opts.lang })
  const rec: PlatformLangRecord | undefined = r.itemId && r.verified
    ? { lang: opts.lang, mode: 'platform', postId: r.itemId }
    : undefined
  return {
    ok: r.ok, postId: r.itemId, postUrl: r.postUrl, error: r.error, warning: r.warning, status: r.status,
    ...(rec ? { langRecord: rec } : {}),
  }
}

export async function customLangPublish(
  conn: CustomCfg,
  payload: PublishPayload,
  opts: { lang: string },
): Promise<PlatformLangResult> {
  const { lang } = opts
  const r = await publishToSite('custom', conn, { ...payload, language: lang, pathPrefix: `/${lang}` })
  if (!r.ok) return { ok: false, error: r.error }
  // Fail closed: a receiver that ignores language/pathPrefix puts the article on the primary site. Only a reply
  // that echoes the language, or a URL under /lang, counts as confirmed; otherwise nothing is recorded.
  const echoed = sameLang(r.language, lang)
  const urlUnder = !!r.postUrl && underLang(r.postUrl, lang)
  if (!echoed && !urlUnder) {
    const where = r.postUrl ? `ตอบ URL ${r.postUrl} ซึ่งไม่อยู่ใต้ /${lang}` : 'ไม่ตอบ URL'
    return {
      ok: false,
      error: `webhook ${where} และไม่ตอบ language: "${lang}" กลับมา — ระบบไม่ถือว่าบทความอยู่ใต้ /${lang} และไม่ผูกโพสต์${r.postId ? ` ID ${r.postId}` : ''} กับบทความ ตรวจที่เว็บว่าบทความไปลงที่ไหน (อาจลงเว็บภาษาหลัก) แล้วให้ระบบปลายทางอ่าน language / pathPrefix และตอบ language หรือ url กลับมาก่อน push ใหม่`,
    }
  }
  let warning = r.warning
  const add = (w: string) => { warning = [warning, w].filter(Boolean).join(' · ') }
  if (!r.postUrl) add(`webhook ยืนยัน language แล้วแต่ไม่ตอบ URL — ตรวจลิงก์ในเว็บเอง`)
  else if (!urlUnder) add(`webhook ยืนยัน language แล้วแต่ตอบ URL ${r.postUrl} ซึ่งไม่อยู่ใต้ /${lang} — ตรวจในเว็บ`)
  return {
    ok: true, postId: r.postId || undefined, postUrl: r.postUrl, ...(warning ? { warning } : {}),
    status: payload.publishMode,
    langRecord: { lang, mode: 'platform', postId: r.postId || undefined },
  }
}
