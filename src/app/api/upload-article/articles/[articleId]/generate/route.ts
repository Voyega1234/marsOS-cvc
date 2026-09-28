import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildUploadArticleHtml } from '@/lib/upload-article/build-html'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { extractBriefMeta } from '@/lib/upload-article/doc-meta'
import type { UploadOutputMode, UploadTheme } from '@/lib/upload-article/types'

/** POST /api/upload-article/articles/[articleId]/generate — ประกอบ HTML/Text พร้อมใช้จาก sourceHtml */
export async function POST(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const client = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const mode: UploadOutputMode = body.mode === 'text' ? 'text' : body.mode === 'html' ? 'html' : (article.outputMode as UploadOutputMode) || 'html'
  const breadcrumb = body.breadcrumb !== false

  let theme: UploadTheme
  try {
    theme = JSON.parse(client.themeColors)
  } catch {
    theme = { theme: '#2563eb', text: '#1f2937', border: '#e5e7eb', accent: '#2563eb', background: '', styleMode: 'embed' }
  }

  try {
    // meta/slug ยังว่าง — เติมจากตาราง brief ของผู้เขียนในต้นฉบับก่อน generate (ถ้ามี)
    const brief = (!article.seoTitle || !article.metaDescription || !article.slug) ? extractBriefMeta(article.sourceHtml) : null
    const seoTitle = article.seoTitle || brief?.seoTitle || ''
    const metaDescription = article.metaDescription || brief?.metaDescription || ''
    const slug = article.slug || brief?.slug || ''

    const result = buildUploadArticleHtml({
      sourceHtml: article.sourceHtml,
      mode,
      theme,
      site: { name: client.name, url: client.website, language: client.language === 'en' ? 'en' : 'th' },
      meta: {
        title: article.title,
        seoTitle: seoTitle || undefined,
        metaDescription: metaDescription || undefined,
        slug: slug || undefined,
      },
      cover: article.coverImageUrl ? { url: article.coverImageUrl, alt: article.coverAlt || article.title } : null,
      breadcrumb,
    })

    const nextStatus = article.status === 'PUSHED' || article.status === 'PUSHING' ? article.status : 'GENERATED'
    const updated = await prisma.uploadArticle.update({
      where: { id: article.id },
      data: { htmlContent: result.html, outputMode: mode, status: nextStatus, seoTitle, metaDescription, slug },
    })

    return NextResponse.json(toUploadArticleDTO(updated, true))
  } catch (e) {
    return NextResponse.json({ error: `สร้าง HTML ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
