import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { updatePrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId } from '@/lib/upload-article/pbn-store'
import { readPbnProfiles, type PbnProfile } from '@/lib/upload-article/pbn-sets'
import { parsePbnProfileInput } from '../input'

export const dynamic = 'force-dynamic'

async function auth() {
  const session = await getSession()
  if (!session?.user?.organizationId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const orgId = session.user.organizationId
  const clientId = await findPbnClientId(orgId)
  if (!clientId) return { error: NextResponse.json({ error: 'ไม่พบ set นี้' }, { status: 404 }) }
  return { orgId, clientId }
}

/** PATCH /api/pbn-backlinks/profiles/[profileId] body {name, website, language} */
export async function PATCH(req: NextRequest, { params }: { params: { profileId: string } }) {
  const a = await auth()
  if ('error' in a) return a.error
  const input = parsePbnProfileInput(await req.json().catch(() => null))
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const out = await updatePrefs(a.clientId, a.orgId, (current) => {
    const profiles = readPbnProfiles(current)
    const idx = profiles.findIndex((p) => p.id === params.profileId)
    if (idx === -1) return { result: null as PbnProfile | null }
    const next = [...profiles]
    next[idx] = { ...profiles[idx], ...input, updatedAt: new Date().toISOString() }
    return { prefs: { ...current, pbnProfiles: next }, result: next[idx] }
  })
  if (!out?.result) return NextResponse.json({ error: 'ไม่พบ set นี้' }, { status: 404 })
  return NextResponse.json({ profile: out.result })
}

/**
 * DELETE /api/pbn-backlinks/profiles/[profileId] — ลบ set ออกจากรายการ
 * prompt ของ Content Engine ใน set นี้ไม่ถูกลบ (ไม่ถูกใช้แล้ว) บทความที่เขียนไว้กลับไปใช้ set หลัก
 */
export async function DELETE(_req: NextRequest, { params }: { params: { profileId: string } }) {
  const a = await auth()
  if ('error' in a) return a.error
  const out = await updatePrefs(a.clientId, a.orgId, (current) => {
    const profiles = readPbnProfiles(current)
    if (!profiles.some((p) => p.id === params.profileId)) return { result: false }
    return { prefs: { ...current, pbnProfiles: profiles.filter((p) => p.id !== params.profileId) }, result: true }
  })
  if (!out?.result) return NextResponse.json({ error: 'ไม่พบ set นี้' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
