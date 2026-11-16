import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { google, searchconsole_v1 } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import {
  resolveReportPeriod, REPORT_DAY_OPTIONS,
  type RawGscRow, type ReportCompareMode, type ReportSearchType,
} from '@/lib/upload-article/gsc-report'
import {
  buildTrackerPageRegex, buildTrackerSeries, isIdPermalinkUrl, readGscTrackers, trackerKind,
  type GscTrackerKind, type GscTrackerPerformance, type GscTrackerPerformanceResponse,
} from '@/lib/upload-article/gsc-trackers'
import { resolveIdPermalink } from '@/lib/upload-article/gsc-tracker-resolve'

// ─── Upload Article > Report > Monitor — ผลรายวันของรายการที่บันทึกไว้ (keyword / หน้า / keyword + หน้า) (service account เท่านั้น) ───
// cache ในหน่วยความจำ 10 นาที เหมือน route report

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
/** จำนวน query ที่ยิง GSC พร้อมกัน */
const QUERY_CONCURRENCY = 4

function isForbiddenError(e: unknown): boolean {
  const err = e as { code?: number | string; response?: { status?: number } } | null
  const code = err?.code
  const status = err?.response?.status
  return code === 403 || code === '403' || status === 403
}

interface QuerySpec { key: string; dimensions: string[]; filter: { dimension: 'query' | 'page'; operator: 'equals' | 'includingRegex'; expression: string } }

/** query ที่ต้องยิงของแต่ละรายการ — รายการที่ใช้ query เดียวกันจะแชร์ผลกัน (ยิงครั้งเดียว) */
function specFor(kind: GscTrackerKind, keyword: string, matchUrl: string): QuerySpec | null {
  if (kind === 'keyword') {
    // คำนี้ทั้งเว็บ: ไม่แยกหน้า ตัวเลขจึงตรงกับแท็บคำค้นหาของ GSC (การแสดงผลไม่ถูกนับซ้ำหลายหน้า)
    return { key: `k\u0001${keyword}`, dimensions: ['date'], filter: { dimension: 'query', operator: 'equals', expression: keyword } }
  }
  if (kind === 'page') {
    const regex = buildTrackerPageRegex(matchUrl)
    if (!regex) return null
    return { key: `p\u0001${regex}`, dimensions: ['date', 'page'], filter: { dimension: 'page', operator: 'includingRegex', expression: regex } }
  }
  return { key: `q\u0001${keyword}`, dimensions: ['date', 'page'], filter: { dimension: 'query', operator: 'equals', expression: keyword } }
}

async function runQuery(
  sc: searchconsole_v1.Searchconsole, siteUrl: string, spec: QuerySpec,
  startDate: string, endDate: string, searchType: ReportSearchType,
): Promise<RawGscRow[]> {
  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate, endDate,
      dimensions: spec.dimensions,
      type: searchType,
      rowLimit: 25000,
      dimensionFilterGroups: [{ filters: [spec.filter] }],
    } as never,
  })
  return (res.data.rows ?? []) as RawGscRow[]
}

/** POST /api/upload-article/clients/[id]/report/trackers/performance */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId }, select: { pushPrefs: true } })
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
  const trackers = readGscTrackers(prefs.gscTrackers)
  const meta = () => ({ ...period, siteUrl, searchType, fetchedAt: new Date().toISOString() })

  if (trackers.length === 0) {
    const empty: GscTrackerPerformanceResponse = { period: meta(), trackers: [] }
    return NextResponse.json(empty)
  }

  const trackerSig = createHash('sha1').update(trackers.map((t) => `${t.id}|${t.keyword}|${t.url}`).join('\n')).digest('hex')
  const cacheKey = JSON.stringify({ clientId: params.id, siteUrl, period, searchType, trackerSig })
  const cached = getCached(cacheKey)
  if (cached) return NextResponse.json(cached)

  // หาลิงก์จริงของ ?p=123 (มี cache + ตรวจโฮสต์ในตัว) — ตัวที่หาไม่ได้ = unresolved ไม่ยิง Google
  const targets = await Promise.all(trackers.map(async (t) => {
    const kind = trackerKind(t)
    const matchUrl = t.url && isIdPermalinkUrl(t.url) ? (await resolveIdPermalink(t.url, siteUrl)) ?? t.url : t.url
    const unresolved = !!matchUrl && isIdPermalinkUrl(matchUrl)
    const spec = unresolved ? null : specFor(kind, t.keyword, matchUrl)
    return { tracker: t, kind, matchUrl, unresolved, spec }
  }))

  const specs = new Map<string, QuerySpec>()
  for (const x of targets) if (x.spec) specs.set(x.spec.key, x.spec)
  const rowsBySpec = new Map<string, { cur: RawGscRow[]; prev: RawGscRow[] }>()

  if (specs.size > 0) {
    let auth: Awaited<ReturnType<typeof getGSCServiceAuth>>
    try {
      auth = await getGSCServiceAuth()
    } catch (e) {
      return NextResponse.json({ error: `เชื่อมต่อ Google ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
    const sc = google.searchconsole({ version: 'v1', auth })
    const list = Array.from(specs.values())
    try {
      for (let i = 0; i < list.length; i += QUERY_CONCURRENCY) {
        const chunk = list.slice(i, i + QUERY_CONCURRENCY)
        await Promise.all(chunk.map(async (spec) => {
          const [cur, prev] = await Promise.all([
            runQuery(sc, siteUrl, spec, period.start, period.end, searchType),
            runQuery(sc, siteUrl, spec, period.compareStart, period.compareEnd, searchType),
          ])
          rowsBySpec.set(spec.key, { cur, prev })
        }))
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
  }

  // GSC ช้ากว่าวันจริง ~3 วัน: ช่วงที่กำหนดเองอาจลากถึงวันที่ข้อมูลยังไม่มา — ไม่เติม 0 หลังวันนั้น (ข้อมูลยังไม่มา ≠ 0)
  const lastDataDate = resolveReportPeriod({ days: 28, compare: 'previous' }).end

  const out: GscTrackerPerformance[] = targets.map(({ tracker, kind, matchUrl, unresolved, spec }) => {
    const rows = spec ? rowsBySpec.get(spec.key) : undefined
    // ชนิด keyword: แถวไม่มีมิติ page → ส่ง url ว่างให้นับทุกแถว
    const seriesUrl = kind === 'keyword' ? '' : matchUrl
    const cur = buildTrackerSeries(rows?.cur ?? [], seriesUrl, period.start, period.end, lastDataDate)
    const prev = buildTrackerSeries(rows?.prev ?? [], seriesUrl, period.compareStart, period.compareEnd)
    return {
      ...tracker,
      kind,
      matchUrl,
      unresolved,
      hasData: cur.hasData,
      matchedPages: cur.matchedPages,
      totals: cur.totals,
      prevTotals: prev.totals,
      daily: cur.daily,
      dailyPrev: prev.daily,
    }
  })

  const responseBody: GscTrackerPerformanceResponse = { period: meta(), trackers: out }
  setCached(cacheKey, responseBody)
  return NextResponse.json(responseBody)
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
