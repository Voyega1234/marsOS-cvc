import { NextRequest, NextResponse } from 'next/server'
import { google, searchconsole_v1 } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import {
  resolveReportPeriod, buildOverview, buildDailySeries, buildQueryRows, buildPageRows,
  buildPositionBuckets, parseQueryPageRows, buildStrikingDistance, buildLowCtrOpportunities,
  buildCannibalization, buildDimensionRows, countryLabel, buildUploadedArticleRows,
  REPORT_DAY_OPTIONS, type RawGscRow, type ReportCompareMode, type ReportSearchType,
} from '@/lib/upload-article/gsc-report'

// ─── Upload Article > Report — สรุปผล GSC แบบละเอียด (service account เท่านั้น) ───
// cache ในหน่วยความจำ 10 นาที กัน dashboard โดนเปิดซ้ำ ๆ ยิง GSC รัว ๆ (ต่อ clientId+siteUrl+params)

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
  // กันหน่วยความจำบวมถ้ามีหลายลูกค้า/พารามิเตอร์เปิดพร้อมกันมาก
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

/** POST /api/upload-article/clients/[id]/report — รายงาน GSC ละเอียด (ต้องตั้งเว็บที่ /report/site ก่อน) */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const prefs = parsePrefs(client.pushPrefs)
  const gscReport = prefs.gscReport as UploadGscReportPrefs | undefined
  const siteUrl = gscReport?.siteUrl || ''
  if (!siteUrl) {
    return NextResponse.json({ error: 'ยังไม่ได้เลือกเว็บ GSC — เลือกเว็บที่ด้านบนของแท็บ Report ก่อน' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const days = typeof body?.days === 'number' && (REPORT_DAY_OPTIONS as readonly number[]).includes(body.days) ? body.days : 28
  const startDate = typeof body?.startDate === 'string' ? body.startDate : undefined
  const endDate = typeof body?.endDate === 'string' ? body.endDate : undefined
  const compare: ReportCompareMode = body?.compare === 'yoy' ? 'yoy' : 'previous'
  const searchType: ReportSearchType = SEARCH_TYPES.includes(body?.searchType) ? body.searchType : 'web'

  const period = resolveReportPeriod({ days, startDate, endDate, compare })

  const cacheKey = JSON.stringify({ clientId: params.id, siteUrl, period, searchType })
  const cached = getCached(cacheKey)
  if (cached) return NextResponse.json(cached)

  let auth: Awaited<ReturnType<typeof getGSCServiceAuth>>
  try {
    auth = await getGSCServiceAuth()
  } catch (e) {
    return NextResponse.json({ error: `เชื่อมต่อ Google ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  const sc = google.searchconsole({ version: 'v1', auth })

  let results: [
    RawGscRow[], RawGscRow[], // totals
    RawGscRow[], RawGscRow[], // daily
    RawGscRow[], RawGscRow[], // query
    RawGscRow[], RawGscRow[], // page
    RawGscRow[], RawGscRow[], // device
    RawGscRow[], RawGscRow[], // country
    RawGscRow[], RawGscRow[], // searchAppearance
    RawGscRow[], // query,page (current only)
    Array<{ id: string; title: string; wordpressUrl: string | null; slug: string; pushedAt: Date | null }>,
  ]
  try {
    results = await Promise.all([
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, type: searchType }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, type: searchType }),
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['date'], type: searchType, rowLimit: 1000 }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['date'], type: searchType, rowLimit: 1000 }),
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['query'], type: searchType, rowLimit: 1000 }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['query'], type: searchType, rowLimit: 1000 }),
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['page'], type: searchType, rowLimit: 1000 }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['page'], type: searchType, rowLimit: 1000 }),
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['device'], type: searchType }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['device'], type: searchType }),
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['country'], type: searchType, rowLimit: 50 }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['country'], type: searchType, rowLimit: 50 }),
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['searchAppearance'], type: searchType }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['searchAppearance'], type: searchType }),
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['query', 'page'], type: searchType, rowLimit: 5000 }),
      prisma.uploadArticle.findMany({
        where: { clientId: params.id, organizationId: orgId, status: 'PUSHED' },
        select: { id: true, title: true, wordpressUrl: true, slug: true, pushedAt: true },
      }),
    ])
  } catch (e) {
    if (isForbiddenError(e)) {
      const identity = await getServiceIdentity()
      return NextResponse.json({
        error: `ไม่มีสิทธิ์เข้าถึงเว็บนี้ใน Search Console — เพิ่ม ${identity.email || 'service account'} เป็นผู้ใช้ในเว็บนี้ก่อน แล้วลองใหม่`,
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
    articles,
  ] = results

  const queryPageRows = parseQueryPageRows(queryPageCur)

  const responseBody = {
    period: { ...period, siteUrl, searchType, fetchedAt: new Date().toISOString() },
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
    uploadedArticles: buildUploadedArticleRows(
      articles.map((a) => ({ id: a.id, title: a.title, wordpressUrl: a.wordpressUrl, slug: a.slug, pushedAt: a.pushedAt ? a.pushedAt.toISOString() : null })),
      client.website,
      pageCur, pagePrev, queryPageRows,
    ),
  }

  setCached(cacheKey, responseBody)
  return NextResponse.json(responseBody)
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
