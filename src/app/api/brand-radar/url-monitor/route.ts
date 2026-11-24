import { NextRequest, NextResponse } from 'next/server'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { parseFilters } from '@/lib/brand-radar/queries'
import { cleanMonitoredInput } from '@/lib/brand-radar/url-monitor'
import { addMonitoredUrl, buildUrlMonitor, loadMonitoredUrls, removeMonitoredUrl } from '@/lib/brand-radar/url-monitor-load'

export const dynamic = 'force-dynamic'

// Staff only (requireProject): the monitored list is an internal working tool, not part of the customer report.

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const urlId = (sp.get('urlId') ?? '').trim().slice(0, 100) || null
  return NextResponse.json(await buildUrlMonitor(ctx, parseFilters(sp), urlId))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const existing = await loadMonitoredUrls(ctx.project.id)
  const clean = cleanMonitoredInput(body.url, body.prefix, existing)
  if (!clean.ok) return bad(clean.error, clean.status)
  return NextResponse.json(await addMonitoredUrl(ctx.project.id, existing, clean.item))
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  if (typeof body.id !== 'string' || !body.id) return bad('id is required')
  const urls = await removeMonitoredUrl(ctx.project.id, body.id)
  if (!urls) return bad('ไม่พบ URL นี้ในรายการ', 404)
  return NextResponse.json({ urls })
}
