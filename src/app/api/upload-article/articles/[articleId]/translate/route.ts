import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  TONE_THAI,
  TranslateInputError,
  TranslateOutputError,
  assembleTranslation,
  buildTranslateSystemPrompt,
  buildValidateSystemPrompt,
  planTranslation,
  readTranslateDirection,
  readTranslateTone,
  runTranslation,
  translatedSlug,
  type TranslateLang,
  type TranslatePlan,
  type TranslationResult,
} from '@/lib/upload-article/translate'
import { PUSH_LOCK_MS, REWRITE_SOURCE_TYPE, freshRewriteShadow } from '@/lib/upload-article/rewrite-lock'
import { extractBriefMeta, normalizeBriefSlug } from '@/lib/upload-article/doc-meta'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { isPbnPrefsRaw } from '@/lib/upload-article/pbn'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { bannedTermsOf } from '@/lib/ce-restrictions'
import { loadRestrictions } from '@/lib/ce-restrictions-server'
import { orChat, type ORUsage } from '@/lib/openrouter'
import { resolveCeModel } from '@/lib/ce-ai-models-server'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { logAIJob } from '@/lib/logAIJob'

// Next.js อ่านค่า maxDuration ได้เฉพาะตัวเลข literal
export const maxDuration = 800
export const dynamic = 'force-dynamic'

const TRANSLATE_JOB_TYPE = 'UPLOAD_ARTICLE_TRANSLATE'
/** หลังเวลานี้ไม่เริ่มเรียก AI รอบใหม่ — เหลือเวลาให้ประกอบบทความและบันทึก */
const WORK_BUDGET_MS = 690_000
const CALL_TIMEOUT_MS = 240_000
const CALL_MAX_TOKENS = 16_000

/**
 * POST /api/upload-article/articles/[articleId]/translate  body { direction: 'th-en' | 'en-th', tone: 'formal' | 'semi' | 'casual' }
 * แปลบทความเป็นแถวใหม่ — บทความต้นทางไม่ถูกแตะ ไม่เขียนใหม่ ไม่เพิ่ม/ตัดเนื้อหา โครง HTML เดิมครบ
 * แปลเสร็จแล้วตรวจคำแปลเทียบต้นฉบับในตัว (ความหมาย ตัวเลข ไวยากรณ์ ระดับภาษา) และแก้จุดที่พบ
 * แถวใหม่อยู่สถานะ IMPORTED — ผู้เรียกสั่ง generate ต่อเองเพื่อใส่ style เหมือนแท็บ Generate
 * โมเดล: Content Engine > AI Model > Translate ของโปรเจกต์ (ไม่ตั้ง = Gemini รุ่นล่าสุดที่ระบบกำหนด)
 */
export async function POST(req: NextRequest, { params }: { params: { articleId: string } }) {
  const startedAt = Date.now()
  const session = await getSession()
  if (!session?.user?.organizationId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const userId = session.user.id

  const body = (await req.json().catch(() => ({}))) as { direction?: unknown; tone?: unknown } | null
  const direction = readTranslateDirection(body?.direction)
  const tone = readTranslateTone(body?.tone)
  if (!direction) return NextResponse.json({ error: 'เลือกทิศทางการแปลก่อน (ไทย → อังกฤษ หรือ อังกฤษ → ไทย)' }, { status: 400 })
  if (!tone) return NextResponse.json({ error: 'เลือกโทนภาษาก่อน (ทางการ / กึ่งทางการ / เป็นกันเอง)' }, { status: 400 })

  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article || article.sourceType === REWRITE_SOURCE_TYPE) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const client = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if (isPbnPrefsRaw(client.pushPrefs)) {
    return NextResponse.json({ error: 'บทความ PBN ยังไม่รองรับการแปล' }, { status: 400 })
  }
  if (article.status === 'WRITING' || (await freshRewriteShadow(article.id, orgId))) {
    return NextResponse.json({ error: 'AI กำลังเขียนบทความนี้อยู่ รอให้เสร็จก่อนแล้วลองใหม่' }, { status: 409 })
  }
  if (article.status === 'PUSHING' && new Date(article.updatedAt).getTime() > Date.now() - PUSH_LOCK_MS) {
    return NextResponse.json({ error: 'บทความนี้กำลัง Push ขึ้นเว็บ รอให้เสร็จก่อนแล้วลองใหม่' }, { status: 409 })
  }

  // slug ของฉบับแปลต้องไม่ซ้ำต้นฉบับและไม่ซ้ำฉบับแปลก่อนหน้า: slug เดียวกันตอน Push จะทับโพสต์เดิมบนเว็บ
  // ตั้งทั้งที่แถวและในแถว slug ของ brief ในต้นฉบับฉบับแปล (ตอนสร้าง meta ค่าใน brief ชนะ)
  const target: TranslateLang = direction === 'th-en' ? 'en' : 'th'
  const baseSlug = normalizeBriefSlug(article.slug || '') || extractBriefMeta(article.sourceHtml || '').slug || ''
  let slug = ''
  if (baseSlug) {
    const first = translatedSlug(baseSlug, target)
    const used = await prisma.uploadArticle.findMany({
      where: { organizationId: orgId, clientId: client.id, slug: { startsWith: first } },
      select: { slug: true },
      take: 200,
    })
    const taken = new Set(used.map((r) => r.slug))
    slug = translatedSlug(baseSlug, target, (s) => taken.has(s))
  }

  let plan: TranslatePlan
  try {
    plan = planTranslation({
      briefSlug: slug,
      title: article.title,
      sourceHtml: article.sourceHtml || '',
      seoTitle: article.seoTitle,
      metaDescription: article.metaDescription,
      coverAlt: article.coverAlt,
      direction,
      tone,
    })
  } catch (e) {
    if (e instanceof TranslateInputError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // คำต้องห้ามของแบรนด์ต้องอ่านให้ได้ก่อนเรียก AI — อ่านไม่ได้ = ไม่แปล
  let restrictions: Awaited<ReturnType<typeof loadRestrictions>>
  let model: string
  try {
    restrictions = await loadRestrictions(orgId, { projectId: client.id })
    model = await resolveCeModel(orgId, client.id, 'translate')
  } catch (e) {
    console.error('[upload-article] translate: load settings failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'โหลดการตั้งค่าของ Content Engine ไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 })
  }
  const bannedTerms = restrictions ? bannedTermsOf(restrictions.data) : []
  const promptInput = { source: plan.source, target: plan.target, tone, bannedTerms }

  // ค่าใช้จ่ายของทุกรอบ (แปล + ตรวจ + รอบที่ล้มเหลว) รวมเป็นงานเดียวใน AI Cost
  const usage: ORUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
  const addUsage = (u: ORUsage | undefined) => {
    if (!u) return
    usage.inputTokens += u.inputTokens || 0
    usage.outputTokens += u.outputTokens || 0
    usage.totalTokens += u.totalTokens || 0
    usage.costUsd += u.costUsd || 0
  }
  const logJob = (status: 'SUCCESS' | 'FAILED', errorMessage?: string) =>
    logAIJob({
      organizationId: orgId,
      projectId: null,
      inputSummary: uaJobInput(client.id),
      jobType: TRANSLATE_JOB_TYPE,
      modelProvider: 'OPENROUTER',
      modelName: model,
      status,
      tokenUsed: usage.totalTokens || undefined,
      estimatedCost: usage.costUsd || undefined,
      errorMessage,
      createdById: userId,
    }).catch(() => {})

  const orClient = `upload-${slugifyClient(client.name)}`
  let result: TranslationResult
  try {
    const outcome = await runTranslation(plan, {
      translateSystem: buildTranslateSystemPrompt(promptInput),
      validateSystem: buildValidateSystemPrompt(promptInput),
      concurrency: 4,
      deadline: startedAt + WORK_BUDGET_MS,
      call: async (system, user, purpose) => {
        try {
          const res = await withOrClient(orClient, () =>
            orChat({
              trace: purpose === 'validate' ? 'upload_translate_check' : 'upload_translate',
              model,
              jsonMode: true,
              temperature: purpose === 'validate' ? 0 : 0.2,
              maxTokens: CALL_MAX_TOKENS,
              timeoutMs: CALL_TIMEOUT_MS,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
            }),
          )
          addUsage(res.usage)
          return res.text
        } catch (e) {
          addUsage((e as Error & { usage?: ORUsage }).usage)
          throw e
        }
      },
    })
    result = assembleTranslation(plan, outcome, bannedTerms)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await logJob('FAILED', message)
    console.warn('[upload-article] translate failed:', message)
    const error = e instanceof TranslateOutputError
      ? `${message} — ยังไม่ได้สร้างบทความฉบับแปล ลองใหม่อีกครั้ง`
      : `AI แปลไม่สำเร็จ: ${message.slice(0, 300)} — ยังไม่ได้สร้างบทความฉบับแปล ลองใหม่อีกครั้ง`
    return NextResponse.json({ error }, { status: 502 })
  }

  const warnings = [...result.warnings]
  if (article.coverImageUrl) warnings.push('ภาพปกเป็นภาพเดิม — ข้อความบนภาพยังเป็นภาษาต้นฉบับ สร้างปกใหม่ได้ที่ Review')

  // บทความที่ AI เขียนจาก keyword ผูกกับ keyword ผ่าน sourceName "kw:…" — ฉบับแปลต้องไม่ผูกด้วย
  const fromAi = article.sourceType === 'ai'
  let row: Awaited<ReturnType<typeof prisma.uploadArticle.create>>
  try {
    row = await prisma.uploadArticle.create({
      data: {
        organizationId: orgId,
        clientId: client.id,
        title: result.title || article.title,
        sourceType: article.sourceType,
        sourceName: fromAi ? `translate:${article.id}` : article.sourceName,
        sourceHtml: result.html,
        outputMode: article.outputMode,
        htmlContent: null,
        seoTitle: result.seoTitle,
        metaDescription: result.metaDescription,
        slug,
        coverImageUrl: article.coverImageUrl,
        coverAlt: result.coverAlt,
        status: 'IMPORTED',
        createdById: userId,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await logJob('FAILED', `translated but not saved: ${message.slice(0, 300)}`)
    console.error('[upload-article] translate: save failed:', message)
    return NextResponse.json({ error: 'แปลเสร็จแล้วแต่บันทึกบทความฉบับแปลไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 })
  }
  await logJob('SUCCESS')

  return NextResponse.json({
    article: toUploadArticleDTO(row, true),
    warnings,
    sourceLanguage: plan.source,
    targetLanguage: plan.target,
    tone,
    toneLabel: TONE_THAI[tone],
    validation: result.validation,
    costUsd: usage.costUsd,
  })
}
