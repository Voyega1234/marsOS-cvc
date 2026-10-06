import { NextRequest, NextResponse } from 'next/server'
import { google, searchconsole_v1 } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCServiceAuth, getServiceIdentity } from '@/lib/google-auth'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import {
  resolveReportPeriod, normalizeReportUrl, rowMetric, REPORT_DAY_OPTIONS, type RawGscRow, type GscMetric,
} from '@/lib/upload-article/gsc-report'
import { isPbnPrefs, readPbnPushes, readPbnSites } from '@/lib/upload-article/pbn'

// ─── Upload Article > Request Index — performance ต่อบทความที่ push แล้ว (GSC ระดับหน้าเว็บ) ───
// เบากว่า /report (ยิงแค่ page ช่วงนี้ + ช่วงก่อน) cache 10 นาที
// Upload: เว็บ GSC เดียวกับแท็บ Report, key = articleId
// PBN: GSC ของแต่ละเว็บ (pbnSites[].gscSiteUrl), key = `${articleId}::${siteId}` จับคู่กับ URL ใน pbnPushes

interface PerfRow { clicks: number; impressions: number; ctr: number; position: number; prevClicks: number; prevImpressions: number; prevPosition: number }

function byNormUrl(rows: RawGscRow[]): Map<string, GscMetric> {
  const m = new Map<string, GscMetric>()
  for (const r of rows) {
    const url = r.keys?.[0]
    if (url) m.set(normalizeReportUrl(url), rowMetric(r))
  }
  return m
}

function perfFor(url: string, cur: Map<string, GscMetric>, prev: Map<string, GscMetric>): PerfRow {
  const n = normalizeReportUrl(url)
  const c = cur.get(n)
  const p = prev.get(n)
  return {
    clicks: c?.clicks ?? 0, impressions: c?.impressions ?? 0, ctr: c?.ctr ?? 0, position: c?.position ?? 0,
    prevClicks: p?.clicks ?? 0, prevImpressions: p?.impressions ?? 0, prevPosition: p?.position ?? 0,
  }
}

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

/** POST /api/upload-article/clients/[id]/index-report body {days} — clicks/impressions/CTR/position ต่อบทความ (PBN = ต่อบทความต่อเว็บ) */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const prefs = parsePrefs(client.pushPrefs)
  const pbn = isPbnPrefs(prefs)
  const body = await req.json().catch(() => ({}))
  const days = typeof body?.days === 'number' && (REPORT_DAY_OPTIONS as readonly number[]).includes(body.days) ? body.days : 28
  const period = resolveReportPeriod({ days, compare: 'previous' })

  // งานที่ต้องดึง: เว็บ GSC → รายการ (key, url)
  const jobs = new Map<string, Array<{ key: string; url: string }>>()
  let warning: string | undefined
  if (pbn) {
    const sites = readPbnSites(prefs)
    const pushes = readPbnPushes(prefs)
    const noGsc = new Set<string>()
    for (const [articleId, bySite] of Object.entries(pushes)) {
      for (const [siteId, rec] of Object.entries(bySite)) {
        const site = sites.find((x) => x.id === siteId)
        if (!site || !rec.url) continue
        if (!site.gscSiteUrl) { noGsc.add(site.name); continue }
        const list = jobs.get(site.gscSiteUrl) ?? []
        list.push({ key: `${articleId}::${siteId}`, url: rec.url })
        jobs.set(site.gscSiteUrl, list)
      }
    }
    if (noGsc.size) warning = `เว็บที่ยังไม่ได้ตั้ง GSC (ดู performance ไม่ได้): ${Array.from(noGsc).join(', ')} — ตั้งได้ที่ Project Setting > เว็บ PBN`
    if (jobs.size === 0 && noGsc.size) return NextResponse.json({ error: warning, needSetup: true }, { status: 400 })
  } else {
    const siteUrl = (prefs.gscReport as UploadGscReportPrefs | undefined)?.siteUrl || ''
    if (!siteUrl) {
      return NextResponse.json({ error: 'ยังไม่ได้เลือกเว็บ GSC — เลือกเว็บที่แท็บ Report ก่อน', needSetup: true }, { status: 400 })
    }
    const articles = await prisma.uploadArticle.findMany({
      where: { clientId: params.id, organizationId: orgId, status: 'PUSHED' },
      select: { id: true, wordpressUrl: true, slug: true },
    })
    const base = client.website.replace(/\/+$/, '')
    jobs.set(siteUrl, articles.map((a) => ({ key: a.id, url: a.wordpressUrl || `${base}/${a.slug}` })))
  }

  const cacheKey = JSON.stringify({ clientId: params.id, period, jobs: Array.from(jobs.entries()) })
  const hit = cache.get(cacheKey)
  if (hit && Date.now() < hit.expiresAt) return NextResponse.json(hit.value)

  let auth: Awaited<ReturnType<typeof getGSCServiceAuth>>
  try {
    auth = await getGSCServiceAuth()
  } catch (e) {
    return NextResponse.json({ error: `เชื่อมต่อ Google ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  const sc = google.searchconsole({ version: 'v1', auth })

  const rows: Record<string, PerfRow> = {}
  const failed: string[] = []
  await Promise.all(Array.from(jobs.entries()).map(async ([siteUrl, items]) => {
    try {
      const [cur, prev] = await Promise.all([
        runQuery(sc, siteUrl, { startDate: period.start, endDate: period.end, dimensions: ['page'], type: 'web', rowLimit: 5000 }),
        runQuery(sc, siteUrl, { startDate: period.compareStart, endDate: period.compareEnd, dimensions: ['page'], type: 'web', rowLimit: 5000 }),
      ])
      const curMap = byNormUrl(cur)
      const prevMap = byNormUrl(prev)
      for (const it of items) rows[it.key] = perfFor(it.url, curMap, prevMap)
    } catch (e) {
      failed.push(isForbiddenError(e) ? `${siteUrl} (ไม่มีสิทธิ์)` : siteUrl)
    }
  }))

  if (failed.length && Object.keys(rows).length === 0 && jobs.size > 0) {
    const identity = await getServiceIdentity()
    return NextResponse.json({
      error: `ดึง GSC ไม่สำเร็จ: ${failed.join(', ')} — เพิ่ม ${identity.email || 'service account'} เป็นผู้ใช้ในเว็บนี้ที่ Search Console`,
    }, { status: 502 })
  }
  if (failed.length) warning = [warning, `ดึง GSC ไม่สำเร็จบางเว็บ: ${failed.join(', ')}`].filter(Boolean).join(' · ')

  const value = { period: { start: period.start, end: period.end }, rows, ...(warning ? { warning } : {}) }
  if (!failed.length) {
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    if (cache.size > 200) { const k = cache.keys().next().value; if (k) cache.delete(k) }
  }
  return NextResponse.json(value)
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
