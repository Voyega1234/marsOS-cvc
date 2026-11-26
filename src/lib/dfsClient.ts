/**
 * DataForSEO client — SEO Intelligence Lab
 * Isolated from WordGod. All calls log cost via logAIJob.
 */

export const DFS_BASE = 'https://api.dataforseo.com/v3'

export function dfsAuth(): string {
  const login    = process.env.DATAFORSEO_LOGIN    ?? ''
  const password = process.env.DATAFORSEO_PASSWORD ?? ''
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}

export function hasDfsCreds(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
}

export async function dfsPost<T = unknown>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    method:  'POST',
    headers: { Authorization: dfsAuth(), 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`DFS HTTP ${res.status}`)
  const json = await res.json()
  if (json.status_code !== 20000) throw dfsError(json)
  return json as T
}

export async function dfsGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    headers: { Authorization: dfsAuth() },
    signal:  AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`DFS HTTP ${res.status}`)
  const json = await res.json()
  if (json.status_code !== 20000) throw dfsError(json)
  return json as T
}

/** Error for a non-20000 response; carries the billed `cost` (if any) so a FAILED row can log it. */
function dfsError(json: { status_code?: number; status_message?: string; cost?: unknown }): Error {
  const err = new Error(json.status_message ?? `DFS error ${json.status_code}`)
  const c = Number(json.cost)
  if (Number.isFinite(c) && c > 0) (err as Error & { billedCost?: number }).billedCost = c
  return err
}

/** Billed cost (USD) DataForSEO reports at the top level of a response; `fallback` when it has none. */
export function dfsBilledCost(resp: unknown, fallback: number): number {
  const c = (resp as { cost?: unknown } | null | undefined)?.cost
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : fallback
}

/** Billed cost carried on an error thrown by dfsPost/dfsGet (0 when none). */
export function dfsCostOfError(err: unknown): number {
  const c = (err as { billedCost?: unknown } | null | undefined)?.billedCost
  return typeof c === 'number' && Number.isFinite(c) ? c : 0
}

// ── Cost estimates (USD) ─────────────────────────────────────────────────────
export const DFS_COST = {
  keyword_ideas:       0.005,   // per seed keyword (keyword_ideas endpoint)
  search_volume:       0.003,   // per keyword (search_volume/live)
  domain_overview:     0.003,   // per domain
  serp:                0.003,   // per query (organic live)
  backlinks_summary:   0.002,   // per domain
  on_page_task:        0.025,   // per crawl task
  ranked_keywords:     0.005,   // per domain
  search_trends:       0.002,   // per keyword (google_trends/explore)
} as const
