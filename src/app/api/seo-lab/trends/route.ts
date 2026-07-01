/**
 * POST /api/seo-lab/trends
 * Body: { keyword: string, locationCode?: number, languageCode?: string }
 * Uses DataForSEO google_trends/explore/live — monthly search volume history
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'

interface TrendsResponse {
  tasks?: Array<{
    status_code: number
    status_message: string
    result?: Array<{
      type: string
      items?: Array<{
        type: string
        keywords?: string[]
        data?: Array<{
          date_from: string
          date_to: string
          values: number[]
        }>
      }>
    }>
  }>
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasDfsCreds()) return NextResponse.json({ error: 'DataForSEO credentials not configured' }, { status: 503 })

  const { keyword, locationCode = 2764, languageCode = 'th' } = await req.json()
  if (!keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 })

  const start = Date.now()
  try {
    const data = await dfsPost<TrendsResponse>('/keywords_data/google_trends/explore/live', [{
      keywords:      [keyword],
      location_code: locationCode,
      language_code: languageCode,
      type:          'web',
      date_from:     (() => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d.toISOString().split('T')[0] })(),
      date_to:       new Date().toISOString().split('T')[0],
    }])

    // Parse monthly timeline
    const items = data.tasks?.[0]?.result?.[0]?.items ?? []
    const timeline: Array<{ month: string; value: number }> = []

    for (const item of items) {
      if (item.type === 'google_trends_graph' && item.data) {
        for (const point of item.data) {
          timeline.push({
            month: point.date_from.slice(0, 7), // YYYY-MM
            value: point.values?.[0] ?? 0,
          })
        }
      }
    }

    const cost = DFS_COST.search_trends
    const elapsed = Date.now() - start

    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_TRENDS',
      modelProvider:  'DataForSEO',
      modelName:      'keywords_data/google_trends/explore',
      status:         'SUCCESS',
      externalCost:   cost,
      externalCalls:  1,
      externalApi:    'DataForSEO',
      inputSummary:   `keyword: ${keyword} | ${timeline.length} points | ${elapsed}ms`,
    })

    return NextResponse.json({ keyword, timeline, cost })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_TRENDS',
      modelProvider:  'DataForSEO',
      modelName:      'keywords_data/google_trends/explore',
      status:         'FAILED',
      externalCost:   0,
      externalCalls:  1,
      externalApi:    'DataForSEO',
      errorMessage:   msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
