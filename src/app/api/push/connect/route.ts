import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { testWordPressConnection } from '@/lib/upload-article/wp-push'
import { resolveProjectWpCredentials } from '@/lib/project-wp-credentials'
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

  // credentials ชุดเดียวกับตอน push จริง (/api/push/publish) — รหัสจาก .env ใช้ได้เฉพาะเว็บเดียวกับ WP_URL
  const creds = await resolveProjectWpCredentials(orgId, projectId, connectionId)
  if (!creds.ok) return NextResponse.json({ error: creds.error }, { status: 400 })
  const { wpUrl, wpUser, wpPass, source } = creds
  const urlErr = await checkCredentialUrl(wpUrl)
  if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 })

  // ตัวทดสอบเดียวกับ Upload Article (safeFetch + ตรวจสิทธิ์จริง)
  const result = await testWordPressConnection(wpUrl, wpUser, wpPass)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, url: wpUrl, name: result.name ?? wpUser, version: '5+', source })
}
