import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'
import { resolveContentEngine } from '@/lib/content-engine-resolve'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { DEFAULT_UPLOAD_THEME, type UploadTheme } from '@/lib/upload-article/types'
import { resolveArticleLanguage } from '@/lib/keyword-language'

// สร้างรูป 1 ภาพ ~30-90 วิ — เผื่อเวลาให้พอ ไม่ให้ Vercel ตัดกลางทาง (เท่ากับ images route)
export const maxDuration = 300

/** โมเดลรูปล็อกไว้ใน callGeminiImage (ตัวเดียวกับหน้า Clients) — ใช้แค่ลงบันทึก */
const IMAGE_MODEL_LABEL = 'openai/gpt-image-2.5-flare'
const WIDE_W = 1536
const WIDE_H = 1024

/**
 * POST /api/upload-article/clients/[id]/test-image
 * body {keyword, title?, type: 'cover'|'mid'}
 * ให้ Mars ลองสร้างรูปจาก Image Prompt ของ Content Engine ลูกค้านี้ — ใช้ท่อเดียวกับตอนสร้างรูปบทความจริง
 * ไม่ผูกกับบทความไหน (ทดสอบล้วน) — มีค่าใช้จ่ายจริงทุกครั้งที่กด
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim().slice(0, 200) : ''
  if (!keyword) return NextResponse.json({ error: 'ใส่ keyword ก่อน' }, { status: 400 })
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : keyword
  const type: 'cover' | 'mid' = body.type === 'mid' ? 'mid' : 'cover'

  // Content Engine ของลูกค้านี้เท่านั้น (scope = UploadClient.id) — ไม่มี Image Prompt = หยุด ไม่ใช้ prompt สำรอง
  const ce = await resolveContentEngine(orgId, { projectId: client.id })
  if (!ce.imagePrompt?.text?.trim()) {
    return NextResponse.json({ error: 'CONTENT_ENGINE_NOT_CONFIGURED', missing: ['Image Prompt'] }, { status: 422 })
  }

  let theme: UploadTheme
  try {
    theme = { ...DEFAULT_UPLOAD_THEME, ...JSON.parse(client.themeColors) }
  } catch {
    theme = DEFAULT_UPLOAD_THEME
  }

  const language = resolveArticleLanguage({ projectLanguage: client.language, keyword, title })
  const clientSlug = `upload-${slugifyClient(client.name)}`

  function log(status: 'SUCCESS' | 'FAILED', costUsd: number, tokens: number, errorMessage?: string) {
    logAIJob({
      organizationId: orgId,
      projectId: null,
      inputSummary: uaJobInput(client!.id),
      jobType: 'UPLOAD_ARTICLE_TEST_IMAGE',
      modelProvider: 'OPENROUTER',
      modelName: IMAGE_MODEL_LABEL,
      status,
      tokenUsed: tokens,
      estimatedCost: costUsd,
      errorMessage,
      createdById: session!.user.id,
    }).catch(() => {})
  }

  try {
    const r = await withOrClient(clientSlug, () => callGeminiImage({
      client: clientSlug,
      keyword,
      title,
      siteName: client.name,
      accentColor: theme.accent,
      themeColor: theme.theme,
      backgroundColor: theme.background,
      textColor: theme.text,
      promptTemplate: ce.imagePrompt!.text,
      imageAssets: ce.imageAssets,
      language,
      type,
      width: WIDE_W,
      height: WIDE_H,
      coverSubtitle: type === 'cover' ? '' : '',
      coverBullets: [],
    }))
    if (!r.imageBase64) {
      log('FAILED', r.costUsd ?? 0, r.totalTokens ?? 0, 'no image')
      return NextResponse.json({ error: 'โมเดลไม่ส่งรูปกลับมา ลองใหม่อีกครั้ง' }, { status: 502 })
    }
    log('SUCCESS', r.costUsd ?? 0, r.totalTokens ?? 0)
    return NextResponse.json({
      imageBase64: r.imageBase64,
      mimeType: r.mimeType,
      type,
      keyword,
      title,
      meta: {
        model: r.model,
        referenceImageCount: r.referenceImageCount,
        logoAttached: r.logoAttached,
        language,
        costUsd: r.costUsd ?? 0,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('FAILED', 0, 0, msg)
    return NextResponse.json({ error: `สร้างรูปไม่สำเร็จ: ${msg}` }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
