// ─── Upload Article — Report: keyword + URL ที่ทีมกด "บันทึก Monitor" ไว้ติดตาม ──────────
// คำนวณล้วน ไม่พึ่ง prisma/session (เรียกจาก unit test และจากฝั่ง client ได้)
// เก็บใน UploadClient.pushPrefs.gscTrackers (JSON เดิม ไม่แก้ schema) เขียนผ่าน updatePrefs เท่านั้น

import {
  normalizeReportUrl,
  type GscDailyPoint, type GscMetric, type RawGscRow, type ReportPeriod, type ReportSearchType,
} from './gsc-report'

export interface UploadGscTracker {
  id: string
  /** คำค้นหาแบบที่ GSC เก็บ (ตัวพิมพ์เล็ก เว้นวรรคเดี่ยว) */
  keyword: string
  url: string
  /** ชื่อบทความ (มีเมื่อเลือก URL จากรายการบทความ) — ใช้แสดงผลอย่างเดียว ไม่ใช้เทียบข้อมูล */
  title?: string
  /** URL แบบ ?p=123 ที่ผู้ใช้เลือกไว้ตอนบันทึก (มีเมื่อระบบแปลงเป็นลิงก์จริงแล้วเก็บลง url) — ใช้บอกว่าแถวนั้น "ติดตามแล้ว" */
  sourceUrl?: string
  createdAt: string
}

/** key ทั้งหมดของรายการ (url ที่ใช้จริง + sourceUrl ถ้ามี) — ใช้เช็กซ้ำและเช็ก "ติดตามแล้ว" */
export function trackerKeys(t: Pick<UploadGscTracker, 'keyword' | 'url' | 'sourceUrl'>): string[] {
  const keys = [trackerKey(t.keyword, t.url)]
  if (t.sourceUrl) keys.push(trackerKey(t.keyword, t.sourceUrl))
  return keys
}

export const UPLOAD_MAX_GSC_TRACKERS = 30
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

/** key กันซ้ำ: คำเดียวกัน + หน้าเดียวกัน */
export function trackerKey(keyword: string, url: string): string {
  return `${normalizeTrackerKeyword(keyword)}\u0001${trackerUrlKey(url)}`
}

/** sourceUrl เก็บเฉพาะเมื่อเป็น URL ที่ถูกต้องและเป็นคนละหน้ากับ url — ไม่งั้น '' */
function normalizeSourceUrl(raw: unknown, url: string): string {
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
    if (!id || !keyword || !url || seenIds.has(id)) continue
    const key = trackerKey(keyword, url)
    if (seenKeys.has(key)) continue
    seenIds.add(id)
    seenKeys.add(key)
    const title = normalizeTrackerTitle(rec.title)
    const sourceUrl = normalizeSourceUrl(rec.sourceUrl, url)
    out.push({ id, keyword, url, ...(title ? { title } : {}), ...(sourceUrl ? { sourceUrl } : {}), createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '' })
    if (out.length >= UPLOAD_MAX_GSC_TRACKERS) break
  }
  return out
}

export type GscTrackerError = 'invalid_keyword' | 'invalid_url' | 'duplicate' | 'limit'

export const GSC_TRACKER_ERROR_MESSAGES: Record<GscTrackerError, string> = {
  invalid_keyword: 'กรอก keyword ที่ต้องการติดตาม',
  invalid_url: 'URL ไม่ถูกต้อง — ใส่ลิงก์เต็มของหน้า เช่น https://example.com/blog/post',
  duplicate: 'keyword + URL นี้บันทึก Monitor ไว้แล้ว',
  limit: `บันทึก Monitor ได้สูงสุด ${UPLOAD_MAX_GSC_TRACKERS} รายการ — ลบรายการที่ไม่ใช้ก่อน`,
}

export type AddGscTrackerResult =
  | { ok: true; trackers: UploadGscTracker[]; tracker: UploadGscTracker }
  | { ok: false; error: GscTrackerError }

/** เพิ่มรายการใหม่ (ไม่แก้ array เดิม) — รายการใหม่อยู่บนสุด */
export function addGscTracker(
  existing: UploadGscTracker[],
  input: { keyword?: unknown; url?: unknown; title?: unknown; sourceUrl?: unknown },
  newId: () => string,
  nowIso: string,
): AddGscTrackerResult {
  const title = normalizeTrackerTitle(input.title)
  const keyword = normalizeTrackerKeyword(input.keyword)
  if (!keyword) return { ok: false, error: 'invalid_keyword' }
  const url = normalizeTrackerUrl(input.url)
  if (!url) return { ok: false, error: 'invalid_url' }
  const sourceUrl = normalizeSourceUrl(input.sourceUrl, url)
  const newKeys = trackerKeys({ keyword, url, sourceUrl })
  if (existing.some((t) => trackerKeys(t).some((k) => newKeys.includes(k)))) return { ok: false, error: 'duplicate' }
  if (existing.length >= UPLOAD_MAX_GSC_TRACKERS) return { ok: false, error: 'limit' }
  let id = newId()
  for (let i = 0; i < 5 && existing.some((t) => t.id === id); i++) id = newId()
  const tracker: UploadGscTracker = { id, keyword, url, ...(title ? { title } : {}), ...(sourceUrl ? { sourceUrl } : {}), createdAt: nowIso }
  return { ok: true, trackers: [tracker, ...existing], tracker }
}

export function removeGscTracker(existing: UploadGscTracker[], id: string): UploadGscTracker[] {
  return existing.filter((t) => t.id !== id)
}

// ── ผลรายวันของ 1 รายการ ─────────────────────────────────────────────────────────

export interface GscTrackerSeries {
  daily: GscDailyPoint[]
  totals: GscMetric
  /** ข้อความหน้าแบบที่ GSC ส่งมาจริงที่นับรวมเข้ารายการนี้ (ว่าง = ช่วงนี้ไม่มีข้อมูลของคำ+หน้านี้) */
  matchedPages: string[]
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
 * แปลงแถว GSC (dimensions = ['date','page'] ที่กรอง query = keyword แล้ว) เป็นเส้นรายวันของหน้าเดียว
 * - นับเฉพาะแถวที่หน้าตรงกับ url (เทียบแบบ normalize — http/https, / ท้าย, percent-encoding)
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
  const target = trackerUrlKey(url)
  const byDate = new Map<string, { clicks: number; impressions: number; posWeighted: number }>()
  const matched = new Set<string>()
  for (const r of rows) {
    const date = r.keys?.[0] ?? ''
    const page = r.keys?.[1] ?? ''
    if (!DATE_RE.test(date) || !page || trackerUrlKey(page) !== target) continue
    matched.add(page)
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
  return { daily, totals, matchedPages: Array.from(matched).sort() }
}

// ── รูปแบบผลของ POST /report/trackers/performance (ใช้ร่วมกัน route + หน้าเว็บ) ──────────

export interface GscTrackerPerformance extends UploadGscTracker {
  /** URL ที่ใช้เทียบกับ GSC จริง — ปกติ = url, ถ้า url เป็นแบบ ?p=123 จะเป็นลิงก์จริงที่เว็บ redirect ไป */
  matchUrl: string
  /** true = url เป็นแบบ ?p=123 และยังหาลิงก์จริงไม่ได้ (เช่น บทความยังไม่ publish) จึงยังไม่มีข้อมูลให้แสดง */
  unresolved: boolean
  matchedPages: string[]
  totals: GscMetric
  prevTotals: GscMetric
  daily: GscDailyPoint[]
  dailyPrev: GscDailyPoint[]
}

export interface GscTrackerPerformanceResponse {
  period: ReportPeriod & { siteUrl: string; searchType: ReportSearchType; fetchedAt: string }
  trackers: GscTrackerPerformance[]
}
