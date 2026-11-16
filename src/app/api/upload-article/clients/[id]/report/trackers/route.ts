import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parsePrefs, updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import {
  addGscTracker, readGscTrackers, removeGscTracker, normalizeTrackerUrl, isIdPermalinkUrl,
  GSC_TRACKER_ERROR_MESSAGES, type AddGscTrackerResult,
} from '@/lib/upload-article/gsc-trackers'
import { resolveIdPermalink } from '@/lib/upload-article/gsc-tracker-resolve'

// ─── Upload Article > Report — รายการ keyword + URL ที่ "บันทึก Monitor" (เก็บใน pushPrefs.gscTrackers) ───

type Guard = { orgId: string } | { res: NextResponse }

async function guard(): Promise<Guard> {
  const session = await getSession()
  if (!session?.user?.organizationId) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { orgId: session.user.organizationId }
}

/** GET — รายการที่บันทึกไว้ */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: g.orgId }, select: { pushPrefs: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json({ trackers: readGscTrackers(parsePrefs(client.pushPrefs).gscTrackers) })
}

/** POST body {keyword, url, title?} — เพิ่มรายการ (ลิงก์ ?p=123 จะถูกแปลงเป็นลิงก์จริงถ้าหาเจอ) */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: g.orgId }, select: { pushPrefs: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const input: { keyword: unknown; url: unknown; title: unknown; sourceUrl?: string } = {
    keyword: body?.keyword,
    url: body?.url,
    title: body?.title,
  }

  // แปลงลิงก์เลขโพสต์ "นอก" updatePrefs — ไม่ถือล็อกแถวระหว่างยิงเน็ต
  const siteUrl = (parsePrefs(client.pushPrefs).gscReport as UploadGscReportPrefs | undefined)?.siteUrl || ''
  const normalized = normalizeTrackerUrl(input.url)
  if (normalized && siteUrl && isIdPermalinkUrl(normalized)) {
    const resolved = await resolveIdPermalink(normalized, siteUrl)
    // เก็บลิงก์จริงไว้เทียบข้อมูล และจำลิงก์ ?p= เดิมไว้ให้หน้าเว็บรู้ว่าแถวนั้นติดตามแล้ว
    if (resolved) { input.url = resolved; input.sourceUrl = normalized }
  }

  const result = await updatePrefs<AddGscTrackerResult>(params.id, g.orgId, (current) => {
    const existing = readGscTrackers(current.gscTrackers)
    const added = addGscTracker(existing, input, () => crypto.randomUUID().slice(0, 8), new Date().toISOString())
    if (!added.ok) return { result: added }
    const next: PrefsObject = { ...current, gscTrackers: added.trackers }
    return { prefs: next, result: added }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const out = result.result
  if (!out.ok) {
    return NextResponse.json(
      { error: GSC_TRACKER_ERROR_MESSAGES[out.error], code: out.error },
      { status: out.error === 'duplicate' ? 409 : 400 },
    )
  }
  return NextResponse.json({ trackers: out.trackers, tracker: out.tracker })
}

/** DELETE ?id=<trackerId> — ลบรายการ (id ที่ไม่มีไม่ถือเป็น error) */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const id = (req.nextUrl.searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'ไม่ระบุรายการที่จะลบ' }, { status: 400 })

  const result = await updatePrefs(params.id, g.orgId, (current) => {
    const trackers = removeGscTracker(readGscTrackers(current.gscTrackers), id)
    const next: PrefsObject = { ...current, gscTrackers: trackers }
    return { prefs: next, result: trackers }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json({ trackers: result.result })
}

export const dynamic = 'force-dynamic'
// POST อาจตาม redirect ของเว็บลูกค้าหลาย hop (hop ละไม่เกิน 5 วินาที)
export const maxDuration = 60
