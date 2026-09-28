import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId } from '@/lib/upload-article/pbn-store'
import { readPbnSites } from '@/lib/upload-article/pbn'
import { testWordPressConnection } from '@/lib/upload-article/wp-push'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { testGithubConnection } from '@/lib/upload-article/github-push'

export const dynamic = 'force-dynamic'

/** POST /api/pbn-backlinks/sites/[siteId]/test — ทดสอบการเชื่อมต่อด้วยค่าที่บันทึกไว้ */
export async function POST(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const clientId = await findPbnClientId(orgId)
  const prefs = clientId ? await readPrefs(clientId, orgId) : null
  const site = readPbnSites(prefs).find((s) => s.id === params.siteId)
  if (!site) return NextResponse.json({ error: 'ไม่พบเว็บนี้' }, { status: 404 })

  if (site.platform === 'github') {
    if (!site.ghTokenEnc) return NextResponse.json({ error: 'ยังไม่ได้ใส่ GitHub Token' }, { status: 400 })
    let token = ''
    try {
      token = decrypt(site.ghTokenEnc)
    } catch {
      return NextResponse.json({ error: 'ถอดรหัส GitHub Token ไม่สำเร็จ — ใส่ Token ใหม่' }, { status: 500 })
    }
    const r = await testGithubConnection({ owner: site.ghOwner || '', repo: site.ghRepo || '', branch: site.ghBranch, token })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, message: r.name })
  }

  const wpUrl = site.wpUrl || site.siteUrl
  if (!wpUrl || !site.wpUser || !site.wpPassEnc) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า WordPress URL / User / Application Password' }, { status: 400 })
  }
  const credErr = await checkCredentialUrl(wpUrl)
  if (credErr) return NextResponse.json({ error: credErr }, { status: 400 })
  let wpPass = ''
  try {
    wpPass = decrypt(site.wpPassEnc)
  } catch {
    return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ' }, { status: 500 })
  }
  const r = await testWordPressConnection(wpUrl, site.wpUser, wpPass)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, message: r.name || site.wpUser })
}
