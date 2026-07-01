/**
 * POST /api/seo-lab/backlinks
 * Body: { domain: string }
 * Returns: backlink summary + top referring domains
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'

interface BacklinkSummaryResponse {
  tasks?: Array<{
    status_code: number
    result?: Array<{
      total_count?: number
      referring_domains?: number
      referring_main_domains?: number
      rank?: number
      backlinks?: number
      new_backlinks?: number
      lost_backlinks?: number
      broken_backlinks?: number
      referring_ips?: number
    }>
  }>
}

interface ReferringDomainsResponse {
  tasks?: Array<{
    status_code: number
    result?: Array<{
      items?: Array<{
        domain: string
        rank: number
        backlinks: number
        first_seen: string
        lost_date: string | null
        is_new: boolean
        is_lost: boolean
        referring_links_types?: { href?: number; redirect?: number }
      }>
    }>
  }>
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasDfsCreds()) return NextResponse.json({ error: 'DataForSEO credentials not configured' }, { status: 503 })

  const { domain } = await req.json()
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })

  const start = Date.now()
  try {
    const [summaryData, domainsData] = await Promise.all([
      dfsPost<BacklinkSummaryResponse>('/backlinks/summary/live', [{ target: domain, include_subdomains: true }]),
      dfsPost<ReferringDomainsResponse>('/backlinks/referring_domains/live', [{
        target: domain, include_subdomains: true, limit: 10, order_by: ['rank,desc'],
      }]),
    ])

    const s = summaryData.tasks?.[0]?.result?.[0] ?? {}
    const summary = {
      backlinks:          s.backlinks          ?? 0,
      referringDomains:   s.referring_domains  ?? 0,
      newBacklinks:       s.new_backlinks       ?? 0,
      lostBacklinks:      s.lost_backlinks      ?? 0,
      brokenBacklinks:    s.broken_backlinks    ?? 0,
      rank:               s.rank               ?? 0,
    }

    const referringDomains = (domainsData.tasks?.[0]?.result?.[0]?.items ?? []).map(i => ({
      domain:     i.domain,
      rank:       i.rank,
      backlinks:  i.backlinks,
      isNew:      i.is_new,
      isLost:     i.is_lost,
      firstSeen:  i.first_seen?.slice(0, 10) ?? '',
    }))

    const cost = DFS_COST.backlinks_summary * 2
    const elapsed = Date.now() - start

    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_BACKLINKS',
      modelProvider:  'DataForSEO',
      modelName:      'backlinks/summary+referring_domains',
      status:         'SUCCESS',
      externalCost:   cost,
      externalCalls:  2,
      externalApi:    'DataForSEO',
      inputSummary:   `domain: ${domain} | ${elapsed}ms`,
    })

    return NextResponse.json({ summary, referringDomains, cost, domain })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_BACKLINKS',
      modelProvider:  'DataForSEO',
      modelName:      'backlinks/summary',
      status:         'FAILED',
      externalCost:   0,
      externalCalls:  1,
      externalApi:    'DataForSEO',
      errorMessage:   msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
