import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { testSiteConnection, type SiteConnectionConfig, type SitePlatform } from '@/lib/sitePublishers'
import { testWordPressConnection } from '@/lib/upload-article/wp-push'

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
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, message: result.name || client.websitePlatform })
  }

  if (!client.wpUrl || !client.wpUser || !client.wpAppPasswordEnc) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า WordPress URL / User / Application Password' }, { status: 400 })
  }
  let wpPass = ''
  try {
    wpPass = decrypt(client.wpAppPasswordEnc)
  } catch {
    return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ' }, { status: 500 })
  }

  const result = await testWordPressConnection(client.wpUrl, client.wpUser, wpPass)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, message: result.name || client.wpUser, user: result.name })
}
