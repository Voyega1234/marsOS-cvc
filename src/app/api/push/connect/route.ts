import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, connectionId } = await req.json()
  const orgId = session.user.organizationId

  let wpUrl = '', wpUser = '', wpPass = '', source = 'env'

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
      try { wpPass = decrypt(conn.appPasswordEncrypted) } catch { wpPass = '' }
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
      try { wpPass = decrypt(conn.appPasswordEncrypted) } catch { wpPass = '' }
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

  // 4. .env fallback
  if (!wpUrl) { wpUrl = normalizeWpUrl(process.env.WP_URL ?? ''); source = 'env' }
  if (!wpUser) wpUser = process.env.WP_USER?.trim() ?? ''
  if (!wpPass) wpPass = process.env.WP_APP_PASSWORD?.trim() ?? ''

  if (!wpUrl || !wpUser || !wpPass) {
    return NextResponse.json({ error: 'ไม่พบ WordPress credentials — เลือก Connection หรือตั้งค่าใน Project Settings' }, { status: 400 })
  }

  try {
    // Strip spaces from Application Password (WP allows spaces in display but auth needs clean string)
    const cleanPass = wpPass.replace(/\s+/g, '')
    const creds = Buffer.from(`${wpUser}:${cleanPass}`).toString('base64')
    const authHeaders = {
      Authorization: `Basic ${creds}`,
      'User-Agent': 'MarsOS/1.0',
      'Content-Type': 'application/json',
    }

    // Try /wp-json/wp/v2/users/me — requires auth, confirms credentials work
    const meRes = await fetch(`${wpUrl}/wp-json/wp/v2/users/me`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(10000),
    })

    if (meRes.ok) {
      const me = await meRes.json()
      return NextResponse.json({ ok: true, url: wpUrl, name: me.name ?? wpUser, version: '5+', source })
    }

    // Fallback: try root wp-json (some hosts allow unauthenticated)
    const rootRes = await fetch(`${wpUrl}/wp-json/wp/v2`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(10000),
    })

    if (rootRes.ok) {
      const data = await rootRes.json()
      return NextResponse.json({ ok: true, url: wpUrl, name: data.name ?? '', version: '5+', source })
    }

    // Both failed — return the /users/me status as it's more informative
    const errBody = await meRes.text().catch(() => '')
    return NextResponse.json({
      error: `WordPress ตอบ ${meRes.status} — ${meRes.status === 401
        ? 'Application Password ไม่ถูกต้อง หรือ user ไม่มีสิทธิ์ REST API'
        : meRes.status === 403
        ? 'WordPress บล็อก REST API — ตรวจสอบ plugin หรือ .htaccess'
        : `ตรวจสอบ URL และ Application Password (${errBody.slice(0, 120)})`
      }`,
    }, { status: 400 })

  } catch (e: unknown) {
    return NextResponse.json({ error: `เชื่อมต่อไม่ได้: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
