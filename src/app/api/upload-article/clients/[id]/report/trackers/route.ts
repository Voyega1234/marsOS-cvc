import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parsePrefs, updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import type { UploadGscReportPrefs } from '@/lib/upload-article/types'
import {
  addGscTracker, addGscTrackersBulk, adoptGroupNamesake, readGscTrackers, removeGscTrackers, updateGscTrackers, UPLOAD_MAX_GSC_TRACKERS, isTrackerFoldersClient, normalizeTrackerUrl, isIdPermalinkUrl,
  GSC_TRACKER_ERROR_MESSAGES, type AddGscTrackerResult,
} from '@/lib/upload-article/gsc-trackers'
import { readOwnerTags } from '@/lib/upload-article/owner-tags'

/** ownerTag.id ที่มีอยู่จริงของลูกค้านี้ — ใช้ทิ้ง ownerTagId ที่ไม่รู้จัก */
function ownerIdSet(prefs: PrefsObject): Set<string> {
  return new Set(readOwnerTags(prefs.ownerTags).map((t) => t.id))
}

/** ids จาก body.ids (array) หรือ body.id / ?ids=a,b / ?id=a — ตัดซ้ำและตัดตามเพดาน */
function readIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const out = new Set<string>()
  for (const v of list) {
    if (typeof v !== 'string') continue
    const id = v.trim().slice(0, 64)
    if (id) out.add(id)
    if (out.size >= UPLOAD_MAX_GSC_TRACKERS) break
  }
  return Array.from(out)
}
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

/**
 * POST body {kind?, keyword?, url?, title?, ownerTagId?, group?, subgroup?} — เพิ่มรายการ (ลิงก์ ?p=123 จะถูกแปลงเป็นลิงก์จริงถ้าหาเจอ)
 * หรือ {keywords: string[], group?, ownerTagId?} — เพิ่มหลายคำ (keyword ทั้งเว็บ) เข้ากลุ่มเดียวกัน
 * kind: 'keyword' (คำนี้ทั้งเว็บ) | 'page' (หน้านี้ทุกคำ) | 'pair' (คำนี้บนหน้านี้); ไม่ส่ง = ดูจากช่องที่กรอก
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: g.orgId }, select: { name: true, pushPrefs: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  // Keyword groups (subgroup) are on for every client (isTrackerFoldersClient)
  const allowSub = isTrackerFoldersClient(client.name)

  const body = await req.json().catch(() => ({}))

  // เพิ่มหลายคำพร้อมกัน (จาก "หาคำใกล้เคียง") — keyword ทั้งเว็บ, กลุ่ม/ผู้ดูแลเดียวกัน
  if (Array.isArray(body?.keywords)) {
    const keywords = (body.keywords as unknown[]).slice(0, UPLOAD_MAX_GSC_TRACKERS)
    if (keywords.length === 0) return NextResponse.json({ error: 'ยังไม่ได้เลือกคำ' }, { status: 400 })
    const bulk = await updatePrefs(params.id, g.orgId, (current) => {
      const r = addGscTrackersBulk(readGscTrackers(current.gscTrackers), keywords, { group: body?.group, subgroup: allowSub ? body?.subgroup : undefined, ownerTagId: body?.ownerTagId },
        () => crypto.randomUUID().slice(0, 8), new Date().toISOString(), ownerIdSet(current))
      if (r.added.length === 0) return { result: r }
      // the keyword the group is named after joins the group too
      const trackers = allowSub ? adoptGroupNamesake(r.trackers, body?.group, body?.subgroup) : r.trackers
      const next: PrefsObject = { ...current, gscTrackers: trackers }
      return { prefs: next, result: { ...r, trackers } }
    })
    if (!bulk) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
    const r = bulk.result
    if (r.added.length === 0) {
      const error = r.overLimit ? GSC_TRACKER_ERROR_MESSAGES.limit : r.duplicates ? 'คำที่เลือกติดตามอยู่แล้วทั้งหมด' : 'ไม่มีคำที่เพิ่มได้'
      return NextResponse.json({ error, ...r, added: 0 }, { status: r.overLimit ? 400 : 409 })
    }
    return NextResponse.json({ trackers: r.trackers, added: r.added.length, duplicates: r.duplicates, invalid: r.invalid, overLimit: r.overLimit })
  }

  const input: { kind: unknown; keyword: unknown; url: unknown; title: unknown; ownerTagId: unknown; group: unknown; subgroup: unknown; sourceUrl?: string } = {
    kind: body?.kind,
    keyword: body?.keyword,
    url: body?.url,
    title: body?.title,
    ownerTagId: body?.ownerTagId,
    group: body?.group,
    subgroup: allowSub ? body?.subgroup : undefined,
  }

  // แปลงลิงก์เลขโพสต์ "นอก" updatePrefs — ไม่ถือล็อกแถวระหว่างยิงเน็ต
  const siteUrl = (parsePrefs(client.pushPrefs).gscReport as UploadGscReportPrefs | undefined)?.siteUrl || ''
  const normalized = input.kind === 'keyword' ? '' : normalizeTrackerUrl(input.url)
  if (normalized && siteUrl && isIdPermalinkUrl(normalized)) {
    const resolved = await resolveIdPermalink(normalized, siteUrl)
    // เก็บลิงก์จริงไว้เทียบข้อมูล และจำลิงก์ ?p= เดิมไว้ให้หน้าเว็บรู้ว่าแถวนั้นติดตามแล้ว
    if (resolved) { input.url = resolved; input.sourceUrl = normalized }
  }

  const result = await updatePrefs<AddGscTrackerResult>(params.id, g.orgId, (current) => {
    const existing = readGscTrackers(current.gscTrackers)
    const added = addGscTracker(existing, input, () => crypto.randomUUID().slice(0, 8), new Date().toISOString(), ownerIdSet(current))
    if (!added.ok) return { result: added }
    const trackers = allowSub ? adoptGroupNamesake(added.trackers, input.group, input.subgroup) : added.trackers
    const next: PrefsObject = { ...current, gscTrackers: trackers }
    return { prefs: next, result: { ...added, trackers } }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const out = result.result
  if (!out.ok) {
    return NextResponse.json(
      { error: GSC_TRACKER_ERROR_MESSAGES[out.error], code: out.error },
      { status: out.error.startsWith('duplicate') ? 409 : 400 },
    )
  }
  return NextResponse.json({ trackers: out.trackers, tracker: out.tracker })
}

/**
 * PATCH body {ids: string[] (หรือ id), ownerTagId?, group?, subgroup?} — แก้ผู้ดูแล/กลุ่ม/กลุ่มย่อยของหลายรายการพร้อมกัน
 * เฉพาะช่องที่ส่งมา; ownerTagId ว่าง/ไม่รู้จัก = ล้างผู้ดูแล, group ว่าง = เอาออกจากกลุ่ม, subgroup ว่าง = เอาออกจากกลุ่มย่อย
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const body = await req.json().catch(() => ({}))
  const ids = readIds(body?.ids ?? body?.id)
  if (ids.length === 0) return NextResponse.json({ error: 'ไม่ระบุรายการ' }, { status: 400 })
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: g.orgId }, select: { name: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  const allowSub = isTrackerFoldersClient(client.name)
  const patch: { ownerTagId?: unknown; group?: unknown; subgroup?: unknown } = {}
  if (body && 'ownerTagId' in body) patch.ownerTagId = body.ownerTagId ?? ''
  if (body && 'group' in body) patch.group = body.group ?? ''
  if (allowSub && body && 'subgroup' in body) patch.subgroup = body.subgroup ?? ''
  if (!('ownerTagId' in patch) && !('group' in patch) && !('subgroup' in patch)) return NextResponse.json({ error: 'ไม่มีอะไรให้แก้' }, { status: 400 })

  const result = await updatePrefs<ReturnType<typeof updateGscTrackers>>(params.id, g.orgId, (current) => {
    const trackers = updateGscTrackers(readGscTrackers(current.gscTrackers), ids, patch, ownerIdSet(current))
    if (!trackers) return { result: null }
    const next: PrefsObject = { ...current, gscTrackers: trackers }
    return { prefs: next, result: trackers }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if (!result.result) return NextResponse.json({ error: 'ไม่พบรายการที่ติดตาม' }, { status: 404 })
  return NextResponse.json({ trackers: result.result })
}

/** DELETE ?id=<trackerId> หรือ ?ids=a,b — ลบรายการ (id ที่ไม่มีไม่ถือเป็น error) */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const sp = req.nextUrl.searchParams
  const ids = readIds(sp.get('ids') ?? sp.get('id') ?? '')
  if (ids.length === 0) return NextResponse.json({ error: 'ไม่ระบุรายการที่จะลบ' }, { status: 400 })

  const result = await updatePrefs(params.id, g.orgId, (current) => {
    const trackers = removeGscTrackers(readGscTrackers(current.gscTrackers), ids)
    const next: PrefsObject = { ...current, gscTrackers: trackers }
    return { prefs: next, result: trackers }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json({ trackers: result.result })
}

export const dynamic = 'force-dynamic'
// POST อาจตาม redirect ของเว็บลูกค้าหลาย hop (hop ละไม่เกิน 5 วินาที)
export const maxDuration = 60
