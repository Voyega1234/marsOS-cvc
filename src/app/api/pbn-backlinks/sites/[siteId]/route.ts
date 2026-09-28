import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { updatePrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId } from '@/lib/upload-article/pbn-store'
import { mergePbnSiteInput, readPbnSites, toPbnSiteDTO, type PbnSite } from '@/lib/upload-article/pbn'
import { readPbnStyles } from '@/lib/upload-article/pbn-sets'

export const dynamic = 'force-dynamic'

async function auth() {
  const session = await getSession()
  if (!session?.user?.organizationId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const orgId = session.user.organizationId
  const clientId = await findPbnClientId(orgId)
  if (!clientId) return { error: NextResponse.json({ error: 'ไม่พบเว็บนี้' }, { status: 404 }) }
  return { orgId, clientId }
}

/** PATCH /api/pbn-backlinks/sites/[siteId] — แก้ค่าเว็บ PBN (secret ว่าง = คงค่าเดิม, null = ลบ) */
export async function PATCH(req: NextRequest, { params }: { params: { siteId: string } }) {
  const a = await auth()
  if ('error' in a) return a.error
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })

  const out = await updatePrefs(a.clientId, a.orgId, (current) => {
    const sites = readPbnSites(current)
    const idx = sites.findIndex((s) => s.id === params.siteId)
    if (idx === -1) return { result: { status: 404, error: 'ไม่พบเว็บนี้' } as { status: number; error?: string; site?: PbnSite; cleared?: string[] } }
    const merged = mergePbnSiteInput(body as Record<string, unknown>, sites[idx], encrypt, randomUUID)
    if (!merged.site) return { result: { status: 400, error: merged.error } }
    const next = [...sites]
    next[idx] = merged.site
    return { prefs: { ...current, pbnSites: next }, result: { status: 200, site: merged.site, cleared: merged.cleared } }
  })
  if (!out) return NextResponse.json({ error: 'ไม่พบโปรเจกต์ PBN' }, { status: 404 })
  const r = out.result
  if (!r.site) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ site: toPbnSiteDTO(r.site), cleared: r.cleared ?? [] })
}

/** DELETE /api/pbn-backlinks/sites/[siteId] — ลบเว็บ PBN ออกจากรายการ (ไม่แตะโพสต์ที่ขึ้นเว็บไปแล้ว) */
export async function DELETE(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const a = await auth()
  if ('error' in a) return a.error
  const out = await updatePrefs(a.clientId, a.orgId, (current) => {
    const sites = readPbnSites(current)
    if (!sites.some((s) => s.id === params.siteId)) return { result: false }
    // สไตล์บทความของเว็บนี้ลบตามไปด้วย (บทความที่เขียนไว้แล้วกลับไปใช้สไตล์หลัก)
    const styles = readPbnStyles(current)
    delete styles[params.siteId]
    return { prefs: { ...current, pbnSites: sites.filter((s) => s.id !== params.siteId), pbnStyles: styles }, result: true }
  })
  if (!out?.result) return NextResponse.json({ error: 'ไม่พบเว็บนี้' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
