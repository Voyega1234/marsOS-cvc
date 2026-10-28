import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { clientCanAccessProject } from '@/lib/client-access'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'
import { resolveContentEngine } from '@/lib/content-engine-resolve'
import { withOrClient, clientSlugFromProject } from '@/lib/orClient'
import { resolveImagePalette } from '@/lib/articleTheme'
import { resolveArticleLanguage } from '@/lib/keyword-language'
import { readArticleImageSettings } from '@/lib/article-settings'
import { shrinkInline } from '@/lib/image-shrink'
import {
  coverBulletsFromHtml, generatedFigureHtml, insertFiguresAfterH2Text, pickInlineSlots,
  removeCoverFromHtml, replaceCoverInHtml,
} from '@/lib/upload-article/article-images'
import { getCoverAltFromHtml, removeSmeGeneratedFigures } from '@/lib/sme-articles/article-images'
import { UPLOAD_MAX_INLINE_IMAGES } from '@/lib/upload-article/types'

// สร้างรูปหลายภาพขนานกัน ภาพละ ~30-90 วิ — เผื่อเวลาให้พอ ไม่ให้ Vercel ตัดกลางทาง
export const maxDuration = 800

/** โมเดลรูปล็อกไว้ใน callGeminiImage (ตัวเดียวกับหน้า Clients) — ใช้แค่ลงบันทึก */
const IMAGE_MODEL_LABEL = 'openai/gpt-image-2.5-flare'
/** ปก/รูปประกอบแบบภาพล้วน ใช้สัดส่วน 3:2 เท่ากับปกแบบมีตัวหนังสือ */
const WIDE_W = 1536
const WIDE_H = 1024
/** เวลาต่อรอบของการสร้างรูป 1 ภาพ (เท่ากับ write route) */
const IMAGE_TIMEOUT_MS = 120_000

type Kind = 'cover' | 'inline'
type ArticleRow = NonNullable<Awaited<ReturnType<typeof loadArticle>>>

async function loadArticle(id: string, orgId: string) {
  return prisma.article.findFirst({
    where: { id, project: { organizationId: orgId } },
    include: { project: true, keyword: true },
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ])
}

function dto(a: { id: string; title: string; htmlContent: string | null; coverImageUrl: string | null; status: string }) {
  const html = a.htmlContent ?? ''
  return { id: a.id, htmlContent: a.htmlContent, coverImageUrl: a.coverImageUrl, coverAlt: getCoverAltFromHtml(html) || a.title, status: a.status }
}

/** auth + โหลดบทความ + สิทธิ์ + ล็อกสถานะ — คืน Response ถ้าไม่ผ่าน */
async function guard(articleId: string): Promise<{ res: NextResponse } | { article: ArticleRow; orgId: string; userId: string }> {
  const session = await getSession()
  if (!session?.user?.organizationId) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // สร้างรูปมีค่าใช้จ่าย — ลูกค้า (CLIENT) สั่งไม่ได้
  if (session.user.role === 'CLIENT') return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const orgId = session.user.organizationId
  const article = await loadArticle(articleId, orgId)
  if (!article) return { res: NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 }) }
  if (!(await clientCanAccessProject(session, article.projectId))) {
    return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  // WRITING = writer กำลังเขียนทับ htmlContent อยู่ (สถานะ SME ที่มีแค่ตัวนี้ที่เป็น "กำลังทำงาน")
  if (article.status === 'WRITING' || article.status === 'PUSHING' || article.status === 'PUBLISHING') {
    return { res: NextResponse.json({ error: 'บทความนี้กำลังเขียนหรือกำลัง push อยู่ รอให้เสร็จก่อน' }, { status: 409 }) }
  }
  return { article, orgId, userId: session.user.id }
}

/**
 * POST /api/articles/[id]/images
 * body {kind:'cover', withText} | {kind:'inline', withText, count}
 * สร้างรูปด้วย callGeminiImage (ชุดสี/สไตล์ของโปรเจกต์ + Image Prompt จาก Content Engine เหมือนตอน write)
 * ปก → coverImageUrl (ในเนื้อหาแก้เฉพาะเมื่อมีกล่องปกอยู่แล้ว), รูปประกอบ → <figure data-ua-gen> ใต้ H2 (แทนชุดเดิม)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if ('res' in g) return g.res
  const { article, orgId, userId } = g
  const project = article.project

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const kind: Kind | null = body.kind === 'cover' ? 'cover' : body.kind === 'inline' ? 'inline' : null
  if (!kind) return NextResponse.json({ error: 'kind ต้องเป็น cover หรือ inline' }, { status: 400 })
  const withText = body.withText !== false

  // จำนวนรูปประกอบ: body → ตั้งค่ารูปของโปรเจกต์ (themeColors.imageSettings.inlineCount) → 2
  let projColors: Record<string, unknown> = {}
  try { projColors = JSON.parse(project.themeColors || '{}') } catch { /* ค่าเสีย — ใช้ default */ }
  const defaultCount = readArticleImageSettings(projColors.imageSettings).inlineCount ?? 2
  const reqCount = Number(body.count)
  const count = kind === 'inline'
    ? Math.max(1, Math.min(UPLOAD_MAX_INLINE_IMAGES, Math.floor(Number.isFinite(reqCount) && reqCount > 0 ? reqCount : defaultCount)))
    : 1

  // Content Engine ของโปรเจกต์นี้เท่านั้น — ไม่มี Image Prompt = หยุด ไม่ใช้ prompt สำรอง
  const ce = await resolveContentEngine(orgId, { projectId: project.id })
  if (!ce.imagePrompt?.text?.trim()) {
    return NextResponse.json({ error: 'CONTENT_ENGINE_NOT_CONFIGURED', missing: ['Image Prompt'] }, { status: 422 })
  }

  const htmlContent = article.htmlContent ?? ''
  const title = article.seoTitle || article.title
  const keyword = article.keyword?.keyword || article.title
  const language = resolveArticleLanguage({ projectLanguage: project.language, keyword, title })
  const orClient = clientSlugFromProject({ id: project.id, name: project.name, clientName: project.clientName })
  const palette = resolveImagePalette(project.themeColors, project.accentColor)

  const base = {
    client: orClient,
    keyword,
    siteName: project.clientName || project.name || '',
    brandTone: project.brandTone ?? '',
    accentColor: palette.accentColor,
    themeColor: palette.themeColor,
    backgroundColor: palette.backgroundColor,
    textColor: palette.textColor,
    promptTemplate: ce.imagePrompt.text,
    imageStyleGuide: project.imageStyleGuide ?? '',
    imageAssets: ce.imageAssets,
    language: language === 'en' ? ('en' as const) : ('th' as const),
  }

  // มีตัวหนังสือ = type cover (ระบบวางหัวเรื่องด้วยฟอนต์จริงทับภาพ), ภาพล้วน = type mid (บังคับไม่มีตัวอักษร)
  async function draw(imgTitle: string, bullets: string[], subtitle: string) {
    let last: Awaited<ReturnType<typeof callGeminiImage>> | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        last = await withTimeout(withOrClient(orClient, () => callGeminiImage({
          ...base,
          title: imgTitle,
          type: withText ? 'cover' : 'mid',
          slot: kind === 'inline' ? 'inline' : 'cover',
          width: WIDE_W,
          height: WIDE_H,
          coverSubtitle: withText ? subtitle : '',
          coverBullets: withText ? bullets : [],
        })), IMAGE_TIMEOUT_MS, 'sme-image')
        if (last.imageBase64) return last
      } catch (e) {
        if (attempt === 1) throw e
      }
    }
    return last as Awaited<ReturnType<typeof callGeminiImage>>
  }

  const jobType = kind === 'cover' ? 'IMAGE_COVER' : 'IMAGE_MID'
  function log(status: 'SUCCESS' | 'FAILED', costUsd: number, tokens: number, errorMessage?: string) {
    prisma.aIJob.create({ data: {
      organizationId: orgId, createdById: userId,
      projectId: project.id, articleId: article.id,
      jobType, status,
      modelProvider: 'OPENROUTER', modelName: IMAGE_MODEL_LABEL,
      tokenUsed: tokens, estimatedCost: costUsd,
      ...(errorMessage && { errorMessage }),
    } }).catch(() => {})
  }

  if (kind === 'cover') {
    try {
      const r = await draw(title, coverBulletsFromHtml(htmlContent), article.metaDescription || '')
      if (!r.imageBase64) {
        log('FAILED', r.costUsd ?? 0, r.totalTokens ?? 0, 'no image')
        return NextResponse.json({ error: 'โมเดลไม่ส่งรูปกลับมา ลองใหม่อีกครั้ง' }, { status: 502 })
      }
      log('SUCCESS', r.costUsd ?? 0, r.totalTokens ?? 0)
      const src = `data:${r.mimeType};base64,${r.imageBase64}`
      const updated = await prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ htmlContent: string | null }>>`
          SELECT "htmlContent" FROM "plans_seo_pipeline"."Article"
          WHERE "id" = ${article.id}
          FOR UPDATE`
        if (rows.length === 0) return null
        const cur = rows[0].htmlContent
        // ปก SME อยู่ที่ coverImageUrl (push/export ใส่ให้เอง) — เปลี่ยนรูปในเนื้อหาเฉพาะเมื่อมีกล่องปกอยู่แล้ว ไม่สร้างปกซ้อน
        const hasBox = cur ? /<figure\b[^>]*\bcontent-cover\b/i.test(cur) : false
        return tx.article.update({
          where: { id: article.id },
          data: { coverImageUrl: src, ...(cur && hasBox && { htmlContent: replaceCoverInHtml(cur, src, title) }) },
        })
      })
      if (!updated) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
      return NextResponse.json({ article: dto(updated), costUsd: r.costUsd ?? 0, generated: 1, failed: 0 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('FAILED', 0, 0, msg)
      return NextResponse.json({ error: `สร้างรูปปกไม่สำเร็จ: ${msg}` }, { status: 502 })
    }
  }

  const slots = pickInlineSlots(removeSmeGeneratedFigures(htmlContent), count)
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

  // ล็อกแถวบทความแล้วอ่าน htmlContent ล่าสุดก่อนแทรก — กันทับการแก้ไขที่เกิดระหว่างรอรูป (ใช้เวลานาน)
  const updated = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ htmlContent: string | null }>>`
      SELECT "htmlContent" FROM "plans_seo_pipeline"."Article"
      WHERE "id" = ${article.id}
      FOR UPDATE`
    if (rows.length === 0) return null
    const cleaned = removeSmeGeneratedFigures(rows[0].htmlContent ?? '')
    // วางตามข้อความหัวข้อ ไม่ใช่ลำดับ — ระหว่างรอรูปมีคนเพิ่ม/ลบ H2 ได้ หัวข้อที่หายไปแล้วจะไม่ถูกวาง
    const figs = ok.map(x => ({
      text: x.slot.text,
      html: generatedFigureHtml(`data:${x.r!.mimeType};base64,${x.r!.imageBase64}`, x.slot.text),
    }))
    return tx.article.update({
      where: { id: article.id },
      data: { htmlContent: insertFiguresAfterH2Text(cleaned, figs) },
    })
  })
  if (!updated) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  return NextResponse.json({ article: dto(updated), costUsd, generated: ok.length, failed })
}

/** DELETE /api/articles/[id]/images?kind=cover|inline — เอารูปที่ระบบสร้างออก */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if ('res' in g) return g.res
  const { article } = g
  const kind = req.nextUrl.searchParams.get('kind')
  if (kind !== 'cover' && kind !== 'inline') return NextResponse.json({ error: 'kind ต้องเป็น cover หรือ inline' }, { status: 400 })

  const updated = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ htmlContent: string | null }>>`
      SELECT "htmlContent" FROM "plans_seo_pipeline"."Article"
      WHERE "id" = ${article.id}
      FOR UPDATE`
    if (rows.length === 0) return null
    const cur = rows[0].htmlContent
    // ลบปก = เอากล่องปกออกจากเนื้อหาด้วย ไม่ให้ค้างจนต้องไปลบเองใน editor
    if (kind === 'cover') {
      return tx.article.update({
        where: { id: article.id },
        data: { coverImageUrl: null, ...(cur && { htmlContent: removeCoverFromHtml(cur) }) },
      })
    }
    return tx.article.update({
      where: { id: article.id },
      data: cur ? { htmlContent: removeSmeGeneratedFigures(cur) } : {},
    })
  })
  if (!updated) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  return NextResponse.json({ article: dto(updated) })
}
