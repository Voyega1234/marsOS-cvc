import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'
import { resolveContentEngine } from '@/lib/content-engine-resolve'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import sharp from 'sharp'
import {
  coverBulletsFromHtml, countGeneratedFigures, generatedFigureHtml, insertFiguresAfterH2, insertFiguresAfterH2Text, pickInlineSlots,
  removeGeneratedFigures, replaceCoverInHtml,
} from '@/lib/upload-article/article-images'
import { DEFAULT_UPLOAD_THEME, UPLOAD_MAX_INLINE_IMAGES, type UploadKeyword, type UploadTheme } from '@/lib/upload-article/types'
import { resolveArticleLanguage } from '@/lib/keyword-language'
import { pbnArticleEffective } from '@/lib/upload-article/pbn-context'

// สร้างรูปหลายภาพขนานกัน ภาพละ ~30-90 วิ — เผื่อเวลาให้พอ ไม่ให้ Vercel ตัดกลางทาง
export const maxDuration = 800

/** โมเดลรูปล็อกไว้ใน callGeminiImage (ตัวเดียวกับหน้า Clients) — ใช้แค่ลงบันทึก */
const IMAGE_MODEL_LABEL = 'openai/gpt-image-2.5-flare'
/** ปก/รูปประกอบแบบภาพล้วน ใช้สัดส่วน 3:2 เท่ากับปกแบบมีตัวหนังสือ */
const WIDE_W = 1536
const WIDE_H = 1024

/** รูปประกอบในเนื้อหาย่อกว้างสุด 1200px — บทความมีได้ถึง 5 รูป ฝังเป็น base64 ต้องไม่ให้ response เกินเพดาน 4.5MB */
const INLINE_MAX_W = 1200

type Kind = 'cover' | 'inline'

async function shrinkInline(base64: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  try {
    const buf = await sharp(Buffer.from(base64, 'base64'))
      .resize({ width: INLINE_MAX_W, withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer()
    return { base64: buf.toString('base64'), mimeType: 'image/webp' }
  } catch {
    return { base64, mimeType }
  }
}

async function loadContext(articleId: string, orgId: string) {
  const article = await prisma.uploadArticle.findFirst({ where: { id: articleId, organizationId: orgId } })
  if (!article) return null
  const clientRow = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!clientRow) return null
  // PBN Backlinks: สไตล์ตามเว็บปลายทาง + Content Engine / ภาษาตาม set ที่เลือกตอนเขียน (Upload Article = ค่าเดิม)
  const eff = pbnArticleEffective(clientRow, article.id)
  return { article, client: eff.client, ceScopeId: eff.ceScopeId }
}

/**
 * POST /api/upload-article/articles/[articleId]/images
 * body {kind:'cover', withText} | {kind:'inline', withText, count}
 * สร้างรูปด้วย callGeminiImage (โมเดล + Image Prompt + ภาพตัวอย่างจาก Content Engine ของลูกค้านี้ — ไม่มี fallback)
 * ปก → coverImageUrl, รูปประกอบ → <figure data-ua-gen> ใต้ H2 ใน sourceHtml (แทนที่ชุดเดิมที่ระบบสร้าง)
 */
export async function POST(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const ctx = await loadContext(params.articleId, orgId)
  if (!ctx) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const { article, client } = ctx
  if (article.status === 'PUSHING' || article.status === 'WRITING') {
    return NextResponse.json({ error: 'บทความนี้กำลังเขียนหรือกำลัง push อยู่ รอให้เสร็จก่อน' }, { status: 409 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const kind: Kind | null = body.kind === 'cover' ? 'cover' : body.kind === 'inline' ? 'inline' : null
  if (!kind) return NextResponse.json({ error: 'kind ต้องเป็น cover หรือ inline' }, { status: 400 })
  const withText = body.withText !== false
  const count = kind === 'inline' ? Math.max(1, Math.min(UPLOAD_MAX_INLINE_IMAGES, Math.floor(Number(body.count) || 0))) : 1

  // onlyIfMissing (จากแท็บ Generate): บทความมีปก/รูปประกอบที่ระบบสร้างอยู่แล้ว = ข้าม ไม่เสียค่ารูปซ้ำ
  if (body.onlyIfMissing === true) {
    const has = kind === 'cover' ? Boolean(article.coverImageUrl) : countGeneratedFigures(article.sourceHtml) > 0
    if (has) return NextResponse.json({ article: toUploadArticleDTO(article, true), costUsd: 0, generated: 0, failed: 0, skipped: true })
  }

  // Content Engine ของลูกค้านี้เท่านั้น (scope = UploadClient.id) — ไม่มี Image Prompt = หยุด ไม่ใช้ prompt สำรอง
  // 2 การอ่านนี้เป็นอิสระจากกัน — ยิงพร้อมกัน แต่ยังเช็ค 422 หลังได้ผลทั้งคู่เหมือนเดิม
  const [ce, prefs] = await Promise.all([
    resolveContentEngine(orgId, { projectId: ctx.ceScopeId }),
    readPrefs(client.id, orgId),
  ])
  if (!ce.imagePrompt?.text?.trim()) {
    return NextResponse.json({ error: 'CONTENT_ENGINE_NOT_CONFIGURED', missing: ['Image Prompt'] }, { status: 422 })
  }

  let theme: UploadTheme
  try {
    theme = { ...DEFAULT_UPLOAD_THEME, ...JSON.parse(client.themeColors) }
  } catch {
    theme = DEFAULT_UPLOAD_THEME
  }

  const plan = Array.isArray(prefs?.keywordPlan) ? (prefs!.keywordPlan as UploadKeyword[]) : []
  const keyword = plan.find(k => k.articleId === article.id)?.keyword || article.title
  const language = resolveArticleLanguage({ projectLanguage: client.language, keyword, title: article.seoTitle || article.title })
  const clientSlug = `upload-${slugifyClient(client.name)}`

  const base = {
    client: clientSlug,
    keyword,
    siteName: client.name,
    accentColor: theme.accent,
    themeColor: theme.theme,
    backgroundColor: theme.background,
    textColor: theme.text,
    promptTemplate: ce.imagePrompt.text,
    imageAssets: ce.imageAssets,
    language,
  }

  // มีตัวหนังสือ = type cover (ระบบวางหัวเรื่องด้วยฟอนต์จริงทับภาพ), ภาพล้วน = type mid (บังคับไม่มีตัวอักษร)
  async function draw(title: string, bullets: string[], subtitle: string) {
    return withOrClient(clientSlug, () => callGeminiImage({
      ...base,
      title,
      type: withText ? 'cover' : 'mid',
      width: WIDE_W,
      height: WIDE_H,
      coverSubtitle: withText ? subtitle : '',
      coverBullets: withText ? bullets : [],
    }))
  }

  const jobType = kind === 'cover' ? 'UPLOAD_ARTICLE_IMAGE_COVER' : 'UPLOAD_ARTICLE_IMAGE_INLINE'
  function log(status: 'SUCCESS' | 'FAILED', costUsd: number, tokens: number, errorMessage?: string) {
    logAIJob({
      organizationId: orgId,
      projectId: null,
      inputSummary: uaJobInput(client.id),
      jobType,
      modelProvider: 'OPENROUTER',
      modelName: IMAGE_MODEL_LABEL,
      status,
      tokenUsed: tokens,
      estimatedCost: costUsd,
      errorMessage,
      createdById: session!.user.id,
    }).catch(() => {})
  }

  if (kind === 'cover') {
    const title = article.seoTitle || article.title
    try {
      const r = await draw(title, coverBulletsFromHtml(article.sourceHtml), article.metaDescription || '')
      if (!r.imageBase64) {
        log('FAILED', r.costUsd ?? 0, r.totalTokens ?? 0, 'no image')
        return NextResponse.json({ error: 'โมเดลไม่ส่งรูปกลับมา ลองใหม่อีกครั้ง' }, { status: 502 })
      }
      log('SUCCESS', r.costUsd ?? 0, r.totalTokens ?? 0)
      const src = `data:${r.mimeType};base64,${r.imageBase64}`
      // HTML ที่ Generate แล้วมีกล่องปกอยู่ → เปลี่ยนรูปในนั้นเลย (ไม่มีกล่องปก = ต้องกด Generate ใหม่ให้ใส่ปก)
      const updated = await prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ htmlContent: string | null }>>`
          SELECT "htmlContent" FROM "plans_seo_pipeline"."UploadArticle"
          WHERE "id" = ${article.id} AND "organizationId" = ${orgId}
          FOR UPDATE`
        const htmlContent = rows[0]?.htmlContent ? replaceCoverInHtml(rows[0].htmlContent, src, title) : undefined
        return tx.uploadArticle.update({
          where: { id: article.id },
          data: { coverImageUrl: src, coverAlt: title, ...(htmlContent !== undefined && { htmlContent }) },
        })
      })
      return NextResponse.json({ article: toUploadArticleDTO(updated, true), costUsd: r.costUsd ?? 0, generated: 1, failed: 0 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('FAILED', 0, 0, msg)
      return NextResponse.json({ error: `สร้างรูปปกไม่สำเร็จ: ${msg}` }, { status: 502 })
    }
  }

  const slots = pickInlineSlots(removeGeneratedFigures(article.sourceHtml), count)
  if (slots.length === 0) {
    return NextResponse.json({ error: 'บทความนี้ไม่มีหัวข้อ H2 ให้วางรูปประกอบ' }, { status: 400 })
  }

  const results = await Promise.all(slots.map(async slot => {
    try {
      const r = await draw(slot.text, [], '')
      if (!r.imageBase64) return { slot, r, error: 'no image' }
      const small = await shrinkInline(r.imageBase64, r.mimeType)
      return { slot, r: { ...r, imageBase64: small.base64, mimeType: small.mimeType }, error: '' }
    } catch (e) {
      return { slot, r: null, error: e instanceof Error ? e.message : String(e) }
    }
  }))
  const ok = results.filter(x => x.r?.imageBase64)
  const costUsd = results.reduce((s, x) => s + (x.r?.costUsd ?? 0), 0)
  const tokens = results.reduce((s, x) => s + (x.r?.totalTokens ?? 0), 0)
  const failed = results.length - ok.length
  log(ok.length ? 'SUCCESS' : 'FAILED', costUsd, tokens, failed ? `${failed}/${results.length} ภาพไม่สำเร็จ: ${results.find(x => x.error)?.error}` : undefined)
  if (ok.length === 0) {
    return NextResponse.json({ error: `สร้างรูปประกอบไม่สำเร็จ: ${results[0]?.error || 'ไม่ทราบสาเหตุ'}` }, { status: 502 })
  }

  // ล็อกแถวบทความแล้วอ่าน sourceHtml ล่าสุดก่อนแทรก — กันทับการแก้ไขที่เกิดระหว่างรอรูป (ใช้เวลานาน)
  const updated = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ sourceHtml: string; htmlContent: string | null }>>`
      SELECT "sourceHtml", "htmlContent" FROM "plans_seo_pipeline"."UploadArticle"
      WHERE "id" = ${article.id} AND "organizationId" = ${orgId}
      FOR UPDATE`
    if (rows.length === 0) return null
    const figs = ok.map(x => ({
      h2Index: x.slot.index,
      text: x.slot.text,
      html: generatedFigureHtml(`data:${x.r!.mimeType};base64,${x.r!.imageBase64}`, x.slot.text),
    }))
    const sourceHtml = insertFiguresAfterH2(removeGeneratedFigures(rows[0].sourceHtml), figs)
    // HTML ที่ Generate แล้ว (อาจแก้มือในแท็บ Review ไว้) — แทรกตามชื่อหัวข้อ ไม่ต้อง Generate ใหม่ งานแก้มือไม่หาย
    const htmlContent = rows[0].htmlContent ? insertFiguresAfterH2Text(removeGeneratedFigures(rows[0].htmlContent), figs) : undefined
    return tx.uploadArticle.update({
      where: { id: article.id },
      data: { sourceHtml, ...(htmlContent !== undefined && { htmlContent }) },
    })
  })
  if (!updated) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  return NextResponse.json({ article: toUploadArticleDTO(updated, true), costUsd, generated: ok.length, failed })
}

/** DELETE /api/upload-article/articles/[articleId]/images?kind=cover|inline — เอารูปที่ระบบสร้างออก */
export async function DELETE(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const ctx = await loadContext(params.articleId, orgId)
  if (!ctx) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const kind = req.nextUrl.searchParams.get('kind')
  if (kind !== 'cover' && kind !== 'inline') return NextResponse.json({ error: 'kind ต้องเป็น cover หรือ inline' }, { status: 400 })

  const updated = kind === 'cover'
    ? await prisma.uploadArticle.update({ where: { id: ctx.article.id }, data: { coverImageUrl: null, coverAlt: '' } })
    : await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ sourceHtml: string; htmlContent: string | null }>>`
        SELECT "sourceHtml", "htmlContent" FROM "plans_seo_pipeline"."UploadArticle"
        WHERE "id" = ${ctx.article.id} AND "organizationId" = ${orgId}
        FOR UPDATE`
      if (rows.length === 0) return null
      return tx.uploadArticle.update({
        where: { id: ctx.article.id },
        data: {
          sourceHtml: removeGeneratedFigures(rows[0].sourceHtml),
          ...(rows[0].htmlContent && { htmlContent: removeGeneratedFigures(rows[0].htmlContent) }),
        },
      })
    })
  if (!updated) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  return NextResponse.json({ article: toUploadArticleDTO(updated, true) })
}
