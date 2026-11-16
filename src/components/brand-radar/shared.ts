/** Brand Radar — client-side helpers shared by every tab (fetch, filters, formatting) */
import { PROVIDERS, SMALL_SAMPLE_N, isProviderKey, type ProfileDTO, type ProviderKey, type RadarFilters } from '@/lib/brand-radar/types'
import { wilsonInterval } from '@/lib/brand-radar/metrics'

/** Printed wherever a metric is null. A null metric is never shown as 0. */
export const INSUFFICIENT = 'Insufficient Data'
export const NO_DATA_MESSAGE = 'No monitoring data yet. Connect an AI provider and run your first scan.'
export const NA = 'N/A'

export type TabId = 'overview' | 'prompts' | 'competitors' | 'citations' | 'opportunities' | 'settings'
export const TAB_IDS: readonly TabId[] = ['overview', 'prompts', 'competitors', 'citations', 'opportunities', 'settings']

/** Props every tab component receives from BrandRadarClient */
export interface TabProps {
  /** selected client (an existing Project id); never empty when a tab is rendered */
  projectId: string
  filters: RadarFilters
  /** changes whenever data should be re-fetched (scan progressed, settings saved, refresh clicked) */
  refreshKey: number
  /** null = brand profile not set up yet */
  profile: ProfileDTO | null
  onGoTab: (tab: TabId) => void
  /** call after a change other tabs depend on (profile saved, prompts changed, scan started) */
  onChanged: () => void
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

/** Short name for chart axes and chips */
export function providerShort(key: string): string {
  const short: Record<ProviderKey, string> = {
    openai: 'OpenAI GPT',
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
  if (method === 'imported') return 'Imported'
  return 'API simulated'
}
