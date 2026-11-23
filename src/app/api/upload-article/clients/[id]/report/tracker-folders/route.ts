import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parsePrefs, updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import {
  applyTrackerFolderOp, isTrackerFoldersClient, readGscTrackers, readTrackerFolders,
  type TrackerFolderError, type UploadGscTracker, type UploadGscTrackerFolder,
} from '@/lib/upload-article/gsc-trackers'
import { readOwnerTags } from '@/lib/upload-article/owner-tags'

// ─── Upload Article > Report — project folders + keyword groups ───
// Folder records live in pushPrefs.gscTrackerFolders; trackers stay in pushPrefs.gscTrackers.

type Guard = { orgId: string } | { res: NextResponse }

async function guard(): Promise<Guard> {
  const session = await getSession()
  if (!session?.user?.organizationId) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { orgId: session.user.organizationId }
}

/** ownerTag.id that exist for this client — unknown ids are dropped */
function ownerIdSet(prefs: PrefsObject): Set<string> {
  return new Set(readOwnerTags(prefs.ownerTags).map((t) => t.id))
}

const ERRORS: Record<TrackerFolderError, { message: string; status: number }> = {
  invalid: { message: 'ข้อมูลไม่ถูกต้อง', status: 400 },
  duplicate: { message: 'มีโฟลเดอร์/กลุ่มชื่อนี้แล้ว', status: 409 },
  limit: { message: 'ครบจำนวนสูงสุดแล้ว', status: 400 },
  not_found: { message: 'ไม่พบโฟลเดอร์หรือกลุ่ม', status: 404 },
}

const ONLY_CONVERT_CAKE = 'ใช้ได้เฉพาะโปรเจกต์ Convert Cake'

/** GET — folder records */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: g.orgId }, select: { name: true, pushPrefs: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if (!isTrackerFoldersClient(client.name)) return NextResponse.json({ error: ONLY_CONVERT_CAKE }, { status: 403 })
  return NextResponse.json({ folders: readTrackerFolders(parsePrefs(client.pushPrefs).gscTrackerFolders) })
}

/**
 * POST body = {op: 'create'|'createSub'|'rename'|'renameSub'|'owner'|'delete'|'deleteSub', ...} — see applyTrackerFolderOp
 * Returns {folders, trackers} after the change.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard()
  if ('res' in g) return g.res
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: g.orgId }, select: { name: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if (!isTrackerFoldersClient(client.name)) return NextResponse.json({ error: ONLY_CONVERT_CAKE }, { status: 403 })

  const body = await req.json().catch(() => null)
  type Out = { ok: true; folders: UploadGscTrackerFolder[]; trackers: UploadGscTracker[] } | { ok: false; error: TrackerFolderError }
  const result = await updatePrefs<Out>(params.id, g.orgId, (current) => {
    const r = applyTrackerFolderOp(
      readTrackerFolders(current.gscTrackerFolders), readGscTrackers(current.gscTrackers), body, ownerIdSet(current), new Date().toISOString(),
    )
    if (!r.ok) return { result: r }
    const next: PrefsObject = { ...current, gscTrackerFolders: r.folders, gscTrackers: r.trackers }
    return { prefs: next, result: r }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  const out = result.result
  if (!out.ok) return NextResponse.json({ error: ERRORS[out.error].message, code: out.error }, { status: ERRORS[out.error].status })
  return NextResponse.json({ folders: out.folders, trackers: out.trackers })
}

export const dynamic = 'force-dynamic'
