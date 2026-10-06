// ─── Upload Article — Request Index ผ่าน Google Indexing API (URL_UPDATED) ──────────────
// ยิงหลังบทความขึ้นเว็บแบบ Publish แล้ว (อัตโนมัติจาก push route หรือกดเองในหน้า Push)
// ใช้ตัวตน service เท่านั้น (getIndexingServiceAuth) — เงื่อนไขฝั่ง Google ที่เจ้าของต้องตั้งเอง:
//   1. เพิ่ม email ของ service account เป็น "Owner" (ไม่ใช่แค่ User) ใน GSC property ของเว็บลูกค้า
//   2. เปิด Web Search Indexing API ใน GCP project ของ service account
// ผลล่าสุดต่อบทความเก็บใน pushPrefs.indexRequests[articleId] (ไม่แก้ schema)

import { getIndexingServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { updatePrefs, type PrefsObject } from './prefs-store'
import { safeFetch } from './safe-fetch'
import type { UploadIndexRequest, UploadPushPrefs } from './types'

const INDEXING_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish'
const TIMEOUT_MS = 15_000
const CHECK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** URL ที่ส่งให้ Google ได้ — ต้องเป็น https ของเว็บจริง (ไม่ใช่ ?p=123 ของ Draft) */
export function isIndexableUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    // ลิงก์ preview ของ WordPress Draft (?p= / ?page_id= / preview=true) ไม่ใช่ URL จริงของบทความ
    if (u.searchParams.has('preview') || u.searchParams.has('p') || u.searchParams.has('page_id')) return false
    return true
  } catch {
    return false
  }
}

/**
 * เช็คว่าหน้าเปิดได้จริง (HTTP 200) ก่อนส่งให้ Google — ใช้กับ PBN (GitHub ต้องรอ build) และ SEO SME
 * (ไม่มี post id ให้ถาม WordPress) Draft/ยังไม่ build เสร็จ = 404 → ไม่ส่ง
 */
export async function checkUrlLive(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!isIndexableUrl(url)) return { ok: false, error: 'URL ของบทความยังไม่ใช่ลิงก์ https ที่เผยแพร่แล้ว' }
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': CHECK_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    res.body?.cancel().catch(() => {})
    // บล็อกเฉพาะ "ไม่มีหน้านี้" — 403/5xx มักเป็น firewall กันบอท เช็คไม่ได้ก็ปล่อยให้ Google ตัดสินเอง
    if (res.status === 404 || res.status === 410) {
      return { ok: false, error: `หน้ายังเปิดไม่ได้ (${res.status}) — ยังเป็น Draft หรือเว็บยัง build ไม่เสร็จ รอสักครู่แล้วกด Request Index อีกครั้ง` }
    }
    return { ok: true }
  } catch {
    return { ok: true }
  }
}

/** เช็คหน้า live ก่อน แล้วค่อยส่ง Google — คืน record พร้อมจดลงที่ไหนก็ได้ */
export async function requestIndexIfLive(url: string): Promise<UploadIndexRequest> {
  const at = new Date().toISOString()
  const live = await checkUrlLive(url)
  if (!live.ok) return { url, at, ok: false, error: live.error }
  const r = await requestGoogleIndex(url)
  return { url, at, ok: r.ok, ...(r.error ? { error: r.error } : {}) }
}

/** แปลง error ของ Google ให้ทีมรู้ว่าต้องแก้ที่ไหน */
async function describeGoogleError(status: number, raw: string): Promise<string> {
  let message = raw.slice(0, 300)
  let reason = ''
  try {
    const j = JSON.parse(raw) as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } }
    message = j.error?.message || message
    reason = j.error?.details?.find((d) => d.reason)?.reason || j.error?.status || ''
  } catch { /* ไม่ใช่ JSON — ใช้ข้อความดิบ */ }

  if (reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(message)) {
    return 'ยังไม่ได้เปิด Web Search Indexing API ใน Google Cloud project ของ service account'
  }
  if (status === 403 && /ownership|owner/i.test(message)) {
    const identity = await getServiceIdentity().catch(() => null)
    const email = identity?.email ? ` (${identity.email})` : ''
    return `service account${email} ยังไม่ได้เป็น Owner ใน Google Search Console ของเว็บนี้ — เพิ่มเป็น Owner ก่อน`
  }
  if (status === 429 || reason === 'RESOURCE_EXHAUSTED') {
    return 'โควตา Indexing API ของวันนี้เต็มแล้ว (ประมาณ 200 URL/วัน) — ลองใหม่พรุ่งนี้'
  }
  return `Google ตอบ ${status}: ${message}`
}

/** ส่ง URL ให้ Google (URL_UPDATED) — ไม่ throw คืน ok/error เสมอ */
export async function requestGoogleIndex(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!isIndexableUrl(url)) return { ok: false, error: 'URL ของบทความยังไม่ใช่ลิงก์ https ที่เผยแพร่แล้ว' }

  let token: string | null = null
  try {
    const auth = await getIndexingServiceAuth()
    const client = await auth.getClient()
    const t = await client.getAccessToken()
    token = typeof t === 'string' ? t : t?.token ?? null
  } catch (e) {
    return { ok: false, error: `ขอสิทธิ์ Google ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!token) return { ok: false, error: 'ขอสิทธิ์ Google ไม่สำเร็จ (ไม่มี access token)' }

  try {
    const res = await fetch(INDEXING_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: await describeGoogleError(res.status, await res.text().catch(() => '')) }
  } catch (e) {
    return { ok: false, error: `เรียก Indexing API ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** ยิง request index แล้วจดผลลง pushPrefs.indexRequests[articleId] — คืนผล + prefs ล่าสุด */
export async function requestIndexForArticle(
  clientId: string,
  orgId: string,
  articleId: string,
  url: string,
): Promise<{ record: UploadIndexRequest; prefs: PrefsObject | null }> {
  const r = await requestGoogleIndex(url)
  const record: UploadIndexRequest = { url, at: new Date().toISOString(), ok: r.ok, ...(r.error ? { error: r.error } : {}) }
  const saved = await updatePrefs(clientId, orgId, (current) => {
    const cur = current as UploadPushPrefs
    const next: UploadPushPrefs = { ...cur, indexRequests: { ...(cur.indexRequests ?? {}), [articleId]: record } }
    return { prefs: next as PrefsObject, result: null }
  }).catch(() => null)
  return { record, prefs: saved?.prefs ?? null }
}

/** articleId → siteId → ผลล่าสุด (PBN) */
export type PbnIndexRequests = Record<string, Record<string, UploadIndexRequest>>

export function readPbnIndexRequests(prefs: Record<string, unknown> | null | undefined): PbnIndexRequests {
  const raw = prefs?.pbnIndexRequests
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as PbnIndexRequests
}

/** PBN: เช็คหน้า live (GitHub ต้องรอ build) แล้วส่ง Google — จดผลลง pushPrefs.pbnIndexRequests[articleId][siteId] */
export async function requestIndexForPbn(
  clientId: string,
  orgId: string,
  articleId: string,
  siteId: string,
  url: string,
): Promise<{ record: UploadIndexRequest; prefs: PrefsObject | null }> {
  const record = await requestIndexIfLive(url)
  const saved = await updatePrefs(clientId, orgId, (current) => {
    const all = readPbnIndexRequests(current)
    const next: PbnIndexRequests = { ...all, [articleId]: { ...(all[articleId] ?? {}), [siteId]: record } }
    return { prefs: { ...current, pbnIndexRequests: next }, result: null }
  }).catch(() => null)
  return { record, prefs: saved?.prefs ?? null }
}
