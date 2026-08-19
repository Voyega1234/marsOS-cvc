/**
 * GET /api/projects/[id]/article-css — ไฟล์ CSS กลางของ client
 *
 * compile จากชุดสี/ฟอนต์ใน Article Lab (Project.themeColors) ด้วย builder
 * ตัวเดียวกับตอนเขียนบทความ — ใช้กับโหมด Clean HTML: เอาไปติดในธีมเว็บครั้งเดียว
 * แล้วบทความทุกชิ้น (class มาตรฐาน mars-*) จะได้ดีไซน์ตรงกันทั้งเว็บ
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildArticleCss } from '@/lib/articleComponents'
import type { ArticleElementStyles } from '@/lib/articleTheme'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { name: true, clientName: true, themeColors: true, accentColor: true },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let colors: Record<string, unknown> = {}
  try { colors = JSON.parse(project.themeColors || '{}') } catch { /* ใช้ default */ }

  const css = buildArticleCss({
    themeColor: (colors.theme as string) || project.accentColor || '#2563eb',
    textColor: (colors.text as string) || '#000000',
    borderColor: (colors.border as string) || '#e2e8f0',
    accentColor: (colors.accent as string) || project.accentColor || '#2563eb',
    backgroundColor: (colors.background as string) || '',
    elementStyles: (colors.elements as ArticleElementStyles) ?? null,
  })

  const header = `/* MarsOS Article CSS — ${project.clientName || project.name}
 * ติดตั้งครั้งเดียวในธีมเว็บ (เช่น WP: Appearance > Customize > Additional CSS)
 * ใช้กับบทความโหมด Clean HTML — แก้ไฟล์นี้ = ดีไซน์เปลี่ยนทุกบทความ
 * generated ${new Date().toISOString().slice(0, 10)} */\n\n`

  const slug = (project.clientName || project.name).toLowerCase().replace(/[^a-z0-9ก-๙]+/g, '-').replace(/^-|-$/g, '')
  return new NextResponse(header + css, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Content-Disposition': `attachment; filename="mars-article-${encodeURIComponent(slug || 'client')}.css"`,
    },
  })
}
