/**
 * GET /api/upload-article/clients/[id]/webflow-css-check — ตรวจว่า CSS สไตล์บทความถูกวางใน Webflow แล้วหรือยัง
 * เทียบกับธีมที่บันทึกไว้ของลูกค้า (อ่านอย่างเดียว ไม่เขียน DB)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { webflowCssHash } from '@/lib/upload-article/theme-css'
import { checkWebflowCss, savedUploadTheme } from '@/lib/upload-article/webflow-css-check'
import { hostOf, withProtocol } from '@/lib/upload-article/platform-info'

export const maxDuration = 30

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const c = await prisma.uploadClient.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { websitePlatform: true, website: true, siteConnection: true, themeColors: true },
  })
  if (!c) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if (c.websitePlatform !== 'webflow') return NextResponse.json({ error: 'ใช้ได้เฉพาะลูกค้าที่เชื่อม Webflow' }, { status: 400 })

  let conn: { webflow?: { siteUrl?: string } } = {}
  try { conn = JSON.parse(c.siteConnection || '{}') } catch { /* ใช้ค่าว่าง */ }
  const siteUrl = withProtocol(conn.webflow?.siteUrl || '') || withProtocol(c.website || '')
  if (!siteUrl) return NextResponse.json({ error: 'ยังไม่ได้ตั้ง URL เว็บ — ใส่ Site URL ในหน้า Connect' }, { status: 400 })

  // หน้าบทความล่าสุดที่ push แล้ว (ถ้าเป็นเว็บเดียวกัน) — ใช้เป็นหน้าตัวอย่างตรวจ CSS
  let sampleUrl: string | undefined
  const last = await prisma.uploadArticle.findFirst({
    where: { clientId: params.id, organizationId: orgId, status: 'PUSHED', wordpressUrl: { not: null } },
    orderBy: { pushedAt: 'desc' },
    select: { wordpressUrl: true },
  })
  if (last?.wordpressUrl) {
    const h = hostOf(last.wordpressUrl)
    if (h && (h === hostOf(siteUrl) || h.endsWith('.webflow.io'))) sampleUrl = last.wordpressUrl
  }

  const result = await checkWebflowCss(siteUrl, webflowCssHash(savedUploadTheme(c.themeColors)), sampleUrl)
  return NextResponse.json(result)
}

export const dynamic = 'force-dynamic'
