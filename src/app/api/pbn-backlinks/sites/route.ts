import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId, getOrCreatePbnClientId } from '@/lib/upload-article/pbn-store'
import { mergePbnSiteInput, readPbnPushes, readPbnSites, toPbnSiteDTO } from '@/lib/upload-article/pbn'

export const dynamic = 'force-dynamic'

const MAX_SITES = 200

/** GET /api/pbn-backlinks/sites — รายการเว็บ PBN (ไม่มี secret) + ประวัติ push ต่อบทความต่อเว็บ */
export async function GET() {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const clientId = await findPbnClientId(orgId)
  if (!clientId) return NextResponse.json({ sites: [], pushes: {} })
  const prefs = await readPrefs(clientId, orgId)
  return NextResponse.json({ sites: readPbnSites(prefs).map(toPbnSiteDTO), pushes: readPbnPushes(prefs) })
}

/** POST /api/pbn-backlinks/sites — เพิ่มเว็บ PBN */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })

  const clientId = await getOrCreatePbnClientId(orgId, session.user.id)
  const merged = mergePbnSiteInput(body as Record<string, unknown>, null, encrypt, randomUUID)
  if (!merged.site) return NextResponse.json({ error: merged.error }, { status: 400 })
  const site = merged.site

  const out = await updatePrefs(clientId, orgId, (current) => {
    const sites = readPbnSites(current)
    if (sites.length >= MAX_SITES) return { result: 'full' as const }
    return { prefs: { ...current, pbnSites: [...sites, site] }, result: 'ok' as const }
  })
  if (!out) return NextResponse.json({ error: 'ไม่พบโปรเจกต์ PBN' }, { status: 404 })
  if (out.result === 'full') return NextResponse.json({ error: `เพิ่มเว็บได้สูงสุด ${MAX_SITES} เว็บ` }, { status: 400 })
  return NextResponse.json({ site: toPbnSiteDTO(site) }, { status: 201 })
}
