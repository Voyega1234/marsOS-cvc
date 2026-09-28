// ─── PBN Backlinks — set ข้อมูลโปรเจกต์ + สไตล์บทความต่อเว็บ + เป้าหมายของบทความ ─────────────
// เก็บใน pushPrefs ของแถว PBN เท่านั้น (ไม่แก้ schema, ไม่มีผลกับลูกค้า Upload Article)
//   pbnProfiles       — set ข้อมูลโปรเจกต์เพิ่มเติม (เว็บหลัก + ภาษา) แต่ละ set มี Content Engine ของตัวเอง
//                       set "main" = ค่าเดิมของแถว (client.website / client.language / CE projectId = client.id)
//   pbnStyles         — สไตล์บทความต่อเว็บ PBN (siteId → ธีม) ไม่มี = ใช้สไตล์หลัก (client.themeColors)
//   pbnArticleTargets — บทความไหนเขียนเพื่อขึ้นเว็บไหน ด้วย set ไหน (articleId → { siteId, profileId })
// ไฟล์นี้ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าเว็บ — ห้าม import โมดูลของ Node ที่นี่

import type { UploadTheme } from './types'

export const PBN_MAIN_PROFILE = 'main'
export const PBN_MAX_PROFILES = 50
const PROFILE_ID_RE = /^[A-Za-z0-9-]{6,64}$/

export type PbnLanguage = 'th' | 'en' | 'both'

export interface PbnProfile {
  id: string
  name: string
  website: string
  language: PbnLanguage
  createdAt: string
  updatedAt?: string
}

export interface PbnStyle {
  siteId: string
  /** ชื่อสไตล์ — ค่าเริ่มต้นคือชื่อเว็บ PBN */
  name: string
  theme: UploadTheme
  updatedAt: string
}

export interface PbnArticleTarget {
  siteId: string
  profileId: string
}

export type PbnArticleTargets = Record<string, PbnArticleTarget>

export function isPbnProfileId(v: unknown): v is string {
  return typeof v === 'string' && (v === PBN_MAIN_PROFILE || PROFILE_ID_RE.test(v))
}

function asLanguage(v: unknown): PbnLanguage {
  return v === 'en' || v === 'both' ? v : 'th'
}

export function readPbnProfiles(prefs: Record<string, unknown> | null | undefined): PbnProfile[] {
  const raw = prefs?.pbnProfiles
  if (!Array.isArray(raw)) return []
  const out: PbnProfile[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (typeof r.id !== 'string' || !PROFILE_ID_RE.test(r.id) || typeof r.name !== 'string') continue
    out.push({
      id: r.id,
      name: r.name,
      website: typeof r.website === 'string' ? r.website : '',
      language: asLanguage(r.language),
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
    })
  }
  return out
}

export function readPbnStyles(prefs: Record<string, unknown> | null | undefined): Record<string, PbnStyle> {
  const raw = prefs?.pbnStyles
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, PbnStyle> = {}
  for (const [siteId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    if (!r.theme || typeof r.theme !== 'object') continue
    out[siteId] = {
      siteId,
      name: typeof r.name === 'string' ? r.name : '',
      theme: r.theme as UploadTheme,
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
    }
  }
  return out
}

export function readPbnArticleTargets(prefs: Record<string, unknown> | null | undefined): PbnArticleTargets {
  const raw = prefs?.pbnArticleTargets
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PbnArticleTargets = {}
  for (const [articleId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    if (typeof r.siteId !== 'string' || !r.siteId) continue
    out[articleId] = { siteId: r.siteId, profileId: isPbnProfileId(r.profileId) ? r.profileId : PBN_MAIN_PROFILE }
  }
  return out
}

/** projectId ของ Content Engine ของ set นี้ — set หลักใช้ client.id เดิม (prompt ที่ตั้งไว้แล้วใช้ต่อได้) */
export function pbnCeScopeId(clientId: string, profileId: string | null | undefined): string {
  return !profileId || profileId === PBN_MAIN_PROFILE ? clientId : `${clientId}~${profileId}`
}

/** ข้อความภาษาไว้โชว์ในหน้าเว็บ */
export const PBN_LANGUAGE_LABEL: Record<PbnLanguage, string> = { th: 'ไทย', en: 'อังกฤษ', both: 'ไทย+อังกฤษ' }
