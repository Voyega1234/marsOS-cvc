/**
 * POST /api/seo-lab/rankings
 * Body: { keywords: string[], domain: string, locationCode?: number }
 * Returns: SERP position for each keyword + whether domain appears
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'

interface SERPResponse {
  tasks?: Array<{
    status_code: number
    data?: { keyword: string }
    result?: Array<{
      items?: Array<{
        type: string
        rank_group: number
        rank_absolute: number
        domain: string
        url: string
        title: string
      }>
    }>
  }>
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasDfsCreds()) return NextResponse.json({ error: 'DataForSEO credentials not configured' }, { status: 503 })

  const { keywords = [], domain = '', locationCode = 2764 } = await req.json()
  if (!keywords.length) return NextResponse.json({ error: 'keywords required' }, { status: 400 })

  const limited: string[] = keywords.slice(0, 10)
  const start = Date.now()

  try {
    const body = limited.map((kw: string) => ({
      keyword:       kw,
      location_code: locationCode,
      language_code: 'th',
      depth:         20,
    }))

    const data = await dfsPost<SERPResponse>('/serp/google/organic/live/regular', body)

    const rankings = limited.map((kw: string) => {
      const task = data.tasks?.find(t => t.data?.keyword === kw)
      const items = task?.result?.[0]?.items?.filter(i => i.type === 'organic') ?? []

      let position: number | null = null
      let url = ''
      if (domain) {
        const hit = items.find(i => i.domain?.includes(domain) || i.url?.includes(domain))
        if (hit) { position = hit.rank_group; url = hit.url }
      }

      const top3 = items.slice(0, 3).map(i => ({ domain: i.domain, title: i.title, url: i.url, rank: i.rank_group }))

      return { keyword: kw, position, url, top3 }
    })

    const cost = limited.length * DFS_COST.serp
    const elapsed = Date.now() - start

    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_RANKINGS',
      modelProvider:  'DataForSEO',
      modelName:      'serp/google/organic/live',
      status:         'SUCCESS',
      externalCost:   cost,
      externalCalls:  limited.length,
      externalApi:    'DataForSEO',
      inputSummary:   `kws: ${limited.join(', ')} | domain: ${domain} | ${elapsed}ms`,
    })

    return NextResponse.json({ rankings, cost, domain, total: rankings.length })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_RANKINGS',
      modelProvider:  'DataForSEO',
      modelName:      'serp/google/organic/live',
      status:         'FAILED',
      externalCost:   0,
      externalCalls:  limited.length,
      externalApi:    'DataForSEO',
      errorMessage:   msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
