// Brand Radar: fetch the brand's own website (robots.txt, llms.txt, homepage) and cache the derived result.
//
// SECURITY: the domain comes only from the stored profile, cleaned by cleanCheckDomain, and every request goes through
// safeFetchRaw (https only, private-address guard, every redirect hop re-validated). Raw bodies are never stored or returned.

import { prisma } from '@/lib/prisma'
import { safeFetchRaw, type SafeFetchRawResult } from '@/lib/backlink-management/safe-fetch'
import { analyseHomepage, cleanCheckDomain, collectIssues, isCheckStale, llmsFromResponse, robotsFromResponse } from './site-readiness'
import type { HomepageCheck, SiteReadinessDTO } from './site-readiness-types'

const KEY_PREFIX = 'brand_radar_site_check:'
const FETCH_OPTS = { httpsOnly: true, timeoutMs: 8000, maxRedirects: 4 } as const

function keyOf(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`
}

function emptyDto(status: SiteReadinessDTO['status'], domain: string, checkedAt: string | null): SiteReadinessDTO {
  return {
    status,
    domain,
    checkedAt,
    robots: { state: 'unreadable', httpStatus: null, bots: [], sitemaps: [] },
    llmsTxt: { state: 'unreadable', httpStatus: null },
    homepage: null,
    issues: [],
  }
}

/** A cached value is trusted only when it has the expected shape; anything else counts as no cache */
function parseCache(value: string): SiteReadinessDTO | null {
  try {
    const v: unknown = JSON.parse(value)
    if (!v || typeof v !== 'object') return null
    const o = v as Partial<SiteReadinessDTO>
    if (o.status !== 'ok' && o.status !== 'unreachable') return null
    if (typeof o.domain !== 'string' || typeof o.checkedAt !== 'string') return null
    if (!o.robots || !Array.isArray(o.robots.bots) || !o.llmsTxt || !Array.isArray(o.issues)) return null
    return o as SiteReadinessDTO
  } catch {
    return null
  }
}

async function readCache(projectId: string): Promise<SiteReadinessDTO | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(projectId) }, select: { value: true } })
    return row ? parseCache(row.value) : null
  } catch {
    return null
  }
}

async function writeCache(projectId: string, dto: SiteReadinessDTO): Promise<void> {
  try {
    const key = keyOf(projectId)
    const value = JSON.stringify(dto)
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  } catch (e) {
    // A failed save must not fail the request; the next visit simply checks again
    console.error('[brand-radar site-readiness] cache save failed', e instanceof Error ? e.message : String(e))
  }
}

export async function getSiteReadiness(projectId: string, primaryDomain: string | null | undefined): Promise<SiteReadinessDTO> {
  const domain = cleanCheckDomain(primaryDomain)
  if (!domain) return emptyDto('no_domain', '', null)

  const now = new Date()
  const cached = await readCache(projectId)
  if (cached && !isCheckStale(cached, domain, now)) return cached

  const base = `https://${domain}`
  const [robotsRes, llmsRes, homeRes] = await Promise.all([
    safeFetchRaw(`${base}/robots.txt`, { ...FETCH_OPTS, maxBytes: 500_000 }),
    safeFetchRaw(`${base}/llms.txt`, { ...FETCH_OPTS, maxBytes: 200_000 }),
    safeFetchRaw(`${base}/`, { ...FETCH_OPTS, maxBytes: 1_500_000 }),
  ])
  const dto = buildDto(domain, now, robotsRes, llmsRes, homeRes)
  await writeCache(projectId, dto)
  return dto
}

function buildDto(domain: string, now: Date, robotsRes: SafeFetchRawResult, llmsRes: SafeFetchRawResult, homeRes: SafeFetchRawResult): SiteReadinessDTO {
  const checkedAt = now.toISOString()
  if (!homeRes.ok) {
    // Without the homepage we cannot judge the site; robots.txt and llms.txt are still reported when they were readable
    const dto = emptyDto('unreachable', domain, checkedAt)
    dto.robots = robotsFromResponse(robotsRes.ok ? { status: robotsRes.status, body: robotsRes.body } : null)
    dto.homepage = { ...BLANK_HOMEPAGE, state: 'unreadable', httpStatus: homeRes.status ?? null }
    return dto
  }
  const robots = robotsFromResponse(robotsRes.ok ? { status: robotsRes.status, body: robotsRes.body } : null)
  const llmsTxt = llmsFromResponse(llmsRes.ok ? { status: llmsRes.status, contentType: llmsRes.contentType, body: llmsRes.body } : null)
  const homeOk = homeRes.status >= 200 && homeRes.status < 300
  const homepage: HomepageCheck = homeOk
    ? { state: 'ok', httpStatus: homeRes.status, finalUrl: homeRes.finalUrl.slice(0, 300), ...analyseHomepage(homeRes.body, homeRes.xRobotsTag) }
    : { ...BLANK_HOMEPAGE, state: 'unreadable', httpStatus: homeRes.status, finalUrl: homeRes.finalUrl.slice(0, 300) }
  const parts = { robots, llmsTxt, homepage }
  // A 5xx answer is treated like an unreachable site (retried in an hour); a 4xx answer is a real, cached result
  const status = homeRes.status >= 500 ? 'unreachable' : 'ok'
  return { status, domain, checkedAt, ...parts, issues: collectIssues(parts) }
}

const BLANK_HOMEPAGE: HomepageCheck = {
  state: 'unreadable', httpStatus: null, finalUrl: '', noindex: false, nosnippet: false, title: '', description: '',
  canonical: '', schemaTypes: [], hasJsonLd: false, textLength: 0,
}
