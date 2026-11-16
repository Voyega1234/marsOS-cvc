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
  buildTrackerSeries, isIdPermalinkUrl, readGscTrackers,
  type GscTrackerPerformance, type GscTrackerPerformanceResponse,
} from '@/lib/upload-article/gsc-trackers'
import { resolveIdPermalink } from '@/lib/upload-article/gsc-tracker-resolve'

// ─── Upload Article > Report > Monitor — ผลรายวันของ keyword + URL ที่บันทึกไว้ (service account เท่านั้น) ───
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
/** จำนวน keyword ที่ยิง GSC พร้อมกัน */
const KEYWORD_CONCURRENCY = 4

function isForbiddenError(e: unknown): boolean {
  const err = e as { code?: number | string; response?: { status?: number } } | null
  const code = err?.code
  const status = err?.response?.status
  return code === 403 || code === '403' || status === 403
}

async function runKeywordQuery(
  sc: searchconsole_v1.Searchconsole, siteUrl: string, keyword: string,
  startDate: string, endDate: string, searchType: ReportSearchType,
): Promise<RawGscRow[]> {
  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate, endDate,
      dimensions: ['date', 'page'],
      type: searchType,
      rowLimit: 25000,
      dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: keyword }] }],
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
    const matchUrl = isIdPermalinkUrl(t.url) ? (await resolveIdPermalink(t.url, siteUrl)) ?? t.url : t.url
    return { tracker: t, matchUrl, unresolved: isIdPermalinkUrl(matchUrl) }
  }))

  const keywords = Array.from(new Set(targets.filter((x) => !x.unresolved).map((x) => x.tracker.keyword)))
  const rowsByKeyword = new Map<string, { cur: RawGscRow[]; prev: RawGscRow[] }>()

  if (keywords.length > 0) {
    let auth: Awaited<ReturnType<typeof getGSCServiceAuth>>
    try {
      auth = await getGSCServiceAuth()
    } catch (e) {
      return NextResponse.json({ error: `เชื่อมต่อ Google ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
    const sc = google.searchconsole({ version: 'v1', auth })
    try {
      for (let i = 0; i < keywords.length; i += KEYWORD_CONCURRENCY) {
        const chunk = keywords.slice(i, i + KEYWORD_CONCURRENCY)
        await Promise.all(chunk.map(async (kw) => {
          const [cur, prev] = await Promise.all([
            runKeywordQuery(sc, siteUrl, kw, period.start, period.end, searchType),
            runKeywordQuery(sc, siteUrl, kw, period.compareStart, period.compareEnd, searchType),
          ])
          rowsByKeyword.set(kw, { cur, prev })
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

  const out: GscTrackerPerformance[] = targets.map(({ tracker, matchUrl, unresolved }) => {
    const rows = unresolved ? undefined : rowsByKeyword.get(tracker.keyword)
    const cur = buildTrackerSeries(rows?.cur ?? [], matchUrl, period.start, period.end, lastDataDate)
    const prev = buildTrackerSeries(rows?.prev ?? [], matchUrl, period.compareStart, period.compareEnd)
    return {
      ...tracker,
      matchUrl,
      unresolved,
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
