/**
 * POST /api/seo-lab/audit
 * Body: { url: string }
 * Uses on_page/instant_pages — parses items[] array for on-page issues
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { logAIJob } from '@/lib/logAIJob'

interface PageItem {
  resource_type: string
  status_code: number
  url: string
  meta?: {
    title?: string
    description?: string
    htags?: { h1?: string[] }
    images_count?: number
    images_size?: number
    scripts_count?: number
    scripts_size?: number
    no_index?: boolean
    canonical?: string
    internal_links_count?: number
    external_links_count?: number
  }
  page_timing?: {
    time_to_interactive?: number
    dom_complete?: number
  }
  checks?: {
    no_image_alt?: boolean
    no_description?: boolean
    no_title?: boolean
    duplicate_meta_tags?: boolean
    seo_friendly_url?: boolean
    is_https?: boolean
    high_loading_time?: boolean
    low_content_rate?: boolean
  }
  content?: {
    plain_text_rate?: number
    plain_text_word_count?: number
  }
}

interface OnPageResponse {
  tasks?: Array<{
    status_code: number
    status_message: string
    result?: Array<{
      crawl_progress: string
      items_count: number
      items?: PageItem[]
    }>
  }>
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasDfsCreds()) return NextResponse.json({ error: 'DataForSEO credentials not configured' }, { status: 503 })

  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const target = url.startsWith('http') ? url : `https://${url}`
  const start = Date.now()

  try {
    const data = await dfsPost<OnPageResponse>('/on_page/instant_pages', [{
      url: target,
      enable_javascript: false,
      load_resources: true,
      enable_browser_rendering: false,
      custom_js: '',
    }])

    const page = data.tasks?.[0]?.result?.[0]?.items?.[0]
    const checks = page?.checks ?? {}
    const meta   = page?.meta   ?? {}
    const timing = page?.page_timing ?? {}
    const content = page?.content ?? {}

    const issues: Array<{ issue: string; severity: 'High' | 'Medium' | 'Low'; detail: string; fix: string }> = []

    if (!meta.title)              issues.push({ issue: 'Missing title tag',         severity: 'High',   detail: 'No <title> found',                              fix: 'Add a unique, keyword-rich title tag' })
    if (!meta.description)        issues.push({ issue: 'Missing meta description',  severity: 'Medium', detail: 'No meta description found',                     fix: 'Write a compelling 150-160 char description' })
    if (!meta.htags?.h1?.length)  issues.push({ issue: 'Missing H1 tag',            severity: 'High',   detail: 'No H1 heading found on page',                   fix: 'Add exactly one H1 with primary keyword' })
    if (checks.no_image_alt)      issues.push({ issue: 'Images missing alt text',   severity: 'Low',    detail: 'One or more images have no alt attribute',       fix: 'Add descriptive alt text to all images' })
    if (checks.high_loading_time) issues.push({ issue: 'Slow page load time',       severity: 'High',   detail: `DOM complete: ${Math.round((timing.dom_complete ?? 0)/1000)}s`, fix: 'Optimize assets, enable caching, use CDN' })
    if (checks.low_content_rate)  issues.push({ issue: 'Thin content',              severity: 'Medium', detail: `Only ${content.plain_text_word_count ?? 0} words`, fix: 'Expand content to at least 500 words' })
    if (!checks.is_https)         issues.push({ issue: 'Not using HTTPS',           severity: 'High',   detail: 'Page served over HTTP',                          fix: 'Install SSL certificate and force HTTPS' })
    if (checks.duplicate_meta_tags)issues.push({ issue: 'Duplicate meta tags',      severity: 'Medium', detail: 'Duplicate meta tags detected',                   fix: 'Remove duplicate meta tags' })
    if (!checks.seo_friendly_url) issues.push({ issue: 'Non-SEO-friendly URL',      severity: 'Low',    detail: 'URL may contain special chars or be too long',  fix: 'Use short, lowercase, hyphen-separated URLs' })

    const cost = DFS_COST.on_page_task
    const elapsed = Date.now() - start

    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_AUDIT',
      modelProvider:  'DataForSEO',
      modelName:      'on_page/instant_pages',
      status:         'SUCCESS',
      externalCost:   cost,
      externalCalls:  1,
      externalApi:    'DataForSEO',
      inputSummary:   `url: ${target} | issues: ${issues.length} | ${elapsed}ms`,
    })

    return NextResponse.json({
      url: target,
      title: meta.title ?? '',
      description: meta.description ?? '',
      h1: meta.htags?.h1?.[0] ?? '',
      wordCount: content.plain_text_word_count ?? 0,
      loadTime: Math.round((timing.dom_complete ?? 0) / 1000),
      isHttps: checks.is_https ?? false,
      issues,
      cost,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logAIJob({
      organizationId: session.user.organizationId,
      createdById:    session.user.id,
      jobType:        'SEO_LAB_AUDIT',
      modelProvider:  'DataForSEO',
      modelName:      'on_page/instant_pages',
      status:         'FAILED',
      externalCost:   0,
      externalCalls:  1,
      externalApi:    'DataForSEO',
      errorMessage:   msg,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
