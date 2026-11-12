import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId } from '@/lib/upload-article/pbn-store'
import { readPbnSites } from '@/lib/upload-article/pbn'
import { isMagazineSite } from '@/lib/upload-article/pbn-magazine'
import { loadMagazineClusters } from '@/lib/upload-article/pbn-magazine-push'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pbn-backlinks/sites/[siteId]/clusters — รายการหมวดของเว็บโครง magazine (khaoduan / roothan)
 * อ่านสดจาก site.config.json ใน repo ของเว็บ — หมวดที่เว็บเพิ่ม/ลบจะตามทันโดยไม่ต้องตั้งค่าซ้ำฝั่งเรา
 */
export async function GET(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const clientId = await findPbnClientId(orgId)
  const prefs = clientId ? await readPrefs(clientId, orgId) : null
  const site = readPbnSites(prefs).find((s) => s.id === params.siteId)
  if (!site) return NextResponse.json({ error: 'ไม่พบเว็บนี้' }, { status: 404 })
  if (!isMagazineSite(site)) return NextResponse.json({ sections: [], count: 0 })
  if (!site.ghTokenEnc || !site.ghOwner || !site.ghRepo) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า GitHub ของเว็บนี้ครบ (owner / repo / token)' }, { status: 400 })
  }
  let token = ''
  try {
    token = decrypt(site.ghTokenEnc)
  } catch {
    return NextResponse.json({ error: 'ถอดรหัส GitHub Token ไม่สำเร็จ — ใส่ Token ใหม่' }, { status: 500 })
  }
  const r = await loadMagazineClusters(site, { owner: site.ghOwner, repo: site.ghRepo, branch: site.ghBranch, token })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r.clusters)
}
