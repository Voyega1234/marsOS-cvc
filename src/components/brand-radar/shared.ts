/** Brand Radar — client-side helpers shared by every tab (fetch, filters, formatting) */
import { PROVIDERS, SMALL_SAMPLE_N, answerZone, isProviderKey, parseSchedule, type AnswerMentionFilter, type ProfileDTO, type ProviderKey, type RadarFilters } from '@/lib/brand-radar/types'
import { wilsonInterval } from '@/lib/brand-radar/metrics'

/** Printed wherever a metric is null. A null metric is never shown as 0. */
export const INSUFFICIENT = 'Insufficient Data'
export const NO_DATA_MESSAGE = 'No monitoring data yet. Connect an AI provider and run your first scan.'
export const NA = 'N/A'

export type TabId = 'overview' | 'responses' | 'prompts' | 'competitors' | 'citations' | 'citation-analysis' | 'opportunities' | 'settings'
export const TAB_IDS: readonly TabId[] = ['overview', 'responses', 'prompts', 'competitors', 'citations', 'citation-analysis', 'opportunities', 'settings']

/** Props every tab component receives from BrandRadarClient */
/**
 * A place inside a tab to jump to, sent along with onGoTab. Navigation only: nothing here reaches the server
 * except through filters the tab already has.
 */
export interface TabFocus {
  /** AI Responses: open with this answer-type filter chosen */
  mention?: AnswerMentionFilter
  /** AI Responses: narrow the page to one AI platform (sets the page-wide platform filter) */
  provider?: ProviderKey
  /** Competitors: scroll to this competitor and mark its rows */
  competitor?: string
}

/** A TabFocus plus a counter, so pressing the same shortcut twice is still seen as a new request */
export interface TabFocusState extends TabFocus { tab: TabId; seq: number }

export interface TabProps {
  /** selected client (an existing Project id); never empty when a tab is rendered */
  projectId: string
  filters: RadarFilters
  /** changes whenever data should be re-fetched (scan progressed, settings saved, refresh clicked) */
  refreshKey: number
  /** null = brand profile not set up yet */
  profile: ProfileDTO | null
  /** `focus` opens the tab already narrowed to one thing (see TabFocus) */
  onGoTab: (tab: TabId, focus?: TabFocus) => void
  /** where the last onGoTab call pointed; a tab reads only the fields meant for it */
  focus?: TabFocusState | null
  /** call after a change other tabs depend on (profile saved, prompts changed, scan started) */
  onChanged: () => void
  /** true = customer login: read-only report, no staff controls */
  clientView?: boolean
  /** picture of the selected brand: uploaded logo path and site favicon, both may be null */
  brandLogo?: { logo: string | null; favicon: string | null }
}

/** Tabs a customer login may open */
export const CLIENT_TAB_IDS: readonly TabId[] = ['overview', 'responses', 'competitors', 'citations']

// In-memory stale-while-revalidate cache for report GETs (never persisted). Cleared when the project
// changes (BrandRadarClient) and after any successful write (api() below), so no write is shown stale.
const RADAR_CACHE_MAX = 30
const radarCache = new Map<string, { refreshKey: number; data: unknown }>()
let radarCacheGen = 0

export function clearRadarCache(): void {
  radarCache.clear()
  radarCacheGen++
}
export function radarCacheGeneration(): number {
  return radarCacheGen
}
/** Cached body of `url` saved at the same refreshKey; a refresh / reload / write invalidates it */
export function radarCacheGet<T>(url: string, refreshKey: number): T | null {
  if (!url) return null
  const hit = radarCache.get(url)
  return hit && hit.refreshKey === refreshKey ? (hit.data as T) : null
}
/** Ignored when a write or project change happened since `gen` was read (the response may be stale) */
export function radarCacheSet(url: string, refreshKey: number, data: unknown, gen: number): void {
  if (!url || gen !== radarCacheGen) return
  radarCache.delete(url)
  radarCache.set(url, { refreshKey, data })
  while (radarCache.size > RADAR_CACHE_MAX) {
    const oldest = radarCache.keys().next().value
    if (oldest === undefined) break
    radarCache.delete(oldest)
  }
}

export async function api<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
    })
    const data = await r.json().catch(() => ({}))
    const method = (init?.method ?? 'GET').toUpperCase()
    if (r.ok && method !== 'GET' && method !== 'HEAD') clearRadarCache()
    return { ok: r.ok, status: r.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : String(e) } as T & { error?: string } }
  }
}

export function postJson(body: unknown, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'): RequestInit {
  return { method, body: JSON.stringify(body) }
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Last 90 days, all countries / languages / providers */
export function defaultFilters(now = new Date()): RadarFilters {
  const from = new Date(now)
  from.setDate(from.getDate() - 89)
  return { from: ymd(from), to: ymd(now), country: 'all', language: 'all', provider: 'all' }
}

/** Query string for every analytics endpoint: projectId + global filters (+ extra params) */
export function radarQuery(
  projectId: string,
  filters: RadarFilters,
  extra?: Record<string, string | number | null | undefined>,
): string {
  const q = new URLSearchParams({ projectId })
  if (filters.from) q.set('from', filters.from)
  if (filters.to) q.set('to', filters.to)
  if (filters.country && filters.country !== 'all') q.set('country', filters.country)
  if (filters.language && filters.language !== 'all') q.set('language', filters.language)
  if (filters.provider && filters.provider !== 'all') q.set('provider', filters.provider)
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
  }
  return q.toString()
}

/** 0.4267 -> "42.7%". null -> "Insufficient Data" */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return INSUFFICIENT
  return `${(v * 100).toFixed(digits)}%`
}

/**
 * 95% range of a rate counted over n asks, e.g. "32–68%". null when n is 0.
 * k is rebuilt from the rate, so pass the same n the rate was computed over.
 */
export function fmtRange(rate: number | null | undefined, n: number): string | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate) || !(n > 0)) return null
  const ci = wilsonInterval(Math.round(rate * n), n)
  if (!ci) return null
  return `${Math.round(ci.low * 100)}–${Math.round(ci.high * 100)}%`
}

/** true when a rate rests on fewer asks than SMALL_SAMPLE_N (show a "small sample" badge) */
export function isSmallSample(n: number): boolean {
  return n > 0 && n < SMALL_SAMPLE_N
}

/** Thai name of the part of the answer where the brand first appears; null when unknown */
export function answerZoneLabel(pct: number | null | undefined): 'ช่วงต้น' | 'ช่วงกลาง' | 'ช่วงท้าย' | null {
  const z = answerZone(pct)
  return z === 'early' ? 'ช่วงต้น' : z === 'middle' ? 'ช่วงกลาง' : z === 'late' ? 'ช่วงท้าย' : null
}

/** e.g. "ช่วงต้น · 12%"; "ยังไม่มีข้อมูล" when the position was not recorded */
export function fmtAnswerPos(pct: number | null | undefined): string {
  const label = answerZoneLabel(pct)
  if (label === null || pct === null || pct === undefined) return 'ยังไม่มีข้อมูล'
  return `${label} · ${Math.round(pct * 100)}%`
}

/** Which share of the answer each zone covers; shown next to zone percentages */
export const ANSWER_ZONE_LEGEND = 'ช่วงต้น = 0–33% แรกของคำตอบ · ช่วงกลาง = 34–66% · ช่วงท้าย = 67–100%'

type ZoneCounts = { early: number; middle: number; late: number }

/**
 * Whole-percent share of answers per zone, summing to 100 (largest remainder).
 * null when no answer has a recorded position, so unknown is never shown as 0%.
 */
export function zoneShares(zones: ZoneCounts | null | undefined): (ZoneCounts & { total: number }) | null {
  if (!zones) return null
  const keys = ['early', 'middle', 'late'] as const
  const total = keys.reduce((a, k) => a + (Number.isFinite(zones[k]) ? Math.max(0, zones[k]) : 0), 0)
  if (!(total > 0)) return null
  const exact = keys.map((k) => (Math.max(0, zones[k] || 0) / total) * 100)
  const out = exact.map((v) => Math.floor(v))
  let left = 100 - out.reduce((a, v) => a + v, 0)
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    out[o.i]++
    left--
  }
  return { early: out[0], middle: out[1], late: out[2], total }
}

/** e.g. "ช่วงต้น 60% · ช่วงกลาง 30% · ช่วงท้าย 10%"; null when the position was not recorded */
export function fmtZoneShare(zones: ZoneCounts | null | undefined): string | null {
  const s = zoneShares(zones)
  if (!s) return null
  return `ช่วงต้น ${s.early}% · ช่วงกลาง ${s.middle}% · ช่วงท้าย ${s.late}%`
}

/** What the zone percentages measure, as a short caption that needs no further explanation */
export const ANSWER_ZONE_CAPTION = 'AI เอ่ยชื่อแบรนด์ช่วงไหนของคำตอบ'

/** How the zone percentages are worked out, in one line; `answers` = answers that name the brand and carry a position */
export function zoneMethodNote(zones: ZoneCounts | null | undefined): string | null {
  const s = zoneShares(zones)
  if (!s) return null
  return `วิธีคิด: แบ่งคำตอบเป็น 3 ส่วนเท่ากัน แล้วดูว่าชื่อแบรนด์ปรากฏครั้งแรกในส่วนไหน · นับจาก ${s.total.toLocaleString('th-TH')} คำตอบที่เอ่ยชื่อแบรนด์`
}

/** Self-explaining zone names, e.g. "ต้นคำตอบ 60% · กลางคำตอบ 30% · ท้ายคำตอบ 10%"; null when not recorded */
export function fmtZoneBrief(zones: ZoneCounts | null | undefined): string | null {
  const s = zoneShares(zones)
  if (!s) return null
  return `ต้นคำตอบ ${s.early}% · กลางคำตอบ ${s.middle}% · ท้ายคำตอบ ${s.late}%`
}

/** null -> "N/A" (unknown, e.g. search volume). Never prints 0 for unknown. */
export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA
  return v.toLocaleString('en-US')
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

/** Cost of a single call: small amounts keep four decimals ($0.0040), where fmtUsd would round them away. */
export function fmtUsdPerCall(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA
  return v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** "2026-11" -> "พ.ย. 2026" (or "พ.ย." with `short`); anything else is returned as it came. */
export function monthLabelTh(key: string, short = false): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  const name = m ? MONTHS_TH[Number(m[2]) - 1] : undefined
  if (!m || !name) return key
  return short ? name : `${name} ${m[1]}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function providerLabel(key: string): string {
  return isProviderKey(key) ? PROVIDERS[key].label : key
}

/** Provider name; customers get the clean name without vendor wording */
export function providerLabelFor(key: string, clientView?: boolean): string {
  return clientView ? providerShort(key) : providerLabel(key)
}

/** https link for a plain hostname only; null for anything else */
export function domainHref(domain: string | null | undefined): string | null {
  const d = (domain ?? '').trim().toLowerCase()
  if (!d || d.length > 253) return null
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null
  return `https://${d}`
}

/** Short name for chart axes and chips */
export function providerShort(key: string): string {
  const short: Record<ProviderKey, string> = {
    openai: 'ChatGPT',
    gemini: 'Gemini',
    perplexity: 'Perplexity',
    claude: 'Claude',
    grok: 'Grok',
    deepseek: 'DeepSeek',
    google_ai_mode: 'Google AI Mode',
    google_ai_overview: 'Google AI Overview',
  }
  return isProviderKey(key) ? short[key] : key
}

/** How the answer was collected, in the words shown to staff */
export function methodLabel(method: string): string {
  if (method === 'observed_serp') return 'Observed (Google Search)'
  if (method === 'observed_chat') return 'Real answer (web app)'
  if (method === 'imported') return 'Imported'
  return 'API simulated'
}

/** Weekday names in ISO order (index 0 = Monday) */
export const WEEKDAYS_TH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'] as const

/** Scan schedule in the words shown to staff. A value this version cannot read counts as Manual, same as the server. */
export function scheduleLabel(value: unknown): string {
  const spec = parseSchedule(value)
  if (!spec) return 'Manual'
  switch (spec.kind) {
    case 'manual': return 'Manual'
    case 'daily': return 'รายวัน'
    case 'weekly': return 'รายสัปดาห์'
    case 'monthly': return 'รายเดือน'
    case 'interval': return `ทุก ${spec.days} วัน`
    case 'weekdays': return `ทุกวัน${spec.days.map((d) => WEEKDAYS_TH[d - 1]).join(', ')}`
  }
}
