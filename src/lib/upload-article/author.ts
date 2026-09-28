// ─── Upload Article — Author Box (กล่องผู้เขียนท้ายบทความ) ────────────────────────
// ตั้งค่าใน Project Setting > Author Box — ตั้งได้หลายคน ระบบเลือกคนใดคนหนึ่งใส่แต่ละบทความ
// เก็บใน UploadClient.pushPrefs.author — ไม่ส่งไปกับ UploadClientDTO (รูปเป็น base64 หนัก) ส่งแค่ authorSummary
// ไฟล์นี้ pure (ใช้ได้ทั้งหน้า UI และ server) — ตัวเรนเดอร์ HTML/CSS จริงอยู่ที่ articleAuthorCard.ts (shared กับ Clients)
//
// ไม่มีคอลัมน์เก็บ "เลือกผู้เขียนคนไหนให้บทความนี้" ในสคีมา (ห้ามแก้สคีมา) — โหมดสุ่มจึงต้องสุ่มแบบ "คงที่"
// อิงจาก articleId (hash) ให้ build ซ้ำกี่ครั้งก็ได้คนเดิมเสมอ ไม่ใช่สุ่มใหม่ทุกครั้ง

import { AUTHOR_CARD_STYLES, type AuthorCardStyle, normalizeAuthorCardStyle } from '@/lib/articleAuthorCard'

export type UploadAuthorPick = 'first' | 'random'

export interface AuthorProfile {
  id: string
  name: string
  title: string
  /** base64 data URL ย่อแล้ว หรือ URL รูปโปรไฟล์ */
  image?: string
  /** วุฒิ/ใบรับรอง/ประสบการณ์ — บรรทัดละข้อ */
  credentials: string[]
}

export interface UploadAuthorSettings {
  enabled: boolean
  style: AuthorCardStyle
  authors: AuthorProfile[]
  pick: UploadAuthorPick
}

/** ส่งไปกับ DTO ให้หน้าตั้งค่ารู้ว่าตั้งผู้เขียนไว้หรือยัง (ไม่ต้องโหลดรูปทั้งหมด) */
export interface UploadAuthorSummary {
  enabled: boolean
  count: number
}

export const UPLOAD_AUTHOR_MAX = 10

export const DEFAULT_UPLOAD_AUTHOR: UploadAuthorSettings = {
  enabled: false,
  style: 'profile',
  authors: [],
  pick: 'first',
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** รูปที่รับ: data:image (อัปโหลดจากเครื่อง) หรือ https */
const imageSrc = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(s)) return s
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s.slice(0, 2000)
  return ''
}

const ID_RE = /[^a-z0-9-]+/g
function sanitizeId(v: unknown, fallback: string, used: Set<string>): string {
  let base = typeof v === 'string' ? v.toLowerCase().replace(ID_RE, '').slice(0, 64) : ''
  if (!base) base = fallback
  let id = base
  let n = 2
  while (used.has(id)) {
    id = `${base}-${n}`
    n++
  }
  used.add(id)
  return id
}

function readAuthorProfile(raw: unknown, index: number, used: Set<string>): AuthorProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = str(r.name, 100)
  const title = str(r.title, 150)
  if (!name && !title) return null

  const credentials = Array.isArray(r.credentials)
    ? r.credentials.map((c) => str(c, 200)).filter(Boolean).slice(0, 20)
    : []

  const id = sanitizeId(r.id, `author-${index}`, used)
  const out: AuthorProfile = { id, name, title, credentials }
  const image = imageSrc(r.image)
  if (image) out.image = image
  return out
}

/** อ่าน/ตรวจค่า Author Box จาก pushPrefs (หรือจาก body ที่หน้า UI ส่งมา) — ค่าเพี้ยนตกกลับเป็นค่าเริ่มต้น */
export function readUploadAuthor(raw: unknown): UploadAuthorSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_UPLOAD_AUTHOR, authors: [] }
  const r = raw as Record<string, unknown>

  const enabled = r.enabled === true
  const style = normalizeAuthorCardStyle(r.style)
  const pick: UploadAuthorPick = r.pick === 'random' ? 'random' : 'first'

  const used = new Set<string>()
  const authors: AuthorProfile[] = []
  for (const item of Array.isArray(r.authors) ? r.authors : []) {
    if (authors.length >= UPLOAD_AUTHOR_MAX) break
    const author = readAuthorProfile(item, authors.length + 1, used)
    if (author) authors.push(author)
  }

  return { enabled, style, authors, pick }
}

export function uploadAuthorSummary(raw: unknown): UploadAuthorSummary {
  const author = readUploadAuthor(raw)
  return { enabled: author.enabled, count: author.authors.length }
}

/** hash ง่าย ๆ (djb2) ให้ articleId → ตัวเลขคงที่ — ไม่ต้องเก็บลง schema แต่ build ซ้ำกี่ครั้งก็ได้คนเดิม */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h
}

/** เลือกผู้เขียน 1 คนสำหรับบทความนี้ — 'first' = คนแรกเสมอ, 'random' = สุ่มแบบคงที่ตาม articleId (ไม่ใช่สุ่มใหม่ทุก build) */
export function pickAuthorForArticle(settings: UploadAuthorSettings, articleId: string): AuthorProfile | null {
  if (!settings.enabled || settings.authors.length === 0) return null
  if (settings.pick === 'first' || settings.authors.length === 1) return settings.authors[0]
  const idx = hashString(articleId) % settings.authors.length
  return settings.authors[idx]
}

export { AUTHOR_CARD_STYLES }
export type { AuthorCardStyle }
