/**
 * POST /api/seo-lab/competitors
 * Body: { domain: string, competitors?: string[] }
 * Uses dataforseo_labs/google/ranked_keywords/live
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'

interface RankedKeywordsResponse {
  tasks?: Array<{
    status_code: number
    status_message: string
    result?: Array<{
      target: string
      total_count: number
      metrics?: {
        organic?: {
          etv: number
          pos_1: number
          pos_2_3: number
          pos_4_10: number
          count: number
        }
      }
    }>
  }>
}

async function getDomainMetrics(domain: string, auth_header: string) {
  try {
    const res = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
      method: 'POST',
      headers: { Authorization: auth_header, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ target: domain, location_code: 2764, language_code: 'th', limit: 1 }]),
      signal: AbortSignal.timeout(20000),
    })
    const data: RankedKeywordsResponse = await res.json()
    const result = data.tasks?.[0]?.result?.[0]
    const organic = result?.metrics?.organic
    return {
      domain,
      organicKeywords: result?.total_count ?? 0,
      estimatedTraffic: Math.round(organic?.etv ?? 0),
      top10: (organic?.pos_1 ?? 0) + (organic?.pos_2_3 ?? 0) + (organic?.pos_4_10 ?? 0),
    }
  } catch {
    return { domain, organicKeywords: 0, estimatedTraffic: 0, top10: 0 }
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasDfsCreds()) return NextResponse.json({ error: 'DataForSEO credentials not configured' }, { status: 503 })

  const { domain, competitors = [] } = await req.json()
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })

  const allDomains: string[] = [domain.trim(), ...competitors.slice(0, 3).map((d: string) => d.trim())]
  const start = Date.now()

  // Use shared auth header
  const login    = process.env.DATAFORSEO_LOGIN    ?? ''
  const password = process.env.DATAFORSEO_PASSWORD ?? ''
  const authHeader = 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')

  try {
    const results = await Promise.all(allDomains.map(d => getDomainMetrics(d, authHeader)))
    const [target, ...comps] = results
    const cost = allDomains.length * DFS_COST.ranked_keywords
    const elapsed = Date.now() - start

    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_COMPETITORS',
      modelProvider:  'DataForSEO',
      modelName:      'dataforseo_labs/ranked_keywords',
      status:         'SUCCESS',
      externalCost:   cost,
      externalCalls:  allDomains.length,
      externalApi:    'DataForSEO',
      inputSummary:   `domains: ${allDomains.join(', ')} | ${elapsed}ms`,
    })

    return NextResponse.json({ target, competitors: comps, cost, elapsed })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_COMPETITORS',
      modelProvider:  'DataForSEO',
      modelName:      'dataforseo_labs/ranked_keywords',
      status:         'FAILED',
      externalCost:   0,
      externalCalls:  allDomains.length,
      externalApi:    'DataForSEO',
      errorMessage:   msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
