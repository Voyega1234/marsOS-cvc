/**
 * Google Keyword Planner Service — ported from WordGod
 * Fetches real search volume + keyword ideas via Google Ads API
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoogleAdsConfig {
  developerToken: string
  clientId: string
  clientSecret: string
  refreshToken: string
  customerId: string
  loginCustomerId?: string
  apiVersion: string
}

export interface KeywordPlannerRow {
  keyword: string
  volume: number
  competition: string
  competition_index: number
  low_cpc: number
  high_cpc: number
  monthly_trend: number[]
  source: 'google_keyword_planner_api'
}

export interface MetricEntry {
  volume: number
  competition: string
  competition_index: number
  source: 'exact' | 'close_variant'
  variant_keyword?: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function loadGoogleAdsConfig(): GoogleAdsConfig | null {
  const {
    GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_CUSTOMER_ID,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    GOOGLE_ADS_API_VERSION,
  } = process.env

  if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET ||
      !GOOGLE_ADS_REFRESH_TOKEN || !GOOGLE_ADS_CUSTOMER_ID) {
    return null
  }

  return {
    developerToken: GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: GOOGLE_ADS_CLIENT_ID,
    clientSecret: GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: GOOGLE_ADS_REFRESH_TOKEN,
    customerId: GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '').trim(),
    loginCustomerId: GOOGLE_ADS_LOGIN_CUSTOMER_ID
      ? GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '').trim()
      : undefined,
    apiVersion: GOOGLE_ADS_API_VERSION || 'v21',
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function getAccessToken(config: GoogleAdsConfig): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`KP auth failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  if (!data.access_token) throw new Error('No access_token in OAuth response')
  return data.access_token
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LANGUAGE_CONSTANTS: Record<string, string> = {
  th: 'languageConstants/1011',
  en: 'languageConstants/1000',
}
const GEO_TARGET_CONSTANTS: Record<string, string> = {
  thailand: 'geoTargetConstants/2764',
  th: 'geoTargetConstants/2764',
  us: 'geoTargetConstants/2840',
}

function mapCompetition(value: string | number | undefined): string {
  if (!value) return 'UNSPECIFIED'
  const v = String(value).toUpperCase()
  return ['LOW', 'MEDIUM', 'HIGH'].includes(v) ? v : 'UNSPECIFIED'
}

function microsToUnit(micros: number | undefined | null): number {
  if (!micros) return 0
  return Math.round((micros / 1_000_000) * 100) / 100
}

// ─── Get real volume for known keywords (getHistoricalMetrics) ────────────────

export async function getKPVolumes(
  keywords: string[],
  config: GoogleAdsConfig,
  accessToken: string,
  language = 'th',
  country = 'Thailand',
): Promise<Map<string, MetricEntry>> {
  const result = new Map<string, MetricEntry>()
  if (keywords.length === 0) return result

  const languageResource = LANGUAGE_CONSTANTS[language.toLowerCase()] || LANGUAGE_CONSTANTS['th']
  const geoResource = GEO_TARGET_CONSTANTS[country.toLowerCase()] || GEO_TARGET_CONSTANTS['thailand']
  const endpoint = `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}:generateKeywordIdeas`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'Content-Type': 'application/json',
    ...(config.loginCustomerId ? { 'login-customer-id': config.loginCustomerId } : {}),
  }

  const CHUNK = 20
  const PARALLEL = 5

  const chunks: string[][] = []
  for (let i = 0; i < keywords.length; i += CHUNK) chunks.push(keywords.slice(i, i + CHUNK))

  for (let w = 0; w < chunks.length; w += PARALLEL) {
    const wave = chunks.slice(w, w + PARALLEL)
    await Promise.all(wave.map(async (chunk) => {
      const inputSet = new Set(chunk.map(k => k.trim().toLowerCase()))
      const body = {
        language: languageResource,
        geoTargetConstants: [geoResource],
        keywordPlanNetwork: 'GOOGLE_SEARCH',
        keywordSeed: { keywords: chunk },
      }

      let responseText = ''
      let success = false
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt))
          const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
          responseText = await res.text()
          if (!res.ok) {
            if (res.status === 429 || res.status >= 500) continue
            break
          }
          success = true
          break
        } catch { /* retry */ }
      }
      if (!success) return

      try {
        const data = JSON.parse(responseText)
        const plannerResults: Array<{ plannerText: string; metrics: any }> = []

        for (const item of (data.results || [])) {
          const plannerText = (item.text || '').trim().toLowerCase().replace(/\s+/g, ' ')
          const metrics = item.keywordIdeaMetrics || {}
          const volume = metrics.avgMonthlySearches ? parseInt(String(metrics.avgMonthlySearches), 10) : 0
          if (isNaN(volume) || volume < 0) continue
          plannerResults.push({ plannerText, metrics })

          const closeVariants: string[] = (item.closeVariants || []).map((v: string) => v.trim().toLowerCase())
          const allForms = [plannerText, ...closeVariants]
          const matchedInput = Array.from(inputSet).find(inp =>
            allForms.some(form => form === inp || form.replace(/\s/g, '') === inp.replace(/\s/g, ''))
          )
          if (matchedInput && !result.has(matchedInput)) {
            result.set(matchedInput, {
              volume,
              competition: mapCompetition(metrics.competition),
              competition_index: parseInt(String(metrics.competitionIndex || '0'), 10),
              source: 'exact',
            })
          }
        }

        // Close variant fallback
        for (const inp of Array.from(inputSet)) {
          if (result.has(inp)) continue
          const inpWords = new Set(inp.split(/\s+/).filter((w: string) => w.length > 1))
          if (inpWords.size === 0) continue
          let bestScore = 0
          let bestResult: { plannerText: string; metrics: any } | null = null
          for (const pr of plannerResults) {
            const shared = pr.plannerText.split(/\s+/).filter(w => inpWords.has(w)).length
            if (shared > bestScore) { bestScore = shared; bestResult = pr }
          }
          if (bestResult && bestScore >= 2) {
            const rawVol = bestResult.metrics.avgMonthlySearches
              ? parseInt(String(bestResult.metrics.avgMonthlySearches), 10) : 0
            if (!isNaN(rawVol) && rawVol > 0) {
              result.set(inp, {
                volume: Math.round(rawVol * 0.3),
                competition: mapCompetition(bestResult.metrics.competition),
                competition_index: parseInt(String(bestResult.metrics.competitionIndex || '0'), 10),
                source: 'close_variant',
                variant_keyword: bestResult.plannerText,
              })
            }
          }
        }
      } catch { /* non-fatal */ }
    }))
  }

  return result
}

// ─── Generate keyword ideas from seeds/URL (KP Step 0.8) ─────────────────────

export async function getKPKeywordIdeas(
  seeds: string[],
  url: string | undefined,
  config: GoogleAdsConfig,
  accessToken: string,
  language = 'th',
  country = 'Thailand',
): Promise<KeywordPlannerRow[]> {
  if (seeds.length === 0 && !url) return []

  const languageResource = LANGUAGE_CONSTANTS[language.toLowerCase()] || LANGUAGE_CONSTANTS['th']
  const geoResource = GEO_TARGET_CONSTANTS[country.toLowerCase()] || GEO_TARGET_CONSTANTS['thailand']
  const endpoint = `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}:generateKeywordIdeas`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'Content-Type': 'application/json',
    ...(config.loginCustomerId ? { 'login-customer-id': config.loginCustomerId } : {}),
  }

  const SEED_CHUNK = 20
  const allRows: KeywordPlannerRow[] = []
  const seedChunks = seeds.length > 0
    ? Array.from({ length: Math.ceil(seeds.length / SEED_CHUNK) }, (_, i) => seeds.slice(i * SEED_CHUNK, (i + 1) * SEED_CHUNK))
    : [[]]

  for (const seedChunk of seedChunks) {
    let keywordSeed: object
    if (seedChunk.length > 0 && url) {
      keywordSeed = { keywordAndUrlSeed: { keywords: seedChunk, url } }
    } else if (seedChunk.length > 0) {
      keywordSeed = { keywordSeed: { keywords: seedChunk } }
    } else {
      keywordSeed = { urlSeed: { url } }
    }

    const body = {
      language: languageResource,
      geoTargetConstants: [geoResource],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      includeAdultKeywords: false,
      ...keywordSeed,
    }

    try {
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
      const rawText = await res.text()
      if (!res.ok) continue

      const data = JSON.parse(rawText)
      for (const idea of (data.results || [])) {
        if (!idea.text) continue
        const metrics = idea.keywordIdeaMetrics || {}
        const monthlySearches: number[] = (metrics.monthlySearchVolumes || [])
          .map((m: any) => parseInt(m.monthlySearches || '0', 10))
          .filter((v: number) => !isNaN(v))
        const avgVolume = metrics.avgMonthlySearches ? parseInt(String(metrics.avgMonthlySearches), 10) : 0
        allRows.push({
          keyword: idea.text,
          volume: isNaN(avgVolume) ? 0 : avgVolume,
          competition: mapCompetition(metrics.competition),
          competition_index: parseInt(String(metrics.competitionIndex || '0'), 10),
          low_cpc: microsToUnit(metrics.lowTopOfPageBidMicros),
          high_cpc: microsToUnit(metrics.highTopOfPageBidMicros),
          monthly_trend: monthlySearches,
          source: 'google_keyword_planner_api',
        })
      }
    } catch { /* skip chunk on error */ }
  }

  // Deduplicate
  const seen = new Set<string>()
  return allRows.filter(r => {
    if (seen.has(r.keyword)) return false
    seen.add(r.keyword)
    return true
  })
}
