// ─── Upload Article — push ขึ้นส่วนภาษา (/th, /en) ของเว็บ WordPress ─────────────
// หลักการ: ทุกอย่างต้อง fail safe — วาง Draft ก่อน, ให้เว็บยืนยันเองว่าโพสต์อยู่ใต้ /lang จริง แล้วค่อย publish
// ไม่ทับโพสต์เดิม ไม่ยก Draft ที่ตรวจไม่ผ่านขึ้นเว็บ · คำขอของไฟล์นี้เองเป็น GET อ่านอย่างเดียวและไม่ตาม redirect

import { safeFetch } from './safe-fetch'
import { normalizeWpUrl, pushArticleToWordPress, type WpPushInput, type WpPushResult } from './wp-push'

export const PUSH_LANG_PATHS = ['th', 'en'] as const
export type PushLangPath = (typeof PUSH_LANG_PATHS)[number]
export type PushLangMode = 'base' | 'query'

export interface PushLangRecord {
  lang: string
  mode: PushLangMode
  /** the post the site confirmed under /lang — the only post a later push may write to */
  postId?: number
}

export interface PushLangDraft extends PushLangRecord {
  postId: number
}

export function readPushLangPath(value: unknown): '' | PushLangPath {
  return typeof value === 'string' && (PUSH_LANG_PATHS as readonly string[]).includes(value) ? (value as PushLangPath) : ''
}

/** URL อยู่ใต้ /lang ของเว็บนี้จริงไหม — host ต้องตรง และ path ต้องเป็น <sitePath>/<lang> หรือลึกกว่านั้น */
export function isUnderLangPath(urlText: string, siteUrl: string, lang: string): boolean {
  try {
    if (typeof urlText !== 'string' || !urlText) return false
    const u = new URL(urlText)
    const s = new URL(siteUrl)
    if (u.host !== s.host) return false
    const sitePath = s.pathname.replace(/\/+$/, '')
    const base = `${sitePath}/${lang}`
    return u.pathname === base || u.pathname.startsWith(`${base}/`)
  } catch {
    return false
  }
}

export type LangFetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface PushLangOptions {
  lang: PushLangPath
  pushed?: PushLangRecord | null
  strandedDraft?: PushLangDraft | null
  fetcher?: LangFetcher
  push?: typeof pushArticleToWordPress
}

export type PushLangResult = WpPushResult & { langRecord?: PushLangRecord; strandedDraft?: PushLangDraft }

interface PostInfo {
  id?: number
  guid?: { raw?: string; rendered?: string }
  slug?: string
  link?: string
  permalink_template?: string
  status?: string
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function hasWpV2(json: unknown): boolean {
  return isObj(json) && Array.isArray(json.namespaces) && (json.namespaces as unknown[]).includes('wp/v2')
}

export async function pushArticleToWordPressLang(input: WpPushInput, opts: PushLangOptions): Promise<PushLangResult> {
  const lang = opts.lang
  const push = opts.push ?? pushArticleToWordPress
  const fetcher: LangFetcher = opts.fetcher ?? ((u, i) => safeFetch(u, i, { requireHttps: true, sameHostOnly: true, noRedirect: true }))
  const root = normalizeWpUrl(input.wpUrl)
  const wpUser = input.wpUser.trim()
  const wpPass = input.wpPass
  if (!root || !wpUser || !wpPass) return { ok: false, error: 'ไม่พบ WordPress credentials' }

  if (opts.pushed && opts.pushed.lang !== lang) {
    return { ok: false, error: `บทความนี้ push ไว้ที่ /${opts.pushed.lang} แล้ว — เปลี่ยนปลายทางไม่ได้หลัง push ครั้งแรก` }
  }
  const stranded = opts.strandedDraft && opts.strandedDraft.lang === lang ? opts.strandedDraft : null
  const pushed = opts.pushed ?? null

  const creds = Buffer.from(`${wpUser}:${wpPass.replace(/\s+/g, '')}`).toString('base64')
  const type = input.wpPostType === 'page' ? 'pages' : 'posts'

  /** GET อ่านอย่างเดียว — 3xx ถือว่าล้ม (ไม่ตาม) · error เครือข่าย = null */
  const get = async (url: string): Promise<{ status: number; json: unknown } | null> => {
    try {
      const res = await fetcher(url, { method: 'GET', headers: { Authorization: `Basic ${creds}` }, signal: AbortSignal.timeout(10000) })
      let json: unknown = null
      if (res.status === 200) json = await res.json().catch(() => null)
      else await res.body?.cancel().catch(() => {})
      return { status: res.status, json }
    } catch {
      return null
    }
  }

  // ── โหมดปลายทาง: ใช้ค่าที่เคยยืนยันแล้ว ไม่งั้นตรวจก่อนสร้างอะไร ──
  let mode: PushLangMode
  const record = pushed ?? stranded
  if (record) {
    mode = record.mode
  } else {
    const a = await get(`${root}/wp-json/?_fields=namespaces,home,url`)
    if (!a || a.status !== 200 || !hasWpV2(a.json)) {
      return { ok: false, error: 'อ่าน WordPress REST API ของเว็บไม่ได้ (/wp-json/) — ยังไม่ได้เขียนอะไรขึ้นเว็บ ตรวจ URL และปลั๊กอินความปลอดภัยที่อาจบล็อก REST' }
    }
    const b = await get(`${root}/${lang}/wp-json/?_fields=namespaces,home,url,name`)
    if (b && b.status === 200 && hasWpV2(b.json)) {
      mode = 'base'
    } else {
      const ns = (a.json as { namespaces: unknown[] }).namespaces
      if (ns.some((n) => typeof n === 'string' && n.startsWith('pll/'))) {
        mode = 'query'
        const langs = await get(`${root}/wp-json/pll/v1/languages`)
        if (langs && langs.status === 200 && Array.isArray(langs.json)) {
          const entry = (langs.json as Array<Record<string, unknown>>).find((l) => isObj(l) && l.slug === lang)
          if (!entry) {
            return { ok: false, error: `เว็บนี้ยังไม่ได้เพิ่มภาษา ${lang} ใน Polylang — ยังไม่ได้เขียนอะไรขึ้นเว็บ เพิ่มภาษานี้ในเว็บก่อน` }
          }
          if (typeof entry.home_url === 'string' && entry.home_url && !isUnderLangPath(entry.home_url, root, lang)) {
            return { ok: false, error: `ภาษา ${lang} ของเว็บนี้ไม่ได้อยู่ใต้ /${lang} (หน้าแรกภาษานี้คือ ${entry.home_url}) — ยังไม่ได้เขียนอะไรขึ้นเว็บ` }
          }
        }
        // อ่านรายการภาษาไม่ได้ = ไปต่อ ให้การตรวจหลังสร้าง (Draft) ตัดสิน
      } else {
        return {
          ok: false,
          error: `ไม่พบส่วน /${lang} ที่เป็นเว็บแยกภาษาผ่าน WordPress REST API ของเว็บนี้ — ยังไม่ได้เขียนอะไรขึ้นเว็บ สาเหตุที่เป็นไปได้: เว็บใช้ปลั๊กอินแปลสดอย่าง TranslatePress / Weglot / GTranslate (ไม่ได้เก็บโพสต์แยกตามภาษา) หรือ /${lang} เป็นหมวดหมู่/หน้าแม่ซึ่งยังไม่รองรับ`,
        }
      }
    }
  }
  const base = mode === 'base' ? `${root}/${lang}` : root
  const postsQuery = `lang=${lang}`

  const readPostAt = async (baseUrl: string, id: number, withLang: boolean): Promise<{ status: number; post?: PostInfo } | null> => {
    const r = await get(`${baseUrl}/wp-json/wp/v2/${type}/${id}?context=edit&_fields=id,guid,slug,link,permalink_template,status${withLang ? `&lang=${lang}` : ''}`)
    if (!r) return null
    if (r.status === 200 && isObj(r.json)) return { status: 200, post: r.json as PostInfo }
    return { status: r.status }
  }
  const readPost = async (id: number) => readPostAt(base, id, true)

  const decide = (p: PostInfo | undefined): boolean =>
    !!p && (isUnderLangPath(p.permalink_template ?? '', root, lang) || isUnderLangPath(p.link ?? '', root, lang))
  const guidOf = (p: PostInfo | undefined): string | undefined => p?.guid?.raw ?? p?.guid?.rendered

  /** เว็บยืนยันเองว่าโพสต์อยู่ใต้ /lang จริงไหม (อ่านอย่างเดียว) */
  const verify = async (id: number): Promise<boolean> => {
    const bRes = await readPost(id)
    if (!bRes || bRes.status !== 200 || !bRes.post) return false
    if (mode === 'query') return decide(bRes.post)
    const rRes = await readPostAt(root, id, false)
    if (!rRes) return false
    if (rRes.status === 404) return decide(bRes.post)
    if (rRes.status === 200 && rRes.post) {
      const gR = guidOf(rRes.post)
      const gB = guidOf(bRes.post)
      if (gR && gB && gR === gB && rRes.post.id === bRes.post.id) return decide(rRes.post)
      if (gR && gB && gR !== gB) return decide(bRes.post)
    }
    return false
  }

  const recordOf = (id: number | undefined): PushLangRecord => (typeof id === 'number' ? { lang, mode, postId: id } : { lang, mode })
  const mergeWarnings = (...ws: Array<string | undefined>): string | undefined => {
    const out: string[] = []
    for (const w of ws) if (w && !out.includes(w)) out.push(w)
    return out.length ? out.join(' · ') : undefined
  }
  const callCore = (extra: Partial<WpPushInput>): Promise<WpPushResult> =>
    push({ ...input, ...extra, wpUrl: base, postsQuery, strictWrite: true })

  /** โพสต์ที่ยืนยันแล้วว่าอยู่ใต้ /lang — แก้ด้วยคำขอเดียวตามโหมดที่ผู้เรียกขอ แล้วตรวจซ้ำ */
  const updateVerified = async (id: number): Promise<PushLangResult> => {
    const r = await callCore({ existingPostId: id })
    if (!r.ok) return r
    const still = await verify(id)
    const warning = mergeWarnings(
      r.warning,
      still ? undefined : `โพสต์นี้ไม่อยู่ใต้ /${lang} บนเว็บแล้ว (ตรวจหลังอัพเดต) — ระบบไม่ได้ถอดโพสต์ออก ตรวจในหน้า WordPress`,
    )
    return { ...r, ...(warning && { warning }), langRecord: recordOf(id) }
  }

  // ── โพสต์ที่มีอยู่แล้ว ──
  // The id stored on the article and the id in the language record must be the same post: on a multisite the
  // same number on the root site and on the sub-site are two different posts.
  if (pushed?.postId && input.existingPostId && input.existingPostId !== pushed.postId) {
    return {
      ok: false,
      error: `บทความนี้ผูกกับโพสต์ ID ${input.existingPostId} แต่บันทึกปลายทาง /${lang} เป็นโพสต์ ID ${pushed.postId} — ไม่ได้เขียนอะไรขึ้นเว็บ ตรวจโพสต์ทั้งสองในหน้า WordPress`,
    }
  }
  let existingId: number | undefined = input.existingPostId ?? pushed?.postId
  let draftId: number | undefined

  if (pushed && existingId) {
    const cur = await readPost(existingId)
    if (!cur) return { ok: false, error: 'อ่านโพสต์เดิมบนเว็บไม่ได้ (เครือข่าย) — ยังไม่ได้เขียนอะไรขึ้นเว็บ ลองใหม่อีกครั้ง' }
    if (cur.status === 404) existingId = undefined
    else if (cur.status === 200) return updateVerified(existingId)
    else return { ok: false, error: `อ่านโพสต์เดิมบนเว็บไม่ได้ (WordPress ตอบ ${cur.status}) — ยังไม่ได้เขียนอะไรขึ้นเว็บ` }
  } else if (existingId && !(stranded && stranded.postId === existingId)) {
    return { ok: false, error: 'บทความนี้ push ไว้ที่ปลายทางอื่นแล้ว — เปลี่ยนปลายทางไม่ได้หลัง push ครั้งแรก' }
  }

  if (!pushed && stranded) {
    const cur = await readPost(stranded.postId)
    if (!cur) return { ok: false, error: 'อ่าน Draft ที่ค้างบนเว็บไม่ได้ (เครือข่าย) — ยังไม่ได้เขียนอะไรขึ้นเว็บ ลองใหม่อีกครั้ง', strandedDraft: stranded }
    if (cur.status === 200 && cur.post) {
      const st = cur.post.status
      if (st === 'publish' || st === 'future' || st === 'private') {
        if (await verify(stranded.postId)) return updateVerified(stranded.postId)
        return {
          ok: false,
          error: `โพสต์ ID ${stranded.postId} บนเว็บถูกเผยแพร่แล้วและเว็บไม่ได้วางไว้ใต้ /${lang} — ไม่ได้เขียนทับ ตรวจในหน้า WordPress`,
          strandedDraft: stranded,
        }
      }
      if (st === 'draft' || st === 'pending' || st === 'auto-draft') draftId = stranded.postId
      else return { ok: false, error: `โพสต์ ID ${stranded.postId} บนเว็บมีสถานะ ${st ?? 'ไม่ทราบ'} — ไม่ได้เขียนอะไร ตรวจในหน้า WordPress`, strandedDraft: stranded }
    } else if (cur.status !== 404) {
      return { ok: false, error: `อ่าน Draft ที่ค้างบนเว็บไม่ได้ (WordPress ตอบ ${cur.status}) — ยังไม่ได้เขียนอะไรขึ้นเว็บ`, strandedDraft: stranded }
    }
    // 404 = Draft ถูกลบไปแล้ว → สร้างใหม่
  }

  // ── โพสต์ใหม่: ห้ามชน slug ที่มีอยู่ (ไม่ทับโพสต์เดิมเมื่อ push ไปส่วนภาษา) ──
  if (!draftId && input.slug?.trim()) {
    const slug = input.slug.trim()
    const r = await get(`${base}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&status=any&context=edit&_fields=id,status,link&per_page=1&lang=${lang}`)
    if (!r || r.status !== 200 || !Array.isArray(r.json)) {
      return { ok: false, error: 'ตรวจ slug ซ้ำบนเว็บไม่ได้ — ยังไม่ได้เขียนอะไรขึ้นเว็บ ลองใหม่อีกครั้ง' }
    }
    if (r.json.length > 0) {
      const hit = r.json[0] as { id?: number }
      return {
        ok: false,
        error: `บนเว็บมีโพสต์ที่ใช้ slug "${slug}" อยู่แล้ว (ID ${hit?.id ?? '?'}) — ระบบไม่ทับโพสต์ที่มีอยู่เมื่อ push ไปส่วนภาษา ไม่ได้เขียนอะไร เปลี่ยน slug หรือจัดการโพสต์นั้นก่อน`,
      }
    }
  }

  // ── รอบ 1: วางเป็น Draft เสมอ ──
  const r1 = await callCore({ publishMode: 'draft', ...(draftId ? { existingPostId: draftId } : { existingPostId: undefined }) })
  if (!r1.ok) return stranded ? { ...r1, strandedDraft: stranded } : r1
  const postId = r1.postId
  if (typeof postId !== 'number') return { ok: false, error: 'WordPress ไม่ได้ส่ง ID โพสต์กลับมา — ตรวจในหน้า WordPress' }

  if (!(await verify(postId))) {
    return {
      ok: false,
      error: `ระบบวางบทความเป็น Draft บนเว็บแล้ว (ID ${postId}, ${root}/wp-admin/post.php?post=${postId}&action=edit) แต่เว็บไม่ได้วางไว้ใต้ /${lang} จึงไม่ได้เผยแพร่ สาเหตุที่เป็นไปได้: Polylang ฟรีไม่รับภาษาผ่าน API, ปลั๊กอินแปลไม่ได้เก็บโพสต์แยกภาษา, หรือ WPML ยังไม่ได้ตั้งค่าแบบไดเรกทอรี กด push ซ้ำจะใช้ Draft เดิม ไม่สร้างใหม่`,
      strandedDraft: { postId, lang, mode },
    }
  }

  // ── รอบ 2: ยืนยันตำแหน่งแล้วค่อยเผยแพร่ (เฉพาะที่ผู้เรียกขอ publish และไม่ได้ตั้งเวลา) ──
  if (input.publishMode === 'publish' && !input.publishAt) {
    const r2 = await callCore({ existingPostId: postId, publishMode: 'publish' })
    if (!r2.ok) {
      return {
        ...r1,
        ok: true,
        status: 'draft',
        langRecord: recordOf(postId),
        warning: mergeWarnings(r1.warning, `โพสต์เป็น Draft ใต้ /${lang} ที่ยืนยันตำแหน่งแล้ว แต่เผยแพร่ไม่สำเร็จ: ${r2.error ?? 'ไม่ทราบสาเหตุ'}`),
      }
    }
    const warning = mergeWarnings(r1.warning, r2.warning)
    return { ...r2, ...(warning && { warning }), langRecord: recordOf(postId) }
  }
  return { ...r1, langRecord: recordOf(postId) }
}
