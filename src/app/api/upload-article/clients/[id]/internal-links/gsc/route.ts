import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGSCAuth } from '@/lib/google-auth'
import { updatePrefs } from '@/lib/upload-article/prefs-store'
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks, type UploadLinkPair } from '@/lib/upload-article/types'

function readLinks(prefs: Record<string, unknown> | null): UploadInternalLinks {
  const raw = prefs?.internalLinks
  return { ...DEFAULT_UPLOAD_INTERNAL_LINKS, ...(raw && typeof raw === 'object' ? (raw as Partial<UploadInternalLinks>) : {}) }
}

/** GET /api/upload-article/clients/[id]/internal-links/gsc?source=properties — รายชื่อ GSC property ที่บัญชีนี้เข้าถึงได้ */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const source = req.nextUrl.searchParams.get('source') ?? 'properties'
  if (source !== 'properties') return NextResponse.json({ error: 'source ไม่ถูกต้อง' }, { status: 400 })

  try {
    const auth = await getGSCAuth()
    const sc = google.searchconsole({ version: 'v1', auth })
    const res = await sc.sites.list()
    const properties = (res.data.siteEntry ?? [])
      .map((s: { siteUrl?: string | null }) => s.siteUrl ?? '')
      .filter(Boolean)
    return NextResponse.json({ properties })
  } catch {
    return NextResponse.json({ properties: [] })
  }
}

/** POST /api/upload-article/clients/[id]/internal-links/gsc body {siteUrl} — ดึงคู่ query/page 90 วันล่าสุด บันทึกลง internalLinks.gsc */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const siteUrl = typeof body?.siteUrl === 'string' ? body.siteUrl.trim() : ''
  if (!siteUrl) return NextResponse.json({ error: 'ต้องระบุ siteUrl' }, { status: 400 })

  let pairs: UploadLinkPair[]
  try {
    const auth = await getGSCAuth()
    const sc = google.searchconsole({ version: 'v1', auth })
    const now = new Date()
    const endDate = new Date(now.getTime() - 3 * 86400000)
    const startDate = new Date(endDate.getTime() - 90 * 86400000)
    const fmt = (d: Date) => d.toISOString().split('T')[0]

    const res = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        dimensions: ['query', 'page'],
        rowLimit: 5000,
      } as never,
    })

    const rows = (res.data.rows ?? []) as { keys?: string[] | null; clicks?: number | null }[]
    // เก็บ query ที่คลิกมากที่สุดต่อ 1 page
    const byPage = new Map<string, UploadLinkPair>()
    for (const r of rows) {
      const keyword = r.keys?.[0] ?? ''
      const url = r.keys?.[1] ?? ''
      const clicks = r.clicks ?? 0
      if (!url) continue
      const existing = byPage.get(url)
      if (!existing || clicks > (existing.clicks ?? 0)) {
        byPage.set(url, { keyword, url, clicks })
      }
    }
    pairs = Array.from(byPage.values())
      .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
      .slice(0, 1000)
  } catch (e) {
    return NextResponse.json({ error: `ดึงข้อมูล GSC ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }

  const result = await updatePrefs(params.id, session.user.organizationId, (current) => {
    const currentLinks = readLinks(current)
    const nextLinks: UploadInternalLinks = {
      ...currentLinks,
      gscSiteUrl: siteUrl,
      gsc: pairs,
      gscFetchedAt: new Date().toISOString(),
    }
    return { prefs: { ...current, internalLinks: nextLinks }, result: nextLinks }
  })

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
