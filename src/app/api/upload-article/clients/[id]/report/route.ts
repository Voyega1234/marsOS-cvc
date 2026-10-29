import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { google, searchconsole_v1 } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import { readArticleOwners, readOwnerTags } from '@/lib/upload-article/owner-tags'
import {
  resolveReportPeriod, buildOverview, buildDailySeries, buildQueryRows, buildPageRows,
  buildPositionBuckets, parseQueryPageRows, buildStrikingDistance, buildLowCtrOpportunities,
  buildCannibalization, buildDimensionRows, countryLabel, buildUploadedArticleRows,
  batchPagesForRegex, buildPageRegex, matchGscPagesToUrls, mergeGscRows, uploadedArticleUrl,
  REPORT_DAY_OPTIONS, type RawGscRow, type ReportCompareMode, type ReportPeriod, type ReportSearchType,
} from '@/lib/upload-article/gsc-report'
import { PUSHED_ARTICLE_WHERE } from '@/lib/upload-article/duplicates'

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

// ชุด query ของรายงาน (คู่ ปัจจุบัน/เทียบ ต่อมิติ ยกเว้น query+page ที่เอาแค่ช่วงปัจจุบัน) — ลำดับตรงกับ ReportRows
// rowLimit ไม่ระบุ = ใช้ค่าเริ่มต้นของ GSC (ไม่ส่งไป) ใช้ตัดซ้ำตอนรวมผลหลาย batch ด้วย
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

type PageFilterGroups = Array<{ filters: Array<{ dimension: 'page'; operator: 'includingRegex'; expression: string }> }>

/** ยิง query ทั้งชุด (15 ตัวพร้อมกัน) — filterGroups = กรองหน้าตามผู้ดูแล (ไม่ส่ง = ไม่กรอง เหมือนเดิม) */
function runReportQueries(
  sc: searchconsole_v1.Searchconsole, siteUrl: string, period: ReportPeriod, searchType: ReportSearchType, filterGroups?: PageFilterGroups,
): Promise<ReportRows> {
  return Promise.all(REPORT_QUERY_SPECS.map((spec) => runQuery(sc, siteUrl, {
    startDate: spec.prev ? period.compareStart : period.start,
    endDate: spec.prev ? period.compareEnd : period.end,
    ...(spec.dimensions ? { dimensions: spec.dimensions } : {}),
    type: searchType,
    ...(spec.rowLimit ? { rowLimit: spec.rowLimit } : {}),
    ...(filterGroups ? { dimensionFilterGroups: filterGroups } : {}),
  }))) as Promise<ReportRows>
}

/** รวมผลของหลาย batch กลับเป็นชุดเดียว (บวก clicks/impressions, position ถ่วงน้ำหนัก, ตัดตาม rowLimit เดิม) */
function mergeReportBatches(batches: ReportRows[]): ReportRows {
  return REPORT_QUERY_SPECS.map((spec, i) => mergeGscRows(batches.map((b) => b[i]), spec.rowLimit)) as ReportRows
}

const EMPTY_REPORT_ROWS = (): ReportRows => REPORT_QUERY_SPECS.map(() => []) as unknown as ReportRows

/** จำนวน batch ที่ยิงพร้อมกัน (ต่อ batch = 15 query) — กันยิง GSC รัวเกินเมื่อผู้ดูแลมีบทความเยอะ */
const OWNER_BATCH_CONCURRENCY = 2

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

  const ownerTagId = typeof body?.ownerTagId === 'string' ? body.ownerTagId.trim().slice(0, 64) : ''

  const period = resolveReportPeriod({ days, startDate, endDate, compare })

  type ArticleRow = { id: string; title: string; wordpressUrl: string | null; slug: string; pushedAt: Date | null }
  const loadPushedArticles = (): Promise<ArticleRow[]> => prisma.uploadArticle.findMany({
    where: { clientId: params.id, organizationId: orgId, ...PUSHED_ARTICLE_WHERE },
    select: { id: true, title: true, wordpressUrl: true, slug: true, pushedAt: true },
  })

  // กรองตามผู้ดูแล: บทความของคนนี้ = PUSHED ที่ pushPrefs.articleOwners[id] === ownerTagId (tag ที่ไม่มีแล้ว = ไม่มีบทความ)
  let ownerArticles: ArticleRow[] | null = null
  let ownerSig = ''
  if (ownerTagId) {
    const tags = readOwnerTags(prefs.ownerTags)
    const owners = readArticleOwners(prefs.articleOwners, tags)
    ownerArticles = tags.some((t) => t.id === ownerTagId)
      ? (await loadPushedArticles()).filter((a) => owners[a.id] === ownerTagId)
      : []
    // ลายเซ็นชุดบทความของผู้ดูแล — ย้ายบทความให้คนอื่น/เปลี่ยน URL แล้ว cache เดิมต้องไม่ถูกใช้ซ้ำ
    ownerSig = createHash('sha1').update(ownerArticles.map((a) => `${a.id}|${a.wordpressUrl ?? a.slug}`).sort().join('\n')).digest('hex')
  }

  const cacheKey = JSON.stringify({ clientId: params.id, siteUrl, period, searchType, ownerTagId, ownerSig })
  const cached = getCached(cacheKey)
  if (cached) return NextResponse.json(cached)

  let auth: Awaited<ReturnType<typeof getGSCServiceAuth>>
  try {
    auth = await getGSCServiceAuth()
  } catch (e) {
    return NextResponse.json({ error: `เชื่อมต่อ Google ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  const sc = google.searchconsole({ version: 'v1', auth })

  let rows: ReportRows
  let articles: ArticleRow[]
  let ownerFilter: { tagId: string; articles: number; pagesMatched: number } | null = null
  try {
    if (ownerArticles) {
      articles = ownerArticles
      // เฟส 1: หา "ข้อความหน้า" ตามที่ GSC ส่งมาเป๊ะ ๆ ของบทความผู้ดูแลคนนี้ (ช่วงปัจจุบัน + เทียบ) — ยังไม่กรอง
      // ไม่มีบทความ/ไม่เจอหน้าใน GSC = รายงานว่าง (ห้ามหล่นไปใช้ข้อมูลทั้งเว็บ)
      let matchedPages: string[] = []
      if (articles.length > 0) {
        const [pagesCurAll, pagesPrevAll] = await Promise.all([
          runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['page'], type: searchType, rowLimit: 25000 }),
          runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['page'], type: searchType, rowLimit: 25000 }),
        ])
        const articleUrls = articles.map((a) => uploadedArticleUrl(a, client.website))
        matchedPages = matchGscPagesToUrls([...pagesCurAll, ...pagesPrevAll].map((r) => r.keys?.[0] ?? ''), articleUrls)
      }
      ownerFilter = { tagId: ownerTagId, articles: articles.length, pagesMatched: matchedPages.length }

      // เฟส 2: ยิง query ทั้งชุดพร้อมกรองหน้า — แบ่ง batch ให้ regex ยาวไม่เกินเพดาน แล้วรวมผลกลับ
      const batches = batchPagesForRegex(matchedPages)
      if (batches.length === 0) {
        rows = EMPTY_REPORT_ROWS()
      } else {
        const batchResults: ReportRows[] = []
        for (let i = 0; i < batches.length; i += OWNER_BATCH_CONCURRENCY) {
          const chunk = batches.slice(i, i + OWNER_BATCH_CONCURRENCY)
          batchResults.push(...await Promise.all(chunk.map((pages) => runReportQueries(
            sc, siteUrl, period, searchType,
            [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: buildPageRegex(pages) }] }],
          ))))
        }
        rows = mergeReportBatches(batchResults)
      }
    } else {
      const [allRows, pushed] = await Promise.all([runReportQueries(sc, siteUrl, period, searchType), loadPushedArticles()])
      rows = allRows
      articles = pushed
    }
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
  ] = rows

  const queryPageRows = parseQueryPageRows(queryPageCur)

  const responseBody = {
    period: { ...period, siteUrl, searchType, fetchedAt: new Date().toISOString() },
    ownerFilter,
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
