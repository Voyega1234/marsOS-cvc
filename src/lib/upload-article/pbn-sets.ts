// ─── PBN Backlinks — set ข้อมูลโปรเจกต์ + สไตล์บทความต่อเว็บ + เป้าหมายของบทความ ─────────────
// เก็บใน pushPrefs ของแถว PBN เท่านั้น (ไม่แก้ schema, ไม่มีผลกับลูกค้า Upload Article)
//   pbnProfiles       — set ข้อมูลโปรเจกต์เพิ่มเติม (เว็บหลัก + ภาษา) แต่ละ set มี Content Engine ของตัวเอง
//                       set "main" = ค่าเดิมของแถว (client.website / client.language / CE projectId = client.id)
//   pbnStyles         — สไตล์บทความต่อเว็บ PBN (siteId → ธีม) ไม่มี = ใช้สไตล์หลัก (client.themeColors)
//   pbnArticleTargets — บทความไหนเขียนเพื่อขึ้นเว็บไหน ด้วย set ไหน (articleId → { siteId, profileId, cluster? })
//                       cluster = หมวดที่เลือกไว้ตอนสั่งเขียน (เว็บโครง magazine) ใช้เป็นค่าเริ่มต้นตอน push
//   pbnSectionColors  — สีประจำหมวดของเว็บโครง magazine (siteId → หมวดย่อย → #rrggbb) ระบบเก็บเองทุกครั้งที่โหลด
//                       รายการหมวดจาก repo ของเว็บ ใช้ปรับสีสไตล์บทความให้ตรงหมวดที่เลือก (retintPbnTheme)
// ไฟล์นี้ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าเว็บ — ห้าม import โมดูลของ Node ที่นี่

import type { UploadTheme } from './types'

export const PBN_MAIN_PROFILE = 'main'
export const PBN_MAX_PROFILES = 50
const PROFILE_ID_RE = /^[A-Za-z0-9-]{6,64}$/
/** รูปแบบ slug หมวดของเว็บโครง magazine (ตรงกับ key ใน site.config.json ของเว็บ) */
export const PBN_CLUSTER_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/

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
  /** หมวดที่เลือกตอนสั่งเขียน — เฉพาะเว็บโครง magazine, ไม่เลือก = เลือกตอน push */
  cluster?: string
}

/** หมวดที่รับมาจากหน้าเว็บ/ที่เก็บไว้ — รูปแบบไม่ถูก = ถือว่าไม่ได้เลือก */
export function cleanPbnCluster(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return PBN_CLUSTER_SLUG_RE.test(s) ? s : ''
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
    const cluster = cleanPbnCluster(r.cluster)
    out[articleId] = { siteId: r.siteId, profileId: isPbnProfileId(r.profileId) ? r.profileId : PBN_MAIN_PROFILE, ...(cluster ? { cluster } : {}) }
  }
  return out
}

export type PbnSectionColors = Record<string, Record<string, string>>

const SECTION_HEX_RE = /^#[0-9a-f]{6}$/

export function readPbnSectionColors(prefs: Record<string, unknown> | null | undefined): PbnSectionColors {
  const raw = prefs?.pbnSectionColors
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PbnSectionColors = {}
  for (const [siteId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const map: Record<string, string> = {}
    for (const [cluster, color] of Object.entries(v as Record<string, unknown>)) {
      if (PBN_CLUSTER_SLUG_RE.test(cluster) && typeof color === 'string' && SECTION_HEX_RE.test(color)) map[cluster] = color
    }
    if (Object.keys(map).length) out[siteId] = map
  }
  return out
}

function themeColorAt(theme: unknown, path: string[]): string {
  let v: unknown = theme
  for (const k of path) {
    if (!v || typeof v !== 'object') return ''
    v = (v as Record<string, unknown>)[k]
  }
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

function replaceColorDeep(v: unknown, re: RegExp, to: string): unknown {
  if (typeof v === 'string') return v.replace(re, to)
  if (Array.isArray(v)) return v.map((x) => replaceColorDeep(x, re, to))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = replaceColorDeep(x, re, to)
    return out
  }
  return v
}

/**
 * เว็บโครง magazine ใช้สไตล์ชุดเดียวทุกหมวด ต่างกันแค่ "สีประจำหมวด" (ลิงก์ / หัวข้อ H2 / เส้นขอบ)
 * สไตล์ที่สแกนมาจึงติดสีของหมวดที่บทความตัวอย่างอยู่ — ฟังก์ชันนี้สลับสีนั้นเป็นสีของหมวดที่บทความนี้เลือก
 * ไม่เปลี่ยนอะไรเมื่อ: ไม่ได้เลือกหมวด / หมวดไม่มีสี / สีหลักของสไตล์ไม่ใช่สีประจำหมวดของเว็บนี้ (เช่น แก้สีเองไว้) / สีตรงกันอยู่แล้ว
 */
export function retintPbnTheme(theme: UploadTheme, colors: Record<string, string> | undefined, cluster: string | undefined): UploadTheme {
  const target = cluster && colors ? colors[cluster] : ''
  if (!target || !colors) return theme
  const palette = new Set(Object.values(colors))
  const base = [['accent'], ['theme'], ['detail', 'article', 'link', 'color'], ['detail', 'article', 'h2', 'color']]
    .map((p) => themeColorAt(theme, p))
    .find((c) => palette.has(c))
  if (!base || base === target) return theme
  // base ผ่าน SECTION_HEX_RE มาแล้ว (# + hex 6 ตัว) จึงใส่ใน RegExp ตรง ๆ ได้ — ไม่แตะสี 8 หลัก (#rrggbbaa) ที่ขึ้นต้นเหมือนกัน
  return replaceColorDeep(theme, new RegExp(`${base}(?![0-9a-f])`, 'gi'), target) as UploadTheme
}

/** projectId ของ Content Engine ของ set นี้ — set หลักใช้ client.id เดิม (prompt ที่ตั้งไว้แล้วใช้ต่อได้) */
export function pbnCeScopeId(clientId: string, profileId: string | null | undefined): string {
  return !profileId || profileId === PBN_MAIN_PROFILE ? clientId : `${clientId}~${profileId}`
}

/** ข้อความภาษาไว้โชว์ในหน้าเว็บ */
export const PBN_LANGUAGE_LABEL: Record<PbnLanguage, string> = { th: 'ไทย', en: 'อังกฤษ', both: 'ไทย+อังกฤษ' }
