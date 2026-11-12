import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { google, searchconsole_v1 } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId } from '@/lib/upload-article/pbn-store'
import { readPbnSites, readPbnPushes, pbnArticleUrl } from '@/lib/upload-article/pbn'
import { pbnMonitorArticleIds, pbnMonitorArticles } from '@/lib/upload-article/pbn-monitor'
import {
  resolveReportPeriod, buildOverview, buildDailySeries, buildQueryRows, buildPageRows,
  buildPositionBuckets, parseQueryPageRows, buildStrikingDistance, buildLowCtrOpportunities,
  buildCannibalization, buildDimensionRows, countryLabel, buildUploadedArticleRows,
  REPORT_DAY_OPTIONS, type RawGscRow, type ReportCompareMode, type ReportPeriod, type ReportSearchType,
} from '@/lib/upload-article/gsc-report'

// ─── PBN Backlinks > Monitor — สรุปผล GSC ของเว็บ PBN เว็บเดียว (service account เท่านั้น) ───
// สำเนาจาก Upload Article report route (ตัดส่วนกรองผู้ดูแลออก) — cache ในหน่วยความจำ 10 นาที

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { value: unknown; expiresAt: number }>()

function getCached(key: string): unknown | null {
  const e = cache.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) { cache.delete(key); return null }
  return e.value
}
function setCached(key: string, value: unknown) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  if (cache.size > 200) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
}

const SEARCH_TYPES: ReportSearchType[] = ['web', 'image', 'video', 'news', 'discover']

function isForbiddenError(e: unknown): boolean {
  const err = e as { code?: number | string; response?: { status?: number } } | null
  const code = err?.code
  const status = err?.response?.status
  return code === 403 || code === '403' || status === 403
}

async function runQuery(sc: searchconsole_v1.Searchconsole, siteUrl: string, body: Record<string, unknown>): Promise<RawGscRow[]> {
  const res = await sc.searchanalytics.query({ siteUrl, requestBody: body as never })
  return (res.data.rows ?? []) as RawGscRow[]
}

// ชุด query ของรายงาน (คู่ ปัจจุบัน/เทียบ ต่อมิติ ยกเว้น query+page ที่เอาแค่ช่วงปัจจุบัน) — ลำดับตรงกับ ReportRows
interface ReportQuerySpec { dimensions?: string[]; rowLimit?: number; prev: boolean }
const REPORT_QUERY_SPECS: ReportQuerySpec[] = [
  { prev: false }, { prev: true }, // totals
  { dimensions: ['date'], rowLimit: 1000, prev: false }, { dimensions: ['date'], rowLimit: 1000, prev: true },
  { dimensions: ['query'], rowLimit: 1000, prev: false }, { dimensions: ['query'], rowLimit: 1000, prev: true },
  { dimensions: ['page'], rowLimit: 1000, prev: false }, { dimensions: ['page'], rowLimit: 1000, prev: true },
  { dimensions: ['device'], prev: false }, { dimensions: ['device'], prev: true },
  { dimensions: ['country'], rowLimit: 50, prev: false }, { dimensions: ['country'], rowLimit: 50, prev: true },
  { dimensions: ['searchAppearance'], prev: false }, { dimensions: ['searchAppearance'], prev: true },
  { dimensions: ['query', 'page'], rowLimit: 5000, prev: false },
]

type ReportRows = [
  RawGscRow[], RawGscRow[], // totals
  RawGscRow[], RawGscRow[], // daily
  RawGscRow[], RawGscRow[], // query
  RawGscRow[], RawGscRow[], // page
  RawGscRow[], RawGscRow[], // device
  RawGscRow[], RawGscRow[], // country
  RawGscRow[], RawGscRow[], // searchAppearance
  RawGscRow[], // query,page (current only)
]

/** ยิง query ทั้งชุด (15 ตัวพร้อมกัน) */
function runReportQueries(
  sc: searchconsole_v1.Searchconsole, siteUrl: string, period: ReportPeriod, searchType: ReportSearchType,
): Promise<ReportRows> {
  return Promise.all(REPORT_QUERY_SPECS.map((spec) => runQuery(sc, siteUrl, {
    startDate: spec.prev ? period.compareStart : period.start,
    endDate: spec.prev ? period.compareEnd : period.end,
    ...(spec.dimensions ? { dimensions: spec.dimensions } : {}),
    type: searchType,
    ...(spec.rowLimit ? { rowLimit: spec.rowLimit } : {}),
  }))) as Promise<ReportRows>
}

/** POST /api/pbn-backlinks/sites/[siteId]/monitor — รายงาน GSC ละเอียดของเว็บ PBN เว็บเดียว */
export async function POST(req: NextRequest, { params }: { params: { siteId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const clientId = await findPbnClientId(orgId)
  if (!clientId) return NextResponse.json({ error: 'ไม่พบเว็บนี้' }, { status: 404 })
  const prefs = await readPrefs(clientId, orgId)
  const site = readPbnSites(prefs).find((s) => s.id === params.siteId)
  if (!site) return NextResponse.json({ error: 'ไม่พบเว็บนี้' }, { status: 404 })

  const siteUrl = site.gscSiteUrl || ''
  if (!siteUrl) {
    return NextResponse.json({
      error: 'เว็บนี้ยังไม่ได้ตั้ง Search Console property — ตั้งได้ที่ Project Setting > PBN Sites & Connect',
      code: 'no_gsc',
    }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const days = typeof body?.days === 'number' && (REPORT_DAY_OPTIONS as readonly number[]).includes(body.days) ? body.days : 28
  const startDate = typeof body?.startDate === 'string' ? body.startDate : undefined
  const endDate = typeof body?.endDate === 'string' ? body.endDate : undefined
  const compare: ReportCompareMode = body?.compare === 'yoy' ? 'yoy' : 'previous'
  const searchType: ReportSearchType = SEARCH_TYPES.includes(body?.searchType) ? body.searchType : 'web'

  const period = resolveReportPeriod({ days, startDate, endDate, compare })

  // บทความที่ push ขึ้นเว็บนี้ (ดึงเฉพาะแถวที่มีประวัติ push ของเว็บนี้)
  const pushes = readPbnPushes(prefs)
  const ids = pbnMonitorArticleIds(pushes, site.id)
  const rows = ids.length
    ? await prisma.uploadArticle.findMany({
        where: { id: { in: ids }, clientId, organizationId: orgId },
        select: { id: true, title: true, slug: true },
      })
    : []
  const articles = pbnMonitorArticles(pushes, site.id, rows, (slug) => (slug ? pbnArticleUrl(site, slug) : ''))
  const articleSig = createHash('sha1').update(articles.map((a) => `${a.id}|${a.wordpressUrl}`).sort().join('\n')).digest('hex')

  const cacheKey = JSON.stringify({ orgId, siteId: site.id, siteUrl, period, compare, searchType, articleSig })
  const cached = getCached(cacheKey)
  if (cached) return NextResponse.json(cached)

  let auth: Awaited<ReturnType<typeof getGSCServiceAuth>>
  try {
    auth = await getGSCServiceAuth()
  } catch (e) {
    const identity = await getServiceIdentity().catch(() => null)
    return NextResponse.json({
      error: `เชื่อมต่อ Google ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`,
      serviceEmail: identity?.email || '',
    }, { status: 502 })
  }
  const sc = google.searchconsole({ version: 'v1', auth })

  let reportRows: ReportRows
  try {
    reportRows = await runReportQueries(sc, siteUrl, period, searchType)
  } catch (e) {
    if (isForbiddenError(e)) {
      const identity = await getServiceIdentity()
      const email = identity.email || 'service account'
      return NextResponse.json({
        error: `ไม่มีสิทธิ์เข้าถึง ${siteUrl} ใน Search Console — เพิ่ม ${email} เป็นผู้ใช้ใน property นี้ก่อน แล้วลองใหม่`,
        serviceEmail: identity.email || '',
      }, { status: 403 })
    }
    return NextResponse.json({ error: `ดึงข้อมูล GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  const [
    totalsCur, totalsPrev,
    dailyCur, dailyPrev,
    queryCur, queryPrev,
    pageCur, pagePrev,
    deviceCur, devicePrev,
    countryCur, countryPrev,
    searchAppearanceCur, searchAppearancePrev,
    queryPageCur,
  ] = reportRows

  const queryPageRows = parseQueryPageRows(queryPageCur)
  const identity = await getServiceIdentity().catch(() => null)

  const responseBody = {
    period: { ...period, siteUrl, searchType, fetchedAt: new Date().toISOString() },
    ownerFilter: null,
    site: { id: site.id, name: site.name, siteUrl: site.siteUrl },
    serviceEmail: identity?.email || '',
    overview: buildOverview(totalsCur, totalsPrev),
    daily: buildDailySeries(dailyCur),
    dailyPrev: buildDailySeries(dailyPrev),
    queries: buildQueryRows(queryCur, queryPrev),
    pages: buildPageRows(pageCur, pagePrev),
    positionBuckets: buildPositionBuckets(queryCur, queryPrev),
    opportunities: {
      strikingDistance: buildStrikingDistance(queryCur),
      lowCtr: buildLowCtrOpportunities(queryCur, queryPageRows),
    },
    cannibalization: buildCannibalization(queryPageRows),
    devices: buildDimensionRows(deviceCur, devicePrev),
    countries: buildDimensionRows(countryCur, countryPrev).map((r) => ({ ...r, name: countryLabel(r.label) })),
    searchAppearance: buildDimensionRows(searchAppearanceCur, searchAppearancePrev),
    uploadedArticles: buildUploadedArticleRows(articles, site.siteUrl, pageCur, pagePrev, queryPageRows),
  }

  setCached(cacheKey, responseBody)
  return NextResponse.json(responseBody)
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
