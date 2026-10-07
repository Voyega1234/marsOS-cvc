import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { testSiteConnection, type SiteConnectionConfig, type SitePlatform } from '@/lib/sitePublishers'
import { testWordPressConnection } from '@/lib/upload-article/wp-push'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { updatePrefs } from '@/lib/upload-article/prefs-store'
import { connectionFingerprint } from '@/lib/upload-article/connection-status'

type ClientRow = { id: string; organizationId: string; websitePlatform: string; wpUrl: string; wpUser: string; wpAppPasswordEnc: string; siteConnection: string }

/** จดผลทดสอบลง pushPrefs.connectionTest ให้หน้า Connect แสดงค้างไว้ — ล้มก็ไม่กระทบผลทดสอบ */
async function recordTest(client: ClientRow, ok: boolean, message: string) {
  await updatePrefs(client.id, client.organizationId, (current) => ({
    prefs: { ...current, connectionTest: { platform: client.websitePlatform || 'wordpress', ok, message: message.slice(0, 300), at: new Date().toISOString(), fp: connectionFingerprint(client) } },
    result: null,
  })).catch(() => null)
}

/** POST /api/upload-article/clients/[id]/connect-test — ทดสอบการเชื่อมต่อเว็บปลายทางด้วย credentials ที่บันทึกไว้ */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  if (client.websitePlatform && client.websitePlatform !== 'wordpress') {
    let conn: SiteConnectionConfig = {}
    try {
      conn = JSON.parse(client.siteConnection || '{}')
    } catch {
      conn = {}
    }
    const result = await testSiteConnection(client.websitePlatform as SitePlatform, conn)
    if (!result.ok) {
      await recordTest(client, false, result.error || 'เชื่อมต่อไม่สำเร็จ')
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    // Webflow: จด siteId (ใช้อัปโหลดรูปตอน push) + URL เว็บ — ไม่ใช่ secret, merge เฉพาะ 2 key นี้
    let saved = client
    const wf = conn.webflow ?? {}
    if (client.websitePlatform === 'webflow' && ((result.siteId && wf.siteId !== result.siteId) || (result.url && wf.siteUrl !== result.url))) {
      const next = { ...conn, webflow: { ...wf, ...(result.siteId ? { siteId: result.siteId } : {}), ...(result.url ? { siteUrl: result.url } : {}) } }
      saved = await prisma.uploadClient.update({ where: { id: client.id }, data: { siteConnection: JSON.stringify(next) } })
    }
    await recordTest(saved, true, result.name || client.websitePlatform)
    return NextResponse.json({ ok: true, message: result.name || client.websitePlatform, url: result.url, choices: result.choices })
  }

  if (!client.wpUrl || !client.wpUser || !client.wpAppPasswordEnc) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า WordPress URL / User / Application Password' }, { status: 400 })
  }
  const credErr = await checkCredentialUrl(client.wpUrl)
  if (credErr) return NextResponse.json({ error: credErr }, { status: 400 })
  let wpPass = ''
  try {
    wpPass = decrypt(client.wpAppPasswordEnc)
  } catch {
    return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ' }, { status: 500 })
  }

  const result = await testWordPressConnection(client.wpUrl, client.wpUser, wpPass)
  await recordTest(client, result.ok, result.ok ? (result.name || client.wpUser) : (result.error || 'เชื่อมต่อไม่สำเร็จ'))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, message: result.name || client.wpUser, user: result.name })
}
