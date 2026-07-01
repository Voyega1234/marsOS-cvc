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

export async function dfsPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    method:  'POST',
    headers: { Authorization: dfsAuth(), 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`DFS HTTP ${res.status}`)
  const json = await res.json()
  if (json.status_code !== 20000) throw new Error(json.status_message ?? `DFS error ${json.status_code}`)
  return json as T
}

export async function dfsGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    headers: { Authorization: dfsAuth() },
    signal:  AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`DFS HTTP ${res.status}`)
  const json = await res.json()
  if (json.status_code !== 20000) throw new Error(json.status_message ?? `DFS error ${json.status_code}`)
  return json as T
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
