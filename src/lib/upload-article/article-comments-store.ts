// Comment รายบทความ — ส่วนที่แตะฐานข้อมูล (pushPrefs.articleComments ผ่าน updatePrefs เท่านั้น)
import { updatePrefs } from '@/lib/upload-article/prefs-store'
import {
  readArticleComments,
  toImportedComments,
  withArticleComments,
  type ArticleComment,
  type ExtractedComment,
} from '@/lib/upload-article/article-comments'

/**
 * เก็บ comment ที่อ่านได้จากไฟล์ต้นฉบับของบทความที่เพิ่งนำเข้า — คืนจำนวนที่เก็บต่อบทความ
 * ไม่ throw: การนำเข้าบทความต้องไม่ล้มเพราะเก็บ comment ไม่ได้ (คืน null = เก็บไม่สำเร็จ ให้ผู้เรียกเตือนเอง)
 */
export async function saveImportedComments(
  clientId: string,
  orgId: string,
  entries: Array<{ articleId: string; comments: ExtractedComment[] | undefined }>,
): Promise<Record<string, number> | null> {
  const withComments = entries.filter((e) => e.comments && e.comments.length > 0)
  if (withComments.length === 0) return {}
  try {
    const saved = await updatePrefs(clientId, orgId, (current) => {
      let prefs = current
      const counts: Record<string, number> = {}
      for (const e of withComments) {
        const list = toImportedComments(e.comments ?? [])
        if (list.length === 0) continue
        prefs = withArticleComments(prefs, e.articleId, list)
        counts[e.articleId] = list.length
      }
      return { prefs, result: counts }
    })
    return saved ? saved.result : null
  } catch (e) {
    console.error('[upload-article] saveImportedComments failed:', e instanceof Error ? e.message : e)
    return null
  }
}

/** pushPrefs key ของล็อก "กำลังปรับตาม Comment" — { [articleId]: { token, at } } */
export const REVISE_LOCKS_KEY = 'articleCommentReviseLocks'

type ReviseLocks = Record<string, { token: string; at: number }>

function readReviseLocks(prefs: Record<string, unknown>, now: number, ttlMs: number): ReviseLocks {
  const raw = prefs[REVISE_LOCKS_KEY]
  const out: ReviseLocks = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const lock = v as { token?: unknown; at?: unknown } | null
    // ล็อกที่เกินอายุ = งานนั้นถูกตัดกลางทาง ทิ้งไปเลย
    if (lock && typeof lock.token === 'string' && typeof lock.at === 'number' && now - lock.at < ttlMs) {
      out[id] = { token: lock.token, at: lock.at }
    }
  }
  return out
}

function withReviseLocks(prefs: Record<string, unknown>, locks: ReviseLocks): Record<string, unknown> {
  const next = { ...prefs }
  if (Object.keys(locks).length > 0) next[REVISE_LOCKS_KEY] = locks
  else delete next[REVISE_LOCKS_KEY]
  return next
}

/**
 * จองบทความไว้ก่อนเรียก AI ปรับตาม Comment — กัน 2 คำขอของบทความเดียวกันเรียก AI ซ้อนกัน (จ่ายเงิน 2 รอบ ใช้ผลได้รอบเดียว)
 * คืน token เมื่อจองได้, 'busy' เมื่อมีงานอื่นจองอยู่, null เมื่อไม่พบลูกค้า
 */
export async function claimReviseLock(clientId: string, orgId: string, articleId: string, ttlMs: number): Promise<string | 'busy' | null> {
  const now = Date.now()
  const token = `${now}-${Math.random().toString(36).slice(2, 10)}`
  const saved = await updatePrefs(clientId, orgId, (current) => {
    const locks = readReviseLocks(current, now, ttlMs)
    if (locks[articleId]) return { result: 'busy' as const }
    locks[articleId] = { token, at: now }
    return { prefs: withReviseLocks(current, locks), result: token }
  })
  return saved ? saved.result : null
}

/** ปล่อยล็อก — เฉพาะล็อกของตัวเอง (token ตรง) ล็อกที่หมดอายุแล้วถูกคนอื่นจองต่อจะไม่ถูกแตะ */
export async function releaseReviseLock(clientId: string, orgId: string, articleId: string, token: string, ttlMs: number): Promise<void> {
  await updatePrefs(clientId, orgId, (current) => {
    const locks = readReviseLocks(current, Date.now(), ttlMs)
    if (locks[articleId]?.token !== token) return { result: null }
    delete locks[articleId]
    return { prefs: withReviseLocks(current, locks), result: null }
  })
}

/** แทนที่รายการ comment ของบทความ 1 ชิ้น — คืนรายการที่เก็บจริง (null = ไม่พบลูกค้า) */
export async function replaceArticleComments(
  clientId: string,
  orgId: string,
  articleId: string,
  mutate: (current: ArticleComment[]) => ArticleComment[],
): Promise<ArticleComment[] | null> {
  const saved = await updatePrefs(clientId, orgId, (current) => {
    const prefs = withArticleComments(current, articleId, mutate(readArticleComments(current, articleId)))
    return { prefs, result: readArticleComments(prefs, articleId) }
  })
  return saved ? saved.result : null
}
