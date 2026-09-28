import { NextRequest, NextResponse } from 'next/server'
import { parse } from 'node-html-parser'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { askJson } from '@/lib/competitor-gap/ai'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { OR_MODELS } from '@/lib/openrouter'
import { logAIJob } from '@/lib/logAIJob'
import { refreshUploadSchema, uploadSchemaOptions } from '@/lib/upload-article/build-html'

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

interface MetaAiResult {
  metaTitle?: string
  metaDescription?: string
  slug?: string
}

/** POST /api/upload-article/articles/[articleId]/meta — ให้ AI เขียน meta title/description/slug */
export async function POST(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const client = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const html = article.htmlContent || article.sourceHtml
  const root = parse(html)
  const h1 = root.querySelector('h1')?.text.trim() || article.title
  const h2List = root.querySelectorAll('h2').map((h) => h.text.trim()).filter(Boolean)
  const bodyText = root.text.replace(/\s+/g, ' ').trim().slice(0, 1500)
  const language = client.language === 'en' ? 'en' : 'th'

  const fallbackTitle = h1.slice(0, 60)

  const system = `คุณคือนักเขียน SEO เมตาแท็กมืออาชีพ ตอบเป็น JSON เท่านั้น ไม่มีคำอธิบายอื่น
รูปแบบ: {"metaTitle": string, "metaDescription": string, "slug": string}
กติกา:
- metaTitle: ใช้ H1 ตามเดิม ถ้า H1 ยาวเกิน 60 ตัวอักษรให้ย่อโดยคงคำเดิมของ H1 ให้มากที่สุด ความยาวไม่เกิน 60 ตัวอักษร ใส่คีย์เวิร์ดหลักไว้ต้นประโยค ห้ามเขียนแบบ clickbait ห้ามต่อท้ายชื่อแบรนด์เว้นแต่จะพอดี
- metaDescription: ความยาว 120-155 ตัวอักษร สรุปสิ่งที่ผู้อ่านจะได้รับ ใช้ภาษาเดียวกับบทความ ห้ามเสกข้อมูล/ตัวเลขที่ไม่มีในบทความ
- slug: คำภาษาอังกฤษล้วนจากความหมายของ H1 ตัวพิมพ์เล็ก คั่นด้วย - ความยาวไม่เกิน 60 ตัวอักษร ใช้ได้เฉพาะ a-z0-9-
ภาษาของบทความ: ${language === 'en' ? 'English' : 'ไทย'}`

  const user = `H1: ${h1}\nหัวข้อย่อย (H2): ${h2List.join(' | ') || '(ไม่มี)'}\n\nเนื้อหาบางส่วน:\n${bodyText}`

  const clientSlug = `upload-${slugifyClient(client.name)}`
  const result = await withOrClient(clientSlug, () =>
    askJson<MetaAiResult>({
      trace: 'upload_article_meta',
      system,
      user,
      temperature: 0.4,
      maxTokens: 2000,
    }),
  )

  logAIJob({
    organizationId: orgId,
    projectId: null,
    jobType: 'UPLOAD_ARTICLE_META',
    modelProvider: 'OPENROUTER',
    modelName: OR_MODELS.default(),
    status: result.error ? 'FAILED' : 'SUCCESS',
    tokenUsed: result.usage.totalTokens,
    estimatedCost: result.usage.costUsd,
    errorMessage: result.error ?? undefined,
    createdById: session.user.id,
  }).catch(() => {})

  if (result.error || !result.data) {
    // AI ล้มเหลว — fallback ตามสเปก ยังตอบ 200 พร้อม warning
    // ไม่ทับค่าที่ผู้ใช้มีอยู่แล้ว — เติมแค่ title จาก H1 เมื่อยังว่าง
    const seoTitle = article.seoTitle || fallbackTitle
    if (!article.seoTitle) await prisma.uploadArticle.update({ where: { id: article.id }, data: { seoTitle } })
    return NextResponse.json({ seoTitle, metaDescription: article.metaDescription, slug: article.slug, costUsd: result.usage.costUsd, warning: result.error || 'AI ไม่ตอบกลับ' })
  }

  // meta title ดึงจาก H1 ตรง ๆ — ใช้ข้อความที่ AI ย่อเฉพาะเมื่อ H1 ยาวเกิน 60 ตัวอักษร
  const seoTitle = (h1.length <= 60 ? h1 : result.data.metaTitle || fallbackTitle).trim().slice(0, 60)
  const metaDescription = (result.data.metaDescription || '').trim().slice(0, 155)
  const slug = sanitizeSlug(result.data.slug || '')

  const htmlContent = article.htmlContent
    ? refreshUploadSchema(article.htmlContent, uploadSchemaOptions({ ...article, seoTitle, metaDescription, slug }, client))
    : article.htmlContent
  await prisma.uploadArticle.update({ where: { id: article.id }, data: { seoTitle, metaDescription, slug, htmlContent } })

  return NextResponse.json({ seoTitle, metaDescription, slug, htmlContent, costUsd: result.usage.costUsd })
}
