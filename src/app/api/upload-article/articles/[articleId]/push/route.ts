import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { sanitizeArticleHtml } from '@/lib/articleSanitize'
import { stripStyleTags, stripLeadingH1 } from '@/lib/articleComponents'
import { publishToSite, type SiteConnectionConfig, type SitePlatform } from '@/lib/sitePublishers'
import { pushArticleToWordPress } from '@/lib/upload-article/wp-push'
import { refreshUploadSchema, uploadSchemaOptions } from '@/lib/upload-article/build-html'
import type { UploadPushPrefs, UploadTheme } from '@/lib/upload-article/types'

export const maxDuration = 120

function coverToBase64(dataUri: string | null): { base64?: string; mime?: string } {
  if (!dataUri) return {}
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUri)
  if (!m) return {}
  return { mime: m[1], base64: m[2] }
}

/** POST /api/upload-article/articles/[articleId]/push — ดันบทความขึ้นเว็บลูกค้า */
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
  let theme: UploadTheme
  try {
    theme = JSON.parse(client.themeColors)
  } catch {
    theme = { theme: '#2563eb', text: '#1f2937', border: '#e5e7eb', accent: '#2563eb', background: '', styleMode: 'embed' }
  }
  let prevPrefs: UploadPushPrefs
  try {
    prevPrefs = JSON.parse(client.pushPrefs)
  } catch {
    prevPrefs = {}
  }

  const publishMode: 'draft' | 'publish' = body.publishMode === 'publish' ? 'publish' : 'draft'
  const useElementor = Boolean(body.useElementor ?? prevPrefs.useElementor ?? false)
  const wpPostType: 'post' | 'page' = body.wpPostType === 'page' ? 'page' : 'post'
  const stripH1 = typeof body.stripH1 === 'boolean' ? body.stripH1 : (prevPrefs.stripH1 ?? true)

  const rawHtml = typeof body.html === 'string' && body.html.trim() ? body.html : (article.htmlContent || '')
  if (!rawHtml) return NextResponse.json({ error: 'ยังไม่มี HTML ให้ push — กด Generate ก่อน' }, { status: 400 })

  // schema ต้องตรงกับ meta/slug ล่าสุดเสมอ (แก้ meta หลัง generate ได้)
  let processedHtml = sanitizeArticleHtml(refreshUploadSchema(rawHtml, uploadSchemaOptions(article, client)))
  if (theme.styleMode === 'clean') processedHtml = stripStyleTags(processedHtml)
  if (stripH1) processedHtml = stripLeadingH1(processedHtml)
  // บทความที่ generate ก่อนเลิกแสดง breadcrumb ในเนื้อหา — ตัดทิ้งตอน push (schema ยังมี BreadcrumbList)
  processedHtml = processedHtml.replace(/<nav class="content-breadcrumb"[\s\S]*?<\/nav>\s*/g, '')

  // เก็บ preference ที่ใช้รอบนี้ไว้ใน client.pushPrefs (ไม่รอ push สำเร็จก่อน — ผู้ใช้ตั้งใจเลือกแล้ว)
  await prisma.uploadClient.update({
    where: { id: client.id },
    data: { pushPrefs: JSON.stringify({ ...prevPrefs, useElementor, wpPostType, publishMode, stripH1 }) },
  }).catch(() => {})

  const platform = client.websitePlatform || 'wordpress'
  let ok = false
  let postUrl: string | undefined
  let postId: string | undefined
  let error: string | undefined

  if (platform !== 'wordpress') {
    let conn: SiteConnectionConfig = {}
    try {
      conn = JSON.parse(client.siteConnection || '{}')
    } catch {
      conn = {}
    }
    const { base64, mime } = coverToBase64(article.coverImageUrl)
    const result = await publishToSite(platform as SitePlatform, conn, {
      title: article.title,
      html: processedHtml,
      slug: article.slug || undefined,
      excerpt: article.metaDescription || undefined,
      coverBase64: base64,
      coverMimeType: mime,
      publishMode,
    })
    ok = result.ok
    postUrl = result.postUrl
    postId = result.postId
    error = result.error
  } else {
    if (!client.wpUrl || !client.wpUser || !client.wpAppPasswordEnc) {
      return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า WordPress URL / User / Application Password' }, { status: 400 })
    }
    let wpPass = ''
    try {
      wpPass = decrypt(client.wpAppPasswordEnc)
    } catch {
      return NextResponse.json({ error: 'ถอดรหัส Application Password ไม่สำเร็จ' }, { status: 500 })
    }
    const { base64, mime } = coverToBase64(article.coverImageUrl)
    const result = await pushArticleToWordPress({
      wpUrl: client.wpUrl,
      wpUser: client.wpUser,
      wpPass,
      title: article.title,
      html: processedHtml,
      slug: article.slug || undefined,
      metaTitle: article.seoTitle || article.title,
      metaDescription: article.metaDescription || undefined,
      coverBase64: base64,
      coverMimeType: mime,
      coverAlt: article.coverAlt || article.title,
      publishMode,
      useElementor,
      wpPostType,
    })
    ok = result.ok
    postUrl = result.postUrl
    postId = result.postId ? String(result.postId) : undefined
    error = result.error
  }

  if (ok) {
    await prisma.uploadArticle.update({
      where: { id: article.id },
      data: {
        status: 'PUSHED',
        wordpressUrl: postUrl || null,
        wordpressPostId: postId || null,
        pushMode: publishMode,
        pushedAt: new Date(),
        pushError: null,
      },
    })
  } else {
    await prisma.uploadArticle.update({
      where: { id: article.id },
      data: { status: 'FAILED', pushError: error || 'push ไม่สำเร็จ' },
    })
  }

  return NextResponse.json({ ok, postUrl, postId, error })
}
