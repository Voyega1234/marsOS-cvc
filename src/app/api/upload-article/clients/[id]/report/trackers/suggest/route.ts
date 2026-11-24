import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import { resolveReportPeriod, REPORT_DAY_OPTIONS, type RawGscRow, type ReportCompareMode, type ReportSearchType } from '@/lib/upload-article/gsc-report'
import { normalizeTrackerKeyword, rankKeywordSuggestions, readGscTrackers, readSuggestSort, UPLOAD_MAX_GSC_TRACKERS, type GscKeywordSuggestResponse } from '@/lib/upload-article/gsc-trackers'
import { GSC_BUDGET_BUSY_MESSAGE, gscTrackerBudget } from '@/lib/upload-article/gsc-budget'
import { hasForbiddenTerm } from '@/lib/wordgod/local/normalize'

// ─── Upload Article > Report > Keyword ที่ติดตาม — "หาคำใกล้เคียง": คำค้นหาใน GSC ของเว็บนี้ที่มีคำหลักอยู่ ───
// ยิง GSC 2 ครั้ง (ช่วงนี้ + ช่วงเทียบ), cache 10 นาที, ผ่าน budget เดียวกับ performance
// term ว่าง = keyword ทั้งหมดของเว็บในช่วงนี้ (ไม่กรองคำ): ดึงสูงสุด 25,000 แถวต่อช่วง แล้วส่งกลับ 1,000 อันดับแรกตาม sort
// เปลี่ยน sort ใช้แถวจาก cache เดิม ไม่ยิง GSC ใหม่

const CACHE_TTL_MS = 10 * 60 * 1000
const ROW_LIMIT = 500
const ALL_ROW_LIMIT = 25000
const TERM_RESULT_LIMIT = 200
const ALL_RESULT_LIMIT = 1000
/** small: one all-queries entry can hold 50,000 rows */
const CACHE_MAX = 60
const cache = new Map<string, { rows: { cur: RawGscRow[]; prev: RawGscRow[] }; expiresAt: number }>()
const SEARCH_TYPES: ReportSearchType[] = ['web', 'image', 'video', 'news', 'discover']

function isForbiddenError(e: unknown): boolean {
  const err = e as { code?: number | string; response?: { status?: number } } | null
  return err?.code === 403 || err?.code === '403' || err?.response?.status === 403
}

/** POST body {term, sort?, days?, startDate?, endDate?, compare?, searchType?} — term '' = every query of the site */
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
  const term = normalizeTrackerKeyword(body?.term)
  const all = term.length === 0
  if (!all && term.length < 2) return NextResponse.json({ error: 'พิมพ์คำหลักอย่างน้อย 2 ตัวอักษร' }, { status: 400 })
  const sort = readSuggestSort(body?.sort)
  const days = typeof body?.days === 'number' && (REPORT_DAY_OPTIONS as readonly number[]).includes(body.days) ? body.days : 28
  const compare: ReportCompareMode = body?.compare === 'yoy' ? 'yoy' : 'previous'
  const searchType: ReportSearchType = SEARCH_TYPES.includes(body?.searchType) ? body.searchType : 'web'
  const period = resolveReportPeriod({
    days,
    startDate: typeof body?.startDate === 'string' ? body.startDate : undefined,
    endDate: typeof body?.endDate === 'string' ? body.endDate : undefined,
    compare,
  })

  const cacheKey = JSON.stringify({ clientId: params.id, siteUrl, period, searchType, term })
  const hit = cache.get(cacheKey)
  let rows = hit && hit.expiresAt > Date.now() ? hit.rows : null

  if (!rows) {
    if (!gscTrackerBudget.take(2)) return NextResponse.json({ error: GSC_BUDGET_BUSY_MESSAGE }, { status: 429 })
    try {
      const sc = google.searchconsole({ version: 'v1', auth: await getGSCServiceAuth() })
      const run = async (startDate: string, endDate: string) => {
        const res = await sc.searchanalytics.query({
          siteUrl,
          requestBody: {
            startDate, endDate, type: searchType, dimensions: ['query'], rowLimit: all ? ALL_ROW_LIMIT : ROW_LIMIT,
            ...(all ? {} : { dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'contains', expression: term }] }] }),
          } as never,
        })
        return (res.data.rows ?? []) as RawGscRow[]
      }
      const [cur, prev] = await Promise.all([run(period.start, period.end), run(period.compareStart, period.compareEnd)])
      rows = { cur, prev }
      cache.set(cacheKey, { rows, expiresAt: Date.now() + CACHE_TTL_MS })
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest) cache.delete(oldest)
      }
    } catch (e) {
      if (isForbiddenError(e)) {
        const identity = await getServiceIdentity()
        return NextResponse.json({ error: `ไม่มีสิทธิ์เข้าถึงเว็บนี้ใน Search Console — เพิ่ม ${identity.email || 'service account'} เป็นผู้ใช้ในเว็บนี้ก่อน แล้วลองใหม่` }, { status: 403 })
      }
      return NextResponse.json({ error: `ดึงข้อมูล GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
  }

  const trackers = readGscTrackers(prefs.gscTrackers)
  // กฎ: ห้ามมีคำต้องห้าม (เช่น pantip) ในผล keyword
  const ranked = rankKeywordSuggestions(rows.cur, rows.prev, trackers, {
    exclude: hasForbiddenTerm, sort, limit: all ? ALL_RESULT_LIMIT : TERM_RESULT_LIMIT,
  })
  const out: GscKeywordSuggestResponse = {
    term,
    suggestions: ranked.suggestions,
    total: ranked.total,
    sort,
    remaining: Math.max(0, UPLOAD_MAX_GSC_TRACKERS - trackers.length),
    limit: UPLOAD_MAX_GSC_TRACKERS,
  }
  return NextResponse.json(out)
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
