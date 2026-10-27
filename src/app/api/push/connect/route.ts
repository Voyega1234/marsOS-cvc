import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { testWordPressConnection } from '@/lib/upload-article/wp-push'
import { testSiteConnection, type SiteConnectionConfig, type SitePlatform } from '@/lib/sitePublishers'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, connectionId } = await req.json()
  const orgId = session.user.organizationId

  // ── แพลตฟอร์มอื่นที่ไม่ใช่ WordPress → ทดสอบผ่าน sitePublishers ──
  if (projectId && !connectionId) {
    const proj = await (prisma.project as any).findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { websitePlatform: true, siteConnection: true, website: true },
    }).catch(() => null)
    const platform = proj?.websitePlatform as string | null
    if (platform && platform !== 'wordpress') {
      let conn: SiteConnectionConfig = {}
      try { conn = JSON.parse(proj?.siteConnection || '{}') } catch { /* ว่าง */ }
      const result = await testSiteConnection(platform as SitePlatform, conn, { siteUrl: proj?.website ?? '' })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
      // Wix: Site ID / ผู้เขียนที่ระบบแก้ให้ — บันทึกทันที
      if (platform === 'wix' && result.fixes) {
        const next = { ...conn, wix: { ...(conn.wix ?? {}), ...result.fixes } }
        await prisma.project.updateMany({ where: { id: projectId, organizationId: orgId }, data: { siteConnection: JSON.stringify(next) } as any })
      }
      return NextResponse.json({
        url: result.url ?? '', name: result.name ?? platform, version: '',
        source: platform, choices: result.choices ?? {}, hint: result.hint, fixes: result.fixes,
      })
    }
  }

  let wpUrl = '', wpUser = '', wpPass = '', source = 'env'
  let decryptFailed = false

  // 1. Use explicit connectionId (from dropdown in Push tab)
  // Normalize WP URL: strip /wp-admin, /wp-login.php, trailing slash
  function normalizeWpUrl(raw: string): string {
    return raw.trim().replace(/\/(wp-admin|wp-login\.php)(\/.*)?$/, '').replace(/\/$/, '')
  }

  if (connectionId) {
    const conn = await prisma.wordPressConnection.findFirst({
      where: { id: connectionId, organizationId: orgId },
    })
    if (conn) {
      wpUrl  = normalizeWpUrl(conn.siteUrl)
      wpUser = conn.username.trim()
      try { wpPass = decrypt(conn.appPasswordEncrypted) } catch { wpPass = ''; decryptFailed = true }
      source = 'connection'
    }
  }

  // 2. Project's linked WordPressConnection
  if (!wpUrl && projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      include: { wordpressConnection: true },
    })
    const conn = project?.wordpressConnection
    if (conn) {
      wpUrl  = normalizeWpUrl(conn.siteUrl)
      wpUser = conn.username.trim()
      try { wpPass = decrypt(conn.appPasswordEncrypted) } catch { wpPass = ''; decryptFailed = true }
      source = 'connection'
    }
    // 3. Per-project inline credentials
    if (!wpUrl) {
      wpUrl  = normalizeWpUrl((project as any)?.wpUrl ?? '')
      wpUser = (project as any)?.wpUser?.trim() ?? ''
      wpPass = (project as any)?.wpAppPassword?.trim() ?? ''
      if (wpUrl) source = 'project'
    }
  }

  // ถอดรหัสไม่ได้ = หยุด ห้ามเอารหัสจาก .env ไปส่งให้เว็บลูกค้า
  if (decryptFailed) {
    return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ — ใส่รหัสใหม่' }, { status: 400 })
  }

  // 4. .env fallback — ใช้เฉพาะเมื่อไม่มี URL จาก connection/project และเอาทั้ง 3 ค่าจาก env ชุดเดียวกัน ห้ามปน
  if (!wpUrl) {
    wpUrl  = normalizeWpUrl(process.env.WP_URL ?? '')
    wpUser = process.env.WP_USER?.trim() ?? ''
    wpPass = process.env.WP_APP_PASSWORD?.trim() ?? ''
    source = 'env'
  }

  if (!wpUrl || !wpUser || !wpPass) {
    return NextResponse.json({ error: 'ไม่พบ WordPress credentials — เลือก Connection หรือตั้งค่าใน Project Settings' }, { status: 400 })
  }

  // ไม่มี scheme → เติม https:// แล้วตรวจว่าเป็นโฮสต์สาธารณะก่อนส่งรหัสผ่านไป
  if (!/^https?:\/\//i.test(wpUrl)) wpUrl = `https://${wpUrl}`
  const urlErr = await checkCredentialUrl(wpUrl)
  if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 })

  // ตัวทดสอบเดียวกับ Upload Article (safeFetch + ตรวจสิทธิ์จริง)
  const result = await testWordPressConnection(wpUrl, wpUser, wpPass)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, url: wpUrl, name: result.name ?? wpUser, version: '5+', source })
}
