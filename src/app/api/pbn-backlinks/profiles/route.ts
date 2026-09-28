import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId, getOrCreatePbnClientId } from '@/lib/upload-article/pbn-store'
import { PBN_MAX_PROFILES, readPbnProfiles, type PbnProfile } from '@/lib/upload-article/pbn-sets'
import { parsePbnProfileInput } from './input'

export const dynamic = 'force-dynamic'

/** GET /api/pbn-backlinks/profiles — set ข้อมูลโปรเจกต์เพิ่มเติม (set หลักอยู่ที่ client.website / client.language) */
export async function GET() {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const clientId = await findPbnClientId(orgId)
  if (!clientId) return NextResponse.json({ profiles: [] })
  const prefs = await readPrefs(clientId, orgId)
  return NextResponse.json({ profiles: readPbnProfiles(prefs) })
}

/** POST /api/pbn-backlinks/profiles body {name, website, language} — เพิ่ม set ข้อมูลโปรเจกต์ */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const body = await req.json().catch(() => null)
  const input = parsePbnProfileInput(body)
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })

  const clientId = await getOrCreatePbnClientId(orgId, session.user.id)
  const profile: PbnProfile = { id: randomUUID(), ...input, createdAt: new Date().toISOString() }
  const out = await updatePrefs(clientId, orgId, (current) => {
    const profiles = readPbnProfiles(current)
    if (profiles.length >= PBN_MAX_PROFILES) return { result: 'full' as const }
    return { prefs: { ...current, pbnProfiles: [...profiles, profile] }, result: 'ok' as const }
  })
  if (!out) return NextResponse.json({ error: 'ไม่พบโปรเจกต์ PBN' }, { status: 404 })
  if (out.result === 'full') return NextResponse.json({ error: `เพิ่ม set ได้สูงสุด ${PBN_MAX_PROFILES} set` }, { status: 400 })
  return NextResponse.json({ profile }, { status: 201 })
}
