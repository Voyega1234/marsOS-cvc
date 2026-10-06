import { NextRequest, NextResponse } from 'next/server'
import { google, searchconsole_v1 } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCAuth } from '@/lib/google-auth'
import { resolveReportPeriod, normalizeReportUrl, rowMetric, type RawGscRow } from '@/lib/upload-article/gsc-report'

// ─── SEO SME > Request Index — performance ต่อบทความ (GSC ระดับหน้าเว็บ) ───
// ใช้ gscSiteUrl ของโปรเจกต์ + auth เดียวกับแท็บ Report, cache 10 นาที

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { value: unknown; expiresAt: number }>()

function isForbiddenError(e: unknown): boolean {
  const err = e as { code?: number | string; response?: { status?: number } } | null
  return err?.code === 403 || err?.code === '403' || err?.response?.status === 403
}

async function runQuery(sc: searchconsole_v1.Searchconsole, siteUrl: string, body: Record<string, unknown>): Promise<RawGscRow[]> {
  const res = await sc.searchanalytics.query({ siteUrl, requestBody: body as never })
  return (res.data.rows ?? []) as RawGscRow[]
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { id: true, gscSiteUrl: true },
  })
  if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 })
  const siteUrl = project.gscSiteUrl || ''
  if (!siteUrl) return NextResponse.json({ error: 'ยังไม่ได้ตั้งเว็บ GSC ของโปรเจกต์', needSetup: true }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const days = typeof body?.days === 'number' && [7, 28, 90].includes(body.days) ? body.days : 28
  const period = resolveReportPeriod({ days, compare: 'previous' })

  const cacheKey = JSON.stringify({ projectId: params.id, siteUrl, period })
  const hit = cache.get(cacheKey)
  if (hit && Date.now() < hit.expiresAt) return NextResponse.json(hit.value)

  try {
    const sc = google.searchconsole({ version: 'v1', auth: await getGSCAuth() })
    const [pageCur, pagePrev, articles] = await Promise.all([
      runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['page'], type: 'web', rowLimit: 5000 }),
      runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['page'], type: 'web', rowLimit: 5000 }),
      prisma.article.findMany({
        where: { projectId: params.id, wordpressUrl: { not: null }, status: { in: ['POSTED', 'WORDPRESS_DRAFTED'] } },
        select: { id: true, wordpressUrl: true },
      }),
    ])
    const toMap = (rs: RawGscRow[]) => {
      const m = new Map<string, ReturnType<typeof rowMetric>>()
      for (const r of rs) { const u = r.keys?.[0]; if (u) m.set(normalizeReportUrl(u), rowMetric(r)) }
      return m
    }
    const curBy = toMap(pageCur)
    const prevBy = toMap(pagePrev)
    const zero = { clicks: 0, impressions: 0, ctr: 0, position: 0 }
    const rows: Record<string, { clicks: number; impressions: number; ctr: number; position: number; prevClicks: number; prevImpressions: number; prevPosition: number }> = {}
    for (const a of articles) {
      const norm = normalizeReportUrl(a.wordpressUrl || '')
      const c = curBy.get(norm) ?? zero
      const p = prevBy.get(norm) ?? zero
      rows[a.id] = { clicks: c.clicks, impressions: c.impressions, ctr: c.ctr, position: c.position, prevClicks: p.clicks, prevImpressions: p.impressions, prevPosition: p.position }
    }
    const value = { period: { start: period.start, end: period.end }, rows }
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    if (cache.size > 200) { const k = cache.keys().next().value; if (k) cache.delete(k) }
    return NextResponse.json(value)
  } catch (e) {
    if (isForbiddenError(e)) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์เข้าถึงเว็บนี้ใน Search Console — ตรวจว่าบัญชี Google ที่เชื่อมไว้เป็นผู้ใช้ของเว็บนี้' }, { status: 403 })
    }
    return NextResponse.json({ error: `ดึงข้อมูล GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
