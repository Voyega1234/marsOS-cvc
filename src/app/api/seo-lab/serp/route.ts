/**
 * POST /api/seo-lab/serp
 * Body: { keyword: string, locationCode?: number }
 * Returns top 10 organic SERP results for inline SERP analysis
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'

interface SerpResponse {
  tasks?: Array<{
    status_code: number
    result?: Array<{
      items?: Array<{
        type: string
        rank_absolute: number
        title: string
        description: string
        url: string
        domain: string
        breadcrumb: string
      }>
    }>
  }>
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasDfsCreds()) return NextResponse.json({ error: 'DataForSEO credentials not configured' }, { status: 503 })

  const { keyword, locationCode = 2764 } = await req.json()
  if (!keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 })

  const start = Date.now()
  try {
    const data = await dfsPost<SerpResponse>('/serp/google/organic/live/regular', [{
      keyword,
      location_code:  locationCode,
      language_code:  'th',
      depth:          10,
    }])

    const items = data.tasks?.[0]?.result?.[0]?.items ?? []
    const results = items
      .filter((it: { type: string }) => it.type === 'organic')
      .slice(0, 10)
      .map((it: { rank_absolute: number; title: string; description: string; url: string; domain: string }) => ({
        rank:        it.rank_absolute,
        title:       it.title ?? '',
        description: it.description ?? '',
        url:         it.url ?? '',
        domain:      it.domain ?? '',
      }))

    const cost = DFS_COST.serp
    const elapsed = Date.now() - start

    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_SERP',
      modelProvider:  'DataForSEO',
      modelName:      'serp/google/organic/live/regular',
      status:         'SUCCESS',
      externalCost:   cost,
      externalCalls:  1,
      externalApi:    'DataForSEO',
      inputSummary:   `keyword: ${keyword} | ${results.length} results | ${elapsed}ms`,
    })

    return NextResponse.json({ keyword, results, cost })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_SERP',
      modelProvider:  'DataForSEO',
      modelName:      'serp/google/organic/live/regular',
      status:         'FAILED',
      externalCost:   0,
      externalCalls:  1,
      externalApi:    'DataForSEO',
      errorMessage:   msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
