import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import { resolveReportPeriod, REPORT_DAY_OPTIONS, type RawGscRow, type ReportCompareMode, type ReportSearchType } from '@/lib/upload-article/gsc-report'
import { buildTrackerSeries, normalizeTrackerKeyword, type GscQuerySeriesResponse } from '@/lib/upload-article/gsc-trackers'
import { GSC_BUDGET_BUSY_MESSAGE, gscTrackerBudget } from '@/lib/upload-article/gsc-budget'

// ─── Upload Article > Report > Keyword ที่ติดตาม — กราฟรายวันของ "คำใกล้เคียง" 1 คำ (โหลดเมื่อกดเปิดแถวเท่านั้น) ───
// ยิง GSC 2 ครั้ง (ช่วงนี้ + ช่วงเทียบ), cache 10 นาที, ผ่าน budget เดียวกับ performance

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { value: GscQuerySeriesResponse; expiresAt: number }>()
const SEARCH_TYPES: ReportSearchType[] = ['web', 'image', 'video', 'news', 'discover']

function isForbiddenError(e: unknown): boolean {
  const err = e as { code?: number | string; response?: { status?: number } } | null
  return err?.code === 403 || err?.code === '403' || err?.response?.status === 403
}

function isQuotaError(e: unknown): boolean {
  const err = e as { code?: number | string; response?: { status?: number }; message?: string } | null
  if (Number(err?.response?.status ?? err?.code) === 429) return true
  return /quota|rate ?limit|too many requests/i.test(err?.message ?? '')
}

/** POST body {keyword, days?, startDate?, endDate?, compare?, searchType?} */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId }, select: { pushPrefs: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  const prefs = parsePrefs(client.pushPrefs)
  const siteUrl = (prefs.gscReport as UploadGscReportPrefs | undefined)?.siteUrl || ''
  if (!siteUrl) return NextResponse.json({ error: 'ยังไม่ได้เลือกเว็บ GSC — เลือกเว็บที่ด้านบนของแท็บ Report ก่อน' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const keyword = normalizeTrackerKeyword(body?.keyword)
  if (!keyword) return NextResponse.json({ error: 'ไม่มีคำค้นหา' }, { status: 400 })
  const days = typeof body?.days === 'number' && (REPORT_DAY_OPTIONS as readonly number[]).includes(body.days) ? body.days : 28
  const compare: ReportCompareMode = body?.compare === 'yoy' ? 'yoy' : 'previous'
  const searchType: ReportSearchType = SEARCH_TYPES.includes(body?.searchType) ? body.searchType : 'web'
  const period = resolveReportPeriod({
    days,
    startDate: typeof body?.startDate === 'string' ? body.startDate : undefined,
    endDate: typeof body?.endDate === 'string' ? body.endDate : undefined,
    compare,
  })

  const cacheKey = JSON.stringify({ clientId: params.id, siteUrl, period, searchType, keyword })
  const hit = cache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now()) return NextResponse.json(hit.value)

  if (!gscTrackerBudget.take(2)) return NextResponse.json({ error: GSC_BUDGET_BUSY_MESSAGE }, { status: 429 })
  let rows: { cur: RawGscRow[]; prev: RawGscRow[] }
  try {
    const sc = google.searchconsole({ version: 'v1', auth: await getGSCServiceAuth() })
    const run = async (startDate: string, endDate: string) => {
      const res = await sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate, endDate, type: searchType, dimensions: ['date'], rowLimit: 1000,
          dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: keyword }] }],
        } as never,
      })
      return (res.data.rows ?? []) as RawGscRow[]
    }
    const [cur, prev] = await Promise.all([run(period.start, period.end), run(period.compareStart, period.compareEnd)])
    rows = { cur, prev }
  } catch (e) {
    if (isForbiddenError(e)) {
      const identity = await getServiceIdentity()
      return NextResponse.json({ error: `ไม่มีสิทธิ์เข้าถึงเว็บนี้ใน Search Console — เพิ่ม ${identity.email || 'service account'} เป็นผู้ใช้ในเว็บนี้ก่อน แล้วลองใหม่` }, { status: 403 })
    }
    if (isQuotaError(e)) {
      return NextResponse.json({ error: 'Google Search Console จำกัดจำนวนครั้งชั่วคราว (คนใช้พร้อมกันเยอะ) — รอ 1–2 นาทีแล้วลองใหม่' }, { status: 429 })
    }
    return NextResponse.json({ error: `ดึงข้อมูล GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  // GSC ช้ากว่าวันจริง ~3 วัน — ไม่เติม 0 หลังวันที่ข้อมูลยังไม่มา
  const lastDataDate = resolveReportPeriod({ days: 28, compare: 'previous' }).end
  const cur = buildTrackerSeries(rows.cur, '', period.start, period.end, lastDataDate)
  const prev = buildTrackerSeries(rows.prev, '', period.compareStart, period.compareEnd)
  const value: GscQuerySeriesResponse = {
    keyword,
    hasData: cur.hasData,
    totals: cur.totals,
    prevTotals: prev.totals,
    daily: cur.daily,
    dailyPrev: prev.daily,
  }
  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  if (cache.size > 300) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  return NextResponse.json(value)
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
