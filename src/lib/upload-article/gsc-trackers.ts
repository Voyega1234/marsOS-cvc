// ─── Upload Article — Report: keyword + URL ที่ทีมกด "บันทึก Monitor" ไว้ติดตาม ──────────
// คำนวณล้วน ไม่พึ่ง prisma/session (เรียกจาก unit test และจากฝั่ง client ได้)
// เก็บใน UploadClient.pushPrefs.gscTrackers (JSON เดิม ไม่แก้ schema) เขียนผ่าน updatePrefs เท่านั้น

import {
  escapeRe2, normalizeReportUrl, overviewFromMetrics,
  type GscDailyPoint, type GscMetric, type GscOverview, type RawGscRow, type ReportPeriod, type ReportSearchType,
} from './gsc-report'

/**
 * ชนิดของรายการติดตาม (คำนวณจากช่องที่มี ไม่ได้เก็บแยก — รายการเก่าที่มีทั้งคู่ = pair เหมือนเดิม)
 * - keyword: keyword อย่างเดียว = ผลของคำนี้ทั้งเว็บ (ทุกหน้า)
 * - page: บทความ/URL อย่างเดียว = ผลของหน้านี้จากทุกคำค้นหา
 * - pair: keyword + หน้า = ผลของคำนี้บนหน้านี้เท่านั้น
 */
export type GscTrackerKind = 'keyword' | 'page' | 'pair'

export interface UploadGscTracker {
  id: string
  /** คำค้นหาแบบที่ GSC เก็บ (ตัวพิมพ์เล็ก เว้นวรรคเดี่ยว) — '' = ติดตามทั้งหน้า (ชนิด page) */
  keyword: string
  /** URL ของหน้า — '' = ติดตามคำนี้ทั้งเว็บ (ชนิด keyword) */
  url: string
  /** ชื่อบทความ (มีเมื่อเลือก URL จากรายการบทความ) — ใช้แสดงผลอย่างเดียว ไม่ใช้เทียบข้อมูล */
  title?: string
  /** URL แบบ ?p=123 ที่ผู้ใช้เลือกไว้ตอนบันทึก (มีเมื่อระบบแปลงเป็นลิงก์จริงแล้วเก็บลง url) — ใช้บอกว่าแถวนั้น "ติดตามแล้ว" */
  sourceUrl?: string
  /** ownerTag.id ของผู้ดูแลรายการนี้ (pushPrefs.ownerTags) — ไม่มี = ยังไม่ระบุ; ใช้กรองแท็บ Keyword ที่ติดตาม */
  ownerTagId?: string
  /** ชื่อกลุ่มที่ทีมตั้งเอง (เช่น "Blog 45 - cpas") — ไม่มี = อยู่นอกกลุ่ม; ใช้จัดแถวในตารางเท่านั้น */
  group?: string
  /** กลุ่มย่อยภายใน group (เช่น "แบรนด์" ใต้ "Ads Landingpage") — มีได้เฉพาะเมื่อมี group; ใช้จัดแถว + รวมผลย่อยในตารางเท่านั้น */
  subgroup?: string
  createdAt: string
}

export const UPLOAD_MAX_TRACKER_GROUP = 60

/** ชื่อกลุ่ม: ยุบช่องว่าง ตัดหัวท้าย ตัดตามเพดาน — ไม่ใช่ string = '' (นอกกลุ่ม) */
export function normalizeTrackerGroup(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, UPLOAD_MAX_TRACKER_GROUP)
}

const MAX_OWNER_TAG_ID = 64

/** ownerTag.id ที่เก็บได้ — string สั้น ๆ ไม่ว่าง; ถ้าส่ง validIds มาต้องอยู่ในชุดนั้นด้วย ไม่ผ่าน = '' */
export function normalizeTrackerOwner(raw: unknown, validIds?: ReadonlySet<string>): string {
  if (typeof raw !== 'string') return ''
  const id = raw.trim()
  if (!id || id.length > MAX_OWNER_TAG_ID) return ''
  if (validIds && !validIds.has(id)) return ''
  return id
}

export function trackerKind(t: Pick<UploadGscTracker, 'keyword' | 'url'>): GscTrackerKind {
  if (t.keyword && t.url) return 'pair'
  return t.url ? 'page' : 'keyword'
}

/** key ทั้งหมดของรายการ (url ที่ใช้จริง + sourceUrl ถ้ามี) — ใช้เช็กซ้ำและเช็ก "ติดตามแล้ว" */
export function trackerKeys(t: Pick<UploadGscTracker, 'keyword' | 'url' | 'sourceUrl'>): string[] {
  const keys = [trackerKey(t.keyword, t.url)]
  if (t.sourceUrl) keys.push(trackerKey(t.keyword, t.sourceUrl))
  return keys
}

/** เพดานต่อลูกค้า — keyword ทั้งเว็บถูกรวมยิง GSC เป็นชุด (ดู chunkKeywordRegex) จึงขยับจาก 30 ได้ */
export const UPLOAD_MAX_GSC_TRACKERS = 100
export const UPLOAD_MAX_TRACKER_KEYWORD = 150
export const UPLOAD_MAX_TRACKER_URL = 1000
export const UPLOAD_MAX_TRACKER_TITLE = 200

function normalizeTrackerTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, UPLOAD_MAX_TRACKER_TITLE)
}

/** GSC เก็บคำค้นหาเป็นตัวพิมพ์เล็ก — ปรับให้ตรงก่อนเก็บ ไม่งั้น filter แบบ equals ไม่เจอ */
export function normalizeTrackerKeyword(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, UPLOAD_MAX_TRACKER_KEYWORD)
}

/** URL ของหน้าที่ติดตาม — ต้องเป็น http(s) มีโดเมนจริง (ไม่ใส่ scheme = เติม https://) ไม่ผ่าน = '' */
export function normalizeTrackerUrl(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > UPLOAD_MAX_TRACKER_URL || /\s/.test(trimmed)) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    if (!u.hostname.includes('.')) return ''
    return withScheme
  } catch {
    return ''
  }
}

function safeNormUrl(url: string): string {
  if (!url) return ''
  try {
    return normalizeReportUrl(url)
  } catch {
    return url.trim().toLowerCase()
  }
}

const ID_PERMALINK_PARAMS = ['p', 'page_id']

/**
 * ลิงก์แบบเลขโพสต์ของ WordPress (https://site.com/?p=5013) — หน้าแรก + query p/page_id เป็นตัวเลข
 * normalizeReportUrl ตัด query ทิ้ง ทำให้ลิงก์แบบนี้กลายเป็น "หน้าแรก" ซึ่งผิด จึงต้องแยก key ไว้ต่างหาก
 * คืน null ถ้าไม่ใช่ลิงก์แบบเลขโพสต์
 */
function idPermalinkKey(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.pathname.replace(/\/+$/, '') !== '') return null
    for (const k of ID_PERMALINK_PARAMS) {
      const v = u.searchParams.get(k)
      if (v && /^\d+$/.test(v)) return `${u.hostname.toLowerCase()}/?${k}=${v}`
    }
    return null
  } catch {
    return null
  }
}

/** true = URL แบบ ?p=123 ที่ GSC ไม่รู้จัก (GSC เก็บลิงก์จริงของหน้า) ต้องแปลงเป็นลิงก์จริงก่อนจึงเทียบข้อมูลได้ */
export function isIdPermalinkUrl(url: string): boolean {
  return idPermalinkKey(url) !== null
}

/** key ของหน้าที่ใช้เทียบ: http/https, / ท้าย, percent-encoding ต่างกันถือเป็นหน้าเดียว — ลิงก์ ?p=123 ไม่ถูกยุบเป็นหน้าแรก */
export function trackerUrlKey(url: string): string {
  return idPermalinkKey(url) ?? safeNormUrl(url)
}

/** key กันซ้ำ: คำเดียวกัน + หน้าเดียวกัน (ช่องว่าง = ชนิด keyword/page จึงไม่ชนกับ pair) */
export function trackerKey(keyword: string, url: string): string {
  return `${normalizeTrackerKeyword(keyword)}\u0001${trackerUrlKey(url)}`
}

/** sourceUrl เก็บเฉพาะเมื่อเป็น URL ที่ถูกต้องและเป็นคนละหน้ากับ url — ไม่งั้น '' */
function normalizeSourceUrl(raw: unknown, url: string): string {
  if (!url) return ''
  const s = normalizeTrackerUrl(raw)
  return s && trackerUrlKey(s) !== trackerUrlKey(url) ? s : ''
}

/** อ่านรายการจาก pushPrefs แบบไม่เชื่อข้อมูล — ทิ้งแถวเสีย/ซ้ำ และตัดตามเพดาน */
export function readGscTrackers(raw: unknown): UploadGscTracker[] {
  if (!Array.isArray(raw)) return []
  const out: UploadGscTracker[] = []
  const seenKeys = new Set<string>()
  const seenIds = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id.trim().slice(0, 64) : ''
    const keyword = normalizeTrackerKeyword(rec.keyword)
    const url = normalizeTrackerUrl(rec.url)
    // url ที่กรอกมาแต่ใช้ไม่ได้ = แถวเสีย (ไม่แปลงเป็นติดตาม keyword ทั้งเว็บเงียบ ๆ)
    const rawUrl = typeof rec.url === 'string' ? rec.url.trim() : ''
    if (!id || (!keyword && !url) || (rawUrl && !url) || seenIds.has(id)) continue
    const key = trackerKey(keyword, url)
    if (seenKeys.has(key)) continue
    seenIds.add(id)
    seenKeys.add(key)
    const title = normalizeTrackerTitle(rec.title)
    const sourceUrl = normalizeSourceUrl(rec.sourceUrl, url)
    const ownerTagId = normalizeTrackerOwner(rec.ownerTagId)
    const group = normalizeTrackerGroup(rec.group)
    const subgroup = group ? normalizeTrackerGroup(rec.subgroup) : ''
    out.push({
      id, keyword, url,
      ...(title ? { title } : {}), ...(sourceUrl ? { sourceUrl } : {}), ...(ownerTagId ? { ownerTagId } : {}), ...(group ? { group } : {}),
      ...(subgroup ? { subgroup } : {}),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '',
    })
    if (out.length >= UPLOAD_MAX_GSC_TRACKERS) break
  }
  return out
}

export type GscTrackerError = 'invalid_keyword' | 'invalid_url' | 'empty' | 'duplicate' | 'duplicate_keyword' | 'duplicate_page' | 'limit'

export const GSC_TRACKER_ERROR_MESSAGES: Record<GscTrackerError, string> = {
  invalid_keyword: 'กรอก keyword ที่ต้องการติดตาม',
  invalid_url: 'URL ไม่ถูกต้อง — ใส่ลิงก์เต็มของหน้า เช่น https://example.com/blog/post',
  empty: 'กรอก keyword หรือเลือกบทความ / URL ที่ต้องการติดตาม',
  duplicate: 'keyword + URL นี้บันทึก Monitor ไว้แล้ว',
  duplicate_keyword: 'keyword นี้บันทึก Monitor (ทั้งเว็บ) ไว้แล้ว',
  duplicate_page: 'หน้านี้บันทึก Monitor (ทุก keyword) ไว้แล้ว',
  limit: `บันทึก Monitor ได้สูงสุด ${UPLOAD_MAX_GSC_TRACKERS} รายการ — ลบรายการที่ไม่ใช้ก่อน`,
}

export type AddGscTrackerResult =
  | { ok: true; trackers: UploadGscTracker[]; tracker: UploadGscTracker }
  | { ok: false; error: GscTrackerError }

function isTrackerKind(v: unknown): v is GscTrackerKind {
  return v === 'keyword' || v === 'page' || v === 'pair'
}

/**
 * เพิ่มรายการใหม่ (ไม่แก้ array เดิม) — รายการใหม่อยู่บนสุด
 * kind บอกว่าผู้ใช้ตั้งใจติดตามแบบไหน (ช่องที่ไม่เกี่ยวกับชนิดนั้นถูกทิ้ง); ไม่ส่ง kind = ดูจากช่องที่กรอก
 * (ปุ่ม "บันทึก Monitor" ในตารางเดิมส่ง keyword + url มา = pair เหมือนก่อน)
 */
export function addGscTracker(
  existing: UploadGscTracker[],
  input: { kind?: unknown; keyword?: unknown; url?: unknown; title?: unknown; sourceUrl?: unknown; ownerTagId?: unknown; group?: unknown; subgroup?: unknown },
  newId: () => string,
  nowIso: string,
  /** ownerTag.id ที่มีอยู่จริง — ownerTagId ที่ไม่อยู่ในชุดนี้ถูกทิ้ง (ไม่ส่ง = ไม่เก็บผู้ดูแลเลย) */
  validOwnerIds?: ReadonlySet<string>,
): AddGscTrackerResult {
  const kindIn = isTrackerKind(input.kind) ? input.kind : null
  const wantKeyword = kindIn !== 'page'
  const wantUrl = kindIn !== 'keyword'
  const rawUrl = wantUrl && typeof input.url === 'string' ? input.url.trim() : ''
  const keyword = wantKeyword ? normalizeTrackerKeyword(input.keyword) : ''
  const url = rawUrl ? normalizeTrackerUrl(rawUrl) : ''
  if (rawUrl && !url) return { ok: false, error: 'invalid_url' }
  if ((kindIn === 'keyword' || kindIn === 'pair') && !keyword) return { ok: false, error: 'invalid_keyword' }
  if ((kindIn === 'page' || kindIn === 'pair') && !url) return { ok: false, error: 'invalid_url' }
  if (!keyword && !url) return { ok: false, error: 'empty' }
  const title = url ? normalizeTrackerTitle(input.title) : ''
  const sourceUrl = normalizeSourceUrl(input.sourceUrl, url)
  const newKeys = trackerKeys({ keyword, url, sourceUrl })
  if (existing.some((t) => trackerKeys(t).some((k) => newKeys.includes(k)))) {
    const kind = trackerKind({ keyword, url })
    return { ok: false, error: kind === 'keyword' ? 'duplicate_keyword' : kind === 'page' ? 'duplicate_page' : 'duplicate' }
  }
  if (existing.length >= UPLOAD_MAX_GSC_TRACKERS) return { ok: false, error: 'limit' }
  let id = newId()
  for (let i = 0; i < 5 && existing.some((t) => t.id === id); i++) id = newId()
  const ownerTagId = validOwnerIds ? normalizeTrackerOwner(input.ownerTagId, validOwnerIds) : ''
  const group = normalizeTrackerGroup(input.group)
  const subgroup = group ? normalizeTrackerGroup(input.subgroup) : ''
  const tracker: UploadGscTracker = {
    id, keyword, url,
    ...(title ? { title } : {}), ...(sourceUrl ? { sourceUrl } : {}), ...(ownerTagId ? { ownerTagId } : {}), ...(group ? { group } : {}),
    ...(subgroup ? { subgroup } : {}),
    createdAt: nowIso,
  }
  return { ok: true, trackers: [tracker, ...existing], tracker }
}

export function removeGscTracker(existing: UploadGscTracker[], id: string): UploadGscTracker[] {
  return removeGscTrackers(existing, [id])
}

export function removeGscTrackers(existing: UploadGscTracker[], ids: readonly string[]): UploadGscTracker[] {
  const drop = new Set(ids)
  return existing.filter((t) => !drop.has(t.id))
}

/**
 * แก้ผู้ดูแล/กลุ่มของหลายรายการพร้อมกัน (ไม่แก้ array เดิม) — เฉพาะช่องที่ส่งมา (undefined = ไม่แตะ)
 * - ownerTagId ว่าง/ไม่อยู่ใน validOwnerIds = ล้างผู้ดูแล
 * - group ว่าง = เอาออกจากกลุ่ม (กลุ่มย่อยหลุดไปด้วย); เปลี่ยน group โดยไม่ส่ง subgroup = คงกลุ่มย่อยเดิม (ใช้ตอนเปลี่ยนชื่อกลุ่ม)
 * - subgroup ว่าง = เอาออกจากกลุ่มย่อย; รายการที่ไม่มี group หลังแก้ จะไม่เก็บ subgroup
 * คืน null ถ้าไม่พบรายการใดเลยใน ids
 */
export function updateGscTrackers(
  existing: UploadGscTracker[],
  ids: readonly string[],
  patch: { ownerTagId?: unknown; group?: unknown; subgroup?: unknown },
  validOwnerIds: ReadonlySet<string>,
): UploadGscTracker[] | null {
  const target = new Set(ids)
  if (!existing.some((t) => target.has(t.id))) return null
  const setOwner = patch.ownerTagId !== undefined
  const setGroup = patch.group !== undefined
  const owner = setOwner ? normalizeTrackerOwner(patch.ownerTagId, validOwnerIds) : ''
  const group = setGroup ? normalizeTrackerGroup(patch.group) : ''
  const setSubgroup = patch.subgroup !== undefined
  const subgroup = setSubgroup ? normalizeTrackerGroup(patch.subgroup) : ''
  return existing.map((t) => {
    if (!target.has(t.id)) return t
    const next: UploadGscTracker = { ...t }
    if (setOwner) { if (owner) next.ownerTagId = owner; else delete next.ownerTagId }
    if (setGroup) { if (group) next.group = group; else delete next.group }
    if (setSubgroup) { if (subgroup) next.subgroup = subgroup; else delete next.subgroup }
    if (!next.group) delete next.subgroup
    return next
  })
}

// ── Project folders + keyword groups (Convert Cake only) ──────────────────────────
// A folder = a tracker `group`; a keyword group = a tracker `subgroup`. Folder records let them exist empty
// and carry a responsible owner. Stored in pushPrefs.gscTrackerFolders next to gscTrackers.

export interface UploadGscTrackerFolder { name: string; ownerTagId?: string; subgroups: string[]; createdAt: string }

export const UPLOAD_MAX_TRACKER_FOLDERS = 50
/** Per folder */
export const UPLOAD_MAX_TRACKER_SUBFOLDERS = 50

/** Folder + keyword-group features are enabled only for Convert Cake (name letters/digits, lowercased, contains "convertcake") */
export function isTrackerFoldersClient(name: unknown): boolean {
  if (typeof name !== 'string') return false
  return name.toLowerCase().replace(new RegExp('[^\\p{L}\\p{N}]', 'gu'), '').includes('convertcake')
}

function uniqueNames(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const n = normalizeTrackerGroup(v)
    if (n && !out.includes(n)) out.push(n)
    if (out.length >= cap) break
  }
  return out
}

/** Read folder records from pushPrefs without trusting them: drop empty/duplicate names, apply caps */
export function readTrackerFolders(raw: unknown): UploadGscTrackerFolder[] {
  if (!Array.isArray(raw)) return []
  const out: UploadGscTrackerFolder[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = normalizeTrackerGroup(rec.name)
    if (!name || out.some((f) => f.name === name)) continue
    const ownerTagId = normalizeTrackerOwner(rec.ownerTagId)
    out.push({
      name,
      ...(ownerTagId ? { ownerTagId } : {}),
      subgroups: uniqueNames(rec.subgroups, UPLOAD_MAX_TRACKER_SUBFOLDERS),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '',
    })
    if (out.length >= UPLOAD_MAX_TRACKER_FOLDERS) break
  }
  return out
}

export type TrackerFolderError = 'invalid' | 'duplicate' | 'limit' | 'not_found'

type FolderOpResult =
  | { ok: true; folders: UploadGscTrackerFolder[]; trackers: UploadGscTracker[] }
  | { ok: false; error: TrackerFolderError }

const fail = (error: TrackerFolderError): FolderOpResult => ({ ok: false, error })

/** Pure folder/keyword-group operation (never mutates inputs). A folder exists if it has a record or any tracker has that group. */
export function applyTrackerFolderOp(
  folders: UploadGscTrackerFolder[],
  trackers: UploadGscTracker[],
  op: unknown,
  validOwnerIds: ReadonlySet<string>,
  nowIso: string,
): FolderOpResult {
  if (!op || typeof op !== 'object') return fail('invalid')
  const o = op as Record<string, unknown>
  const kind = o.op
  if (typeof kind !== 'string' || !['create', 'createSub', 'rename', 'renameSub', 'owner', 'delete', 'deleteSub'].includes(kind)) return fail('invalid')

  const exists = (name: string) => folders.some((f) => f.name === name) || trackers.some((t) => t.group === name)
  const recordOf = (name: string): UploadGscTrackerFolder =>
    folders.find((f) => f.name === name) ?? { name, subgroups: [], createdAt: nowIso }
  /** Copy of folders with `rec` replacing (or appended for) the record of `name` */
  const putRecord = (name: string, rec: UploadGscTrackerFolder): UploadGscTrackerFolder[] =>
    folders.some((f) => f.name === name) ? folders.map((f) => (f.name === name ? rec : f)) : [...folders, rec]
  const inFolder = (t: UploadGscTracker, name: string) => t.group === name
  const subExists = (folder: string, sub: string) =>
    !!folders.find((f) => f.name === folder)?.subgroups.includes(sub) || trackers.some((t) => inFolder(t, folder) && t.subgroup === sub)
  const withoutSub = (t: UploadGscTracker): UploadGscTracker => { const n = { ...t }; delete n.subgroup; return n }

  if (kind === 'create') {
    const name = normalizeTrackerGroup(o.name)
    if (!name) return fail('invalid')
    if (exists(name)) return fail('duplicate')
    if (folders.length >= UPLOAD_MAX_TRACKER_FOLDERS) return fail('limit')
    const owner = normalizeTrackerOwner(o.ownerTagId, validOwnerIds)
    return { ok: true, folders: [...folders, { name, ...(owner ? { ownerTagId: owner } : {}), subgroups: [], createdAt: nowIso }], trackers }
  }

  const folder = normalizeTrackerGroup(o.folder)
  if (!folder) return fail('invalid')
  if (!exists(folder)) return fail('not_found')

  if (kind === 'createSub') {
    const sub = normalizeTrackerGroup(o.subgroup)
    if (!sub) return fail('invalid')
    if (subExists(folder, sub)) return fail('duplicate')
    const rec = recordOf(folder)
    if (rec.subgroups.length >= UPLOAD_MAX_TRACKER_SUBFOLDERS) return fail('limit')
    const ids = new Set(Array.isArray(o.ids) ? o.ids.filter((v): v is string => typeof v === 'string') : [])
    return {
      ok: true,
      folders: putRecord(folder, { ...rec, subgroups: [...rec.subgroups, sub] }),
      trackers: ids.size ? trackers.map((t) => (ids.has(t.id) && inFolder(t, folder) ? { ...t, subgroup: sub } : t)) : trackers,
    }
  }

  if (kind === 'rename') {
    const name = normalizeTrackerGroup(o.name)
    if (!name) return fail('invalid')
    if (name === folder) return { ok: true, folders, trackers }
    const old = recordOf(folder)
    const targetExists = exists(name)
    const target = recordOf(name)
    const merged: UploadGscTrackerFolder = targetExists
      ? { ...target, subgroups: uniqueNames([...target.subgroups, ...old.subgroups], UPLOAD_MAX_TRACKER_SUBFOLDERS) }
      : { ...old, name }
    const rest = folders.filter((f) => f.name !== folder && f.name !== name)
    const nextFolders = [...rest, merged]
    // keep the original position of the surviving record
    const order = folders.map((f) => (f.name === folder ? name : f.name))
    nextFolders.sort((a, b) => {
      const ia = order.indexOf(a.name), ib = order.indexOf(b.name)
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
    })
    return { ok: true, folders: nextFolders, trackers: trackers.map((t) => (inFolder(t, folder) ? { ...t, group: name } : t)) }
  }

  if (kind === 'renameSub') {
    const sub = normalizeTrackerGroup(o.subgroup)
    if (!sub) return fail('invalid')
    if (!subExists(folder, sub)) return fail('not_found')
    const name = normalizeTrackerGroup(o.name)
    const rec = recordOf(folder)
    if (!name) {
      return {
        ok: true,
        folders: folders.some((f) => f.name === folder) ? putRecord(folder, { ...rec, subgroups: rec.subgroups.filter((s) => s !== sub) }) : folders,
        trackers: trackers.map((t) => (inFolder(t, folder) && t.subgroup === sub ? withoutSub(t) : t)),
      }
    }
    if (name === sub) return { ok: true, folders, trackers }
    const subgroups = uniqueNames(rec.subgroups.map((s) => (s === sub ? name : s)).concat(rec.subgroups.includes(sub) ? [] : [name]), UPLOAD_MAX_TRACKER_SUBFOLDERS)
    return {
      ok: true,
      folders: putRecord(folder, { ...rec, subgroups }),
      trackers: trackers.map((t) => (inFolder(t, folder) && t.subgroup === sub ? { ...t, subgroup: name } : t)),
    }
  }

  if (kind === 'owner') {
    const owner = normalizeTrackerOwner(o.ownerTagId, validOwnerIds)
    const rec = { ...recordOf(folder) }
    if (owner) rec.ownerTagId = owner; else delete rec.ownerTagId
    return {
      ok: true,
      folders: putRecord(folder, rec),
      trackers: trackers.map((t) => {
        if (!inFolder(t, folder)) return t
        const n = { ...t }
        if (owner) n.ownerTagId = owner; else delete n.ownerTagId
        return n
      }),
    }
  }

  if (kind === 'delete') {
    return {
      ok: true,
      folders: folders.filter((f) => f.name !== folder),
      trackers: trackers.map((t) => {
        if (!inFolder(t, folder)) return t
        const n = withoutSub(t)
        delete n.group
        return n
      }),
    }
  }

  if (kind === 'deleteSub') {
    const sub = normalizeTrackerGroup(o.subgroup)
    if (!sub) return fail('invalid')
    if (!subExists(folder, sub)) return fail('not_found')
    return {
      ok: true,
      folders: folders.map((f) => (f.name === folder ? { ...f, subgroups: f.subgroups.filter((s) => s !== sub) } : f)),
      trackers: trackers.map((t) => (inFolder(t, folder) && t.subgroup === sub ? withoutSub(t) : t)),
    }
  }

  return fail('invalid')
}

// ── ผลรายวันของ 1 รายการ ─────────────────────────────────────────────────────────

export interface GscTrackerSeries {
  daily: GscDailyPoint[]
  totals: GscMetric
  /** ข้อความหน้าแบบที่ GSC ส่งมาจริงที่นับรวมเข้ารายการนี้ (ว่าง = ช่วงนี้ไม่มีข้อมูลของคำ+หน้านี้; ชนิด keyword ว่างเสมอ) */
  matchedPages: string[]
  /** true = มีแถวข้อมูลจาก GSC อย่างน้อย 1 วันในช่วงนี้ */
  hasData: boolean
}

/**
 * regex (RE2) สำหรับ filter page ของ GSC ให้ได้เฉพาะหน้านี้ — GSC เทียบกับข้อความดิบ จึงรวมทั้ง http/https,
 * / ท้าย, path แบบ decode และแบบ percent-encode (ตัวพิมพ์ใหญ่/เล็ก) ไว้ด้วยกัน
 * ผลที่ได้ยังต้องผ่าน buildTrackerSeries ซึ่งเทียบด้วย trackerUrlKey อีกชั้น (regex กว้างได้ ไม่ทำให้นับผิด)
 * คืน '' ถ้า URL อ่านไม่ได้
 */
export function buildTrackerPageRegex(url: string): string {
  let u: URL
  try { u = new URL(url.trim()) } catch { return '' }
  const host = u.hostname.toLowerCase()
  const rawPath = u.pathname.replace(/\/+$/, '')
  let decoded = rawPath
  try { decoded = decodeURIComponent(rawPath) } catch { /* เก็บ path เดิม */ }
  let encoded = decoded
  try { encoded = encodeURI(decoded) } catch { /* surrogate เสีย — ใช้ path เดิม */ }
  const lowerHex = encoded.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())
  const paths = Array.from(new Set([rawPath, decoded, encoded, lowerHex])).map(escapeRe2)
  const pathPart = paths.length === 1 ? paths[0] : `(${paths.join('|')})`
  return `^https?://${escapeRe2(host)}${pathPart}/?$`
}

const DAY_MS = 86400000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** กันช่วงวันผิดปกติทำ loop ยาว (ช่วงรายงานจริงสูงสุด ~1 ปี) */
const MAX_FILL_DAYS = 800

function listDates(start: string, end: string): string[] {
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) return []
  const out: string[] = []
  let t = new Date(`${start}T00:00:00Z`).getTime()
  const endT = new Date(`${end}T00:00:00Z`).getTime()
  while (t <= endT && out.length < MAX_FILL_DAYS) {
    out.push(new Date(t).toISOString().slice(0, 10))
    t += DAY_MS
  }
  return out
}

/**
 * แปลงแถว GSC เป็นเส้นรายวัน
 * - url มีค่า: แถวเป็น dimensions ['date','page'] — นับเฉพาะแถวที่หน้าตรงกับ url (เทียบแบบ normalize — http/https, / ท้าย, percent-encoding)
 * - url = '' (ชนิด keyword): แถวเป็น dimensions ['date'] ของทั้งเว็บ — นับทุกแถว
 * - GSC ไม่ส่งวันที่ไม่มีการแสดงผล → เติม 0 ให้ครบทุกวันในช่วง ไม่งั้นเส้นกราฟจะลากข้ามวันที่ว่าง
 * - lastDataDate = วันล่าสุดที่ GSC มีข้อมูลแน่นอน: ไม่เติม 0 หลังวันนั้น (ข้อมูลยังไม่มา ≠ 0)
 */
export function buildTrackerSeries(
  rows: RawGscRow[],
  url: string,
  start: string,
  end: string,
  lastDataDate?: string,
): GscTrackerSeries {
  const target = url ? trackerUrlKey(url) : ''
  const byDate = new Map<string, { clicks: number; impressions: number; posWeighted: number }>()
  const matched = new Set<string>()
  for (const r of rows) {
    const date = r.keys?.[0] ?? ''
    if (!DATE_RE.test(date)) continue
    if (target) {
      const page = r.keys?.[1] ?? ''
      if (!page || trackerUrlKey(page) !== target) continue
      matched.add(page)
    }
    const clicks = r.clicks ?? 0
    const impressions = r.impressions ?? 0
    const position = r.position ?? 0
    const cur = byDate.get(date) ?? { clicks: 0, impressions: 0, posWeighted: 0 }
    cur.clicks += clicks
    cur.impressions += impressions
    cur.posWeighted += position * impressions
    byDate.set(date, cur)
  }

  let fillEnd = lastDataDate && DATE_RE.test(lastDataDate) && lastDataDate < end ? lastDataDate : end
  for (const d of Array.from(byDate.keys())) {
    if (d > fillEnd && d <= end) fillEnd = d
  }
  const dates = new Set<string>(listDates(start, fillEnd))
  for (const d of Array.from(byDate.keys())) dates.add(d)

  const daily: GscDailyPoint[] = Array.from(dates).sort().map((date) => {
    const v = byDate.get(date)
    if (!v) return { date, clicks: 0, impressions: 0, ctr: 0, position: 0 }
    return {
      date,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      position: v.impressions > 0 ? v.posWeighted / v.impressions : 0,
    }
  })

  let clicks = 0
  let impressions = 0
  let posWeighted = 0
  for (const v of Array.from(byDate.values())) {
    clicks += v.clicks
    impressions += v.impressions
    posWeighted += v.posWeighted
  }
  const totals: GscMetric = {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeighted / impressions : 0,
  }
  return { daily, totals, matchedPages: Array.from(matched).sort(), hasData: byDate.size > 0 }
}

// ── รูปแบบผลของ POST /report/trackers/performance (ใช้ร่วมกัน route + หน้าเว็บ) ──────────

export interface GscTrackerPerformance extends UploadGscTracker {
  kind: GscTrackerKind
  /** URL ที่ใช้เทียบกับ GSC จริง — ปกติ = url, ถ้า url เป็นแบบ ?p=123 จะเป็นลิงก์จริงที่เว็บ redirect ไป ('' = ชนิด keyword) */
  matchUrl: string
  /** true = GSC มีข้อมูลอย่างน้อย 1 วันในช่วงปัจจุบัน */
  hasData: boolean
  /** true = url เป็นแบบ ?p=123 และยังหาลิงก์จริงไม่ได้ (เช่น บทความยังไม่ publish) จึงยังไม่มีข้อมูลให้แสดง */
  unresolved: boolean
  matchedPages: string[]
  totals: GscMetric
  prevTotals: GscMetric
  daily: GscDailyPoint[]
  dailyPrev: GscDailyPoint[]
  /** Site queries similar to this keyword (keyword and keyword+page trackers only), found automatically */
  similar?: GscSimilarKeyword[]
}

export interface GscTrackerPerformanceResponse {
  period: ReportPeriod & { siteUrl: string; searchType: ReportSearchType; fetchedAt: string }
  trackers: GscTrackerPerformance[]
}

// ── ผลรวมของหลายรายการ (เช่น ทุกรายการของผู้ดูแลคนหนึ่ง) สำหรับ KPI + กราฟด้านบนของ Report ──────────

export interface GscTrackerAggregate {
  /** จำนวนรายการที่นำมารวม (ไม่นับ unresolved) */
  count: number
  overview: GscOverview
  daily: GscDailyPoint[]
  dailyPrev: GscDailyPoint[]
}

function sumDaily(series: GscDailyPoint[][]): GscDailyPoint[] {
  const byDate = new Map<string, { clicks: number; impressions: number; posWeighted: number }>()
  for (const list of series) {
    for (const p of list) {
      const cur = byDate.get(p.date) ?? { clicks: 0, impressions: 0, posWeighted: 0 }
      cur.clicks += p.clicks
      cur.impressions += p.impressions
      cur.posWeighted += p.position * p.impressions
      byDate.set(p.date, cur)
    }
  }
  return Array.from(byDate.keys()).sort().map((date) => {
    const v = byDate.get(date)!
    return {
      date,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      position: v.impressions > 0 ? v.posWeighted / v.impressions : 0,
    }
  })
}

function sumMetric(list: GscMetric[]): GscMetric {
  let clicks = 0
  let impressions = 0
  let posWeighted = 0
  for (const m of list) {
    clicks += m.clicks
    impressions += m.impressions
    posWeighted += m.position * m.impressions
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeighted / impressions : 0,
  }
}

/**
 * รวมผลของหลายรายการเป็นชุดเดียว: คลิก/การแสดงผลบวกกัน, CTR = คลิก/การแสดงผล, อันดับถ่วงตามการแสดงผล
 * — สูตรเดียวกับผลรวมหัวกลุ่มในตาราง Keyword ที่ติดตาม ตัวเลขด้านบนจึงตรงกับตาราง
 * รายการที่ซ้อนกัน (เช่น keyword เดียวกันทั้งเว็บ + บนหน้าหนึ่ง) ถูกนับซ้ำ เหมือนหัวกลุ่ม
 * ไม่มีรายการที่ใช้ได้ = null
 */
export function aggregateTrackerPerformance(list: readonly GscTrackerPerformance[]): GscTrackerAggregate | null {
  const usable = list.filter((p) => !p.unresolved)
  if (!usable.length) return null
  return {
    count: usable.length,
    overview: overviewFromMetrics(sumMetric(usable.map((p) => p.totals)), sumMetric(usable.map((p) => p.prevTotals))),
    daily: sumDaily(usable.map((p) => p.daily)),
    dailyPrev: sumDaily(usable.map((p) => p.dailyPrev)),
  }
}

// ── หาคำใกล้เคียง + เพิ่มหลายคำพร้อมกัน ──

/**
 * เพิ่ม keyword หลายคำ (ชนิด keyword ทั้งเว็บ) เข้ากลุ่มเดียวกัน — ข้ามคำที่ติดตามอยู่แล้ว/คำว่าง และหยุดเมื่อเต็มเพดาน
 * ลำดับในรายการ = ลำดับที่ส่งมา (คำแรกอยู่บนสุด)
 */
export function addGscTrackersBulk(
  existing: UploadGscTracker[],
  keywords: readonly unknown[],
  opts: { group?: unknown; ownerTagId?: unknown; subgroup?: unknown },
  newId: () => string,
  nowIso: string,
  validOwnerIds?: ReadonlySet<string>,
): { trackers: UploadGscTracker[]; added: UploadGscTracker[]; duplicates: number; invalid: number; overLimit: number } {
  let trackers = existing
  const added: UploadGscTracker[] = []
  let duplicates = 0, invalid = 0, overLimit = 0
  for (const kw of keywords) {
    const r = addGscTracker(trackers, { kind: 'keyword', keyword: kw, group: opts.group, subgroup: opts.subgroup, ownerTagId: opts.ownerTagId }, newId, nowIso, validOwnerIds)
    if (r.ok) { trackers = r.trackers; added.push(r.tracker); continue }
    if (r.error === 'limit') overLimit++
    else if (r.error.startsWith('duplicate')) duplicates++
    else invalid++
  }
  // addGscTracker ใส่ไว้บนสุดทีละคำ → เรียงคำที่เพิ่มใหม่ตามลำดับที่ส่งมา
  if (added.length > 1) {
    const ids = new Set(added.map((t) => t.id))
    trackers = [...added, ...trackers.filter((t) => !ids.has(t.id))]
  }
  return { trackers, added, duplicates, invalid, overLimit }
}

export interface GscKeywordSuggestion extends GscMetric {
  keyword: string
  prevClicks: number
  prevImpressions: number
  prevPosition: number
  /** ติดตามแบบ keyword ทั้งเว็บอยู่แล้ว */
  tracked: boolean
}

export interface GscKeywordSuggestResponse {
  term: string
  suggestions: GscKeywordSuggestion[]
  /** ช่องที่ยังเพิ่มได้ก่อนเต็มเพดาน */
  remaining: number
  limit: number
}

/**
 * คำค้นหาจาก GSC ที่มีคำหลักอยู่ (แถวมิติ query) → รายการให้ติ๊กเลือก เรียงตามคลิก แล้วการแสดงผล
 * exclude = คำที่ห้ามแสดง (เช่นคำต้องห้าม) — ตัดซ้ำตาม normalizeTrackerKeyword
 */
export function buildKeywordSuggestions(
  curRows: readonly RawGscRow[],
  prevRows: readonly RawGscRow[],
  existing: readonly UploadGscTracker[],
  opts: { limit?: number; exclude?: (keyword: string) => boolean } = {},
): GscKeywordSuggestion[] {
  const tracked = new Set(existing.filter((t) => trackerKind(t) === 'keyword').map((t) => t.keyword))
  const prev = new Map<string, RawGscRow>()
  for (const r of prevRows) {
    const k = normalizeTrackerKeyword(r.keys?.[0])
    if (k && !prev.has(k)) prev.set(k, r)
  }
  const seen = new Set<string>()
  const out: GscKeywordSuggestion[] = []
  for (const r of curRows) {
    const keyword = normalizeTrackerKeyword(r.keys?.[0])
    if (!keyword || seen.has(keyword) || opts.exclude?.(keyword)) continue
    seen.add(keyword)
    const p = prev.get(keyword)
    out.push({
      keyword,
      clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0,
      prevClicks: p?.clicks ?? 0, prevImpressions: p?.impressions ?? 0, prevPosition: p?.position ?? 0,
      tracked: tracked.has(keyword),
    })
  }
  out.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.keyword.localeCompare(b.keyword))
  return out.slice(0, opts.limit ?? 200)
}

/**
 * รวม keyword หลายคำเป็น regex ชุดละไม่เกิน maxCount คำ/maxLen ตัวอักษร: (?i)^(?:a|b)$
 * ใช้ยิง GSC ครั้งเดียวต่อชุด (มิติ date+query) แทนยิงทีละคำ — 25 คำ × 365 วัน ยังไม่ถึง rowLimit 25,000
 */
export function chunkKeywordRegex(keywords: readonly string[], maxCount = 25, maxLen = 3500): { regex: string; keywords: string[] }[] {
  const out: { regex: string; keywords: string[] }[] = []
  let cur: string[] = []
  let len = 0
  const flush = () => {
    if (cur.length) out.push({ regex: `(?i)^(?:${cur.map(escapeRe2).join('|')})$`, keywords: cur })
    cur = []; len = 0
  }
  for (const kw of Array.from(new Set(keywords.filter(Boolean)))) {
    const piece = escapeRe2(kw).length + 1
    if (cur.length >= maxCount || (cur.length && len + piece > maxLen - 16)) flush()
    cur.push(kw); len += piece
  }
  flush()
  return out
}

/**
 * แยกแถวที่มิติ query อยู่ลำดับที่ 2 ตาม keyword → แถวที่ตัดมิติ query ออก
 * (date, query) → (date) สำหรับ keyword ทั้งเว็บ; (date, query, page) → (date, page) สำหรับ keyword + หน้า
 */
export function splitRowsByQuery(rows: readonly RawGscRow[]): Map<string, RawGscRow[]> {
  const out = new Map<string, RawGscRow[]>()
  for (const r of rows) {
    const date = r.keys?.[0]
    const kw = normalizeTrackerKeyword(r.keys?.[1])
    if (!date || !kw) continue
    const row: RawGscRow = { ...r, keys: [date, ...(r.keys ?? []).slice(2)] }
    const list = out.get(kw)
    if (list) list.push(row); else out.set(kw, [row])
  }
  return out
}

// ── Similar keywords (shown automatically under each tracked keyword) ──────────
// The team should not have to search for variants by hand: every keyword tracker gets the
// site's GSC queries that share most of its words (e.g. "chatgpt ads รับทำ" for "รับทำ chatgpt ads").
// A query is shown under one tracker only: the keyword it is closest to.

/** Similar keywords kept per tracker, best first */
export const SIMILAR_PER_TRACKER = 10

export interface GscSimilarKeyword {
  keyword: string
  totals: GscMetric
  prevTotals: GscMetric
}

/** Words kept per keyword for scoring; the GSC regex uses only the longest SIMILAR_REGEX_TOKENS */
const SIMILAR_MAX_TOKENS = 12
const SIMILAR_REGEX_TOKENS = 6

let thaiWordSegmenter: Intl.Segmenter | null = null

/** Latin letters or digits (keywords are lowercased) — in a Thai keyword these name the brand, platform or model */
function isLatinToken(token: string): boolean {
  return /^[a-z0-9]/.test(token)
}

/**
 * Every word of a normalized text, in order. Thai has no spaces, so Intl.Segmenter splits it
 * ("รับยิงแอด" → รับ, ยิง, แอด); Thai glued to Latin ("โฆษณาtiktok") is split first. One-character
 * Thai pieces are dropped as noise, one-character Latin/digits are kept ("iphone 5").
 */
function similarWords(text: string): string[] {
  if (!text) return []
  thaiWordSegmenter ??= new Intl.Segmenter('th', { granularity: 'word' })
  const spaced = text.replace(/([฀-๿])([a-z0-9])/g, '$1 $2').replace(/([a-z0-9])([฀-๿])/g, '$1 $2')
  const out: string[] = []
  for (const s of Array.from(thaiWordSegmenter.segment(spaced))) {
    const w = s.segment.trim()
    if (!s.isWordLike || !w) continue
    if (!isLatinToken(w) && Array.from(w).length < 2) continue
    out.push(w)
  }
  return out
}

/** Distinct words of a keyword for similarity matching, longest first, at most 12 */
export function similarTokens(keyword: string): string[] {
  const words = Array.from(new Set(similarWords(normalizeTrackerKeyword(keyword))))
  return words.sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, SIMILAR_MAX_TOKENS)
}

/**
 * How close a query is to a keyword: 0 = not similar, 1 = the same words. Rules, in order:
 * - Latin/digit words must match a whole query word ("ig" is not inside "digital"); Thai words match as text.
 * - A Thai keyword with Latin words (brand, platform, model) needs all of them: "รับยิงโฆษณา ig" is
 *   not similar to "รับยิงโฆษณา tiktok".
 * - At least two keyword words (the one word, for one-word keywords) and half the keyword by length.
 * - A query that both drops keyword words and adds its own (a swap, e.g. another platform written
 *   in Thai) must keep 70% of the keyword. Not applied once a Thai keyword's Latin words all match:
 *   "รับยิงแอด ig" stays similar to "รับยิงโฆษณา ig".
 * The score is matched length / (keyword length + length of the query's extra words).
 */
function scoreSimilar(query: string, queryWords: readonly string[], tokens: readonly string[]): number {
  if (!tokens.length) return 0
  const wordSet = new Set(queryWords)
  const mixed = tokens.some(isLatinToken) && tokens.some((t) => !isLatinToken(t))
  let total = 0
  let hit = 0
  let matched = 0
  for (const t of tokens) {
    total += t.length
    const latin = isLatinToken(t)
    if (latin ? wordSet.has(t) : query.includes(t)) { hit += t.length; matched++ }
    else if (latin && mixed) return 0
  }
  if (matched < Math.min(2, tokens.length) || hit * 2 < total) return 0
  let extra = 0
  for (const w of Array.from(wordSet)) {
    const covered = isLatinToken(w)
      ? tokens.includes(w)
      : tokens.some((t) => !isLatinToken(t) && (t.includes(w) || w.includes(t)))
    if (!covered) extra += w.length
  }
  if (!mixed && matched < tokens.length && extra > 0 && hit < total * 0.7) return 0
  return hit / (total + extra)
}

/** Similarity of one query to a keyword's words (see scoreSimilar); 0 = not similar */
export function similarScore(query: string, tokens: readonly string[]): number {
  const q = normalizeTrackerKeyword(query)
  return scoreSimilar(q, similarWords(q), tokens)
}

export function isSimilarQuery(query: string, tokens: readonly string[]): boolean {
  return similarScore(query, tokens) > 0
}

/**
 * Word pairs for the GSC pre-filter, strongest first, at most 15.
 * - Thai keyword with Latin words: the longest Latin word with the next Latin word, or with each
 *   Thai word when it is the only one (every similar query has it plus one more word).
 * - Otherwise: pairs that cover half the keyword's length; when none does, pairs with the longest word.
 */
function similarPairs(all: readonly string[]): [string, string][] {
  const latin = all.filter(isLatinToken)
  const thai = all.filter((t) => !isLatinToken(t))
  if (latin.length && thai.length) {
    if (latin.length > 1) return [[latin[0], latin[1]]]
    return thai.slice(0, SIMILAR_REGEX_TOKENS - 1).map((t): [string, string] => [latin[0], t])
  }
  const tokens = all.slice(0, SIMILAR_REGEX_TOKENS)
  const total = tokens.reduce((n, t) => n + t.length, 0)
  const pairs: [string, string, number][] = []
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) pairs.push([tokens[i], tokens[j], tokens[i].length + tokens[j].length])
  }
  pairs.sort((a, b) => b[2] - a[2])
  let keep = pairs.filter((p) => p[2] * 2 >= total)
  if (!keep.length) keep = pairs.filter((p) => p[0] === tokens[0] || p[1] === tokens[0])
  return keep.slice(0, 15).map(([a, b]) => [a, b])
}

/**
 * RE2 pre-filter for GSC (partial match, no flags): queries that contain a word pair from
 * similarPairs in either order. It only narrows what GSC returns; scoreSimilar decides.
 * Returns '' when the keyword has no usable words.
 */
export function buildSimilarRegex(tokens: readonly string[]): string {
  if (tokens.length === 0) return ''
  if (tokens.length === 1) return escapeRe2(tokens[0])
  return similarPairs(tokens)
    .map(([a, b]) => `${escapeRe2(a)}.*${escapeRe2(b)}|${escapeRe2(b)}.*${escapeRe2(a)}`)
    .join('|')
}

/**
 * Packs several keywords' similar regexes into one GSC call each (dimension query only, so rows
 * stay few): (?i)(?:r1|r2|...). Keywords without usable words are skipped.
 */
export function chunkSimilarRegex(keywords: readonly string[], maxCount = 15, maxLen = 3500): { regex: string; keywords: string[] }[] {
  const out: { regex: string; keywords: string[] }[] = []
  let parts: string[] = []
  let kws: string[] = []
  let len = 0
  const flush = () => {
    if (parts.length) out.push({ regex: `(?i)(?:${parts.join('|')})`, keywords: kws })
    parts = []; kws = []; len = 0
  }
  for (const kw of Array.from(new Set(keywords.map(normalizeTrackerKeyword).filter(Boolean)))) {
    const re = buildSimilarRegex(similarTokens(kw))
    if (!re || re.length > maxLen - 16) continue
    const piece = `(?:${re})`
    if (parts.length >= maxCount || (parts.length && len + piece.length + 1 > maxLen - 16)) flush()
    parts.push(piece); kws.push(kw); len += piece.length + 1
  }
  flush()
  return out
}

interface SimilarOptions {
  limit?: number
  skip?: ReadonlySet<string>
  exclude?: (keyword: string) => boolean
}

/**
 * Similar queries for a set of tracked keywords, from GSC rows with dimension [query] (current +
 * compare period). Each query goes to one keyword only, so "ยิงแอด ig ราคา" sits under the ig
 * keyword and not under every keyword about ads: first the keyword that shares the most Latin
 * words (brand, platform) with the query, then the highest score.
 * Leaves out the keywords themselves under their own row, `skip` (keywords already tracked on
 * their own) and `exclude` (forbidden words). Only queries seen in the current period; each list
 * is sorted by clicks, then impressions. The map is keyed by normalized keyword.
 */
export function assignSimilarKeywords(
  curRows: readonly RawGscRow[],
  prevRows: readonly RawGscRow[],
  keywords: readonly string[],
  opts: SimilarOptions = {},
): Map<string, GscSimilarKeyword[]> {
  const targets = Array.from(new Set(keywords.map(normalizeTrackerKeyword).filter(Boolean)))
    .map((keyword) => { const tokens = similarTokens(keyword); return { keyword, tokens, latin: tokens.filter(isLatinToken) } })
    .filter((t) => t.tokens.length > 0)
  const out = new Map<string, GscSimilarKeyword[]>(targets.map((t) => [t.keyword, []]))
  if (!targets.length) return out
  const metric = (r?: RawGscRow): GscMetric => ({
    clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, ctr: r?.ctr ?? 0, position: r?.position ?? 0,
  })
  const prev = new Map<string, RawGscRow>()
  for (const r of prevRows) {
    const k = normalizeTrackerKeyword(r.keys?.[0])
    if (k && !prev.has(k)) prev.set(k, r)
  }
  const seen = new Set<string>()
  for (const r of curRows) {
    const kw = normalizeTrackerKeyword(r.keys?.[0])
    if (!kw || seen.has(kw)) continue
    seen.add(kw)
    if (opts.skip?.has(kw) || opts.exclude?.(kw)) continue
    const words = similarWords(kw)
    let best = ''
    let bestScore = 0
    let bestLatin = 0
    for (const t of targets) {
      if (t.keyword === kw) continue
      const score = scoreSimilar(kw, words, t.tokens)
      if (score <= 0) continue
      const latin = t.latin.filter((w) => words.includes(w)).length
      if (latin > bestLatin || (latin === bestLatin && score > bestScore)) { best = t.keyword; bestScore = score; bestLatin = latin }
    }
    if (best) out.get(best)!.push({ keyword: kw, totals: metric(r), prevTotals: metric(prev.get(kw)) })
  }
  const limit = opts.limit ?? SIMILAR_PER_TRACKER
  for (const [keyword, list] of Array.from(out.entries())) {
    list.sort((a, b) => b.totals.clicks - a.totals.clicks || b.totals.impressions - a.totals.impressions || a.keyword.localeCompare(b.keyword))
    out.set(keyword, list.slice(0, limit))
  }
  return out
}

/** Similar queries of one keyword on its own (no other keywords to share the queries with) */
export function pickSimilarKeywords(
  curRows: readonly RawGscRow[],
  prevRows: readonly RawGscRow[],
  keyword: string,
  opts: SimilarOptions = {},
): GscSimilarKeyword[] {
  return assignSimilarKeywords(curRows, prevRows, [keyword], opts).get(normalizeTrackerKeyword(keyword)) ?? []
}

/** Response of POST /report/trackers/query-series: one query's daily line, for the chart under a similar keyword */
export interface GscQuerySeriesResponse {
  keyword: string
  hasData: boolean
  totals: GscMetric
  prevTotals: GscMetric
  daily: GscDailyPoint[]
  dailyPrev: GscDailyPoint[]
}
