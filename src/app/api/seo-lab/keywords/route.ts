/**
 * POST /api/seo-lab/keywords
 * Body: { seeds: string[], locationCode?: number, languageCode?: string }
 * Returns: keyword ideas with volume, cpc, competition, difficulty
 * Logs DFS cost to AIJob table
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'

interface DFSKeywordIdeasResponse {
  tasks?: Array<{
    status_code: number
    result?: Array<{
      items?: Array<{
        keyword: string
        keyword_info?: {
          search_volume: number
          cpc: number
          competition: number
          competition_level: string
        }
        keyword_properties?: {
          keyword_difficulty: number
        }
        search_intent_info?: {
          main_intent: string
        }
        impressions_etv?: number
      }>
    }>
  }>
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!hasDfsCreds()) return NextResponse.json({ error: 'DataForSEO credentials not configured' }, { status: 503 })

  const { seeds = [], locationCode = 2764, languageCode = 'th' } = await req.json()
  if (!seeds.length) return NextResponse.json({ error: 'seeds required' }, { status: 400 })

  const limitedSeeds: string[] = seeds.slice(0, 5) // max 5 seeds per call

  const start = Date.now()
  try {
    const body = limitedSeeds.map((seed: string) => ({
      keywords: [seed],
      location_code: locationCode,
      language_code: languageCode,
      limit: 50,
    }))

    const data = await dfsPost<DFSKeywordIdeasResponse>(
      '/dataforseo_labs/google/keyword_ideas/live',
      body
    )

    const keywords: Array<{
      keyword: string
      volume: number
      cpc: number
      competition: string
      competitionIndex: number
      difficulty: number
      intent: string
    }> = []

    for (const task of data.tasks ?? []) {
      if (task.status_code !== 20000) continue
      for (const result of task.result ?? []) {
        for (const item of result.items ?? []) {
          const info = item.keyword_info
          const props = item.keyword_properties
          const intentInfo = item.search_intent_info
          if (!info) continue

          const compIndex = Math.round((info.competition ?? 0) * 100)
          const compLevel = info.competition_level
            ?? (compIndex >= 67 ? 'High' : compIndex >= 34 ? 'Medium' : 'Low')

          keywords.push({
            keyword:          item.keyword,
            volume:           info.search_volume ?? 0,
            cpc:              Math.round((info.cpc ?? 0) * 100) / 100,
            competition:      compLevel,
            competitionIndex: compIndex,
            difficulty:       props?.keyword_difficulty ?? 0,
            intent:           intentInfo?.main_intent ?? 'Informational',
          })
        }
      }
    }

    // Sort by volume desc
    keywords.sort((a, b) => b.volume - a.volume)

    const cost = limitedSeeds.length * DFS_COST.keyword_ideas
    const elapsed = Date.now() - start

    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_KEYWORDS',
      modelProvider:  'DataForSEO',
      modelName:      'dataforseo_labs/keyword_ideas',
      status:         'SUCCESS',
      externalCost:   cost,
      externalCalls:  limitedSeeds.length,
      externalApi:    'DataForSEO',
      inputSummary:   `seeds: ${limitedSeeds.join(', ')} | loc: ${locationCode} | lang: ${languageCode} | ${elapsed}ms`,
    })

    return NextResponse.json({ keywords, cost, seeds: limitedSeeds, total: keywords.length })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_KEYWORDS',
      modelProvider:  'DataForSEO',
      modelName:      'dataforseo_labs/keyword_ideas',
      status:         'FAILED',
      externalCost:   0,
      externalCalls:  limitedSeeds.length,
      externalApi:    'DataForSEO',
      errorMessage:   msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
