/**
 * Cover image generator — วาดผ่าน OpenRouter ด้วยโมเดลที่ล็อกไว้ (IMAGE_MODEL_LOCKED ใน src/lib/openrouter.ts)
 * POST { keyword, title, siteName?, brandTone?, type?: 'cover'|'mid', projectId? }
 * Returns { imageBase64: string, mimeType: string, type, keyword, title, meta }
 *
 * Cover: Claude Art Director analyzes topic → detailed infographic prompt → Gemini
 * Mid:   Keyword-specific editorial photo, NO text, NO infographics
 */
import { NextRequest, NextResponse } from 'next/server'
import { readLanguagePrefs, resolveArticleLanguage } from '@/lib/keyword-language'
import { resolveImagePalette } from '@/lib/articleTheme'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'
import { clientSlugForProject } from '@/lib/orClient'
import { OR_MODELS } from '@/lib/openrouter'
import { resolveContentEngine } from '@/lib/content-engine-resolve'
import { loadTitleRestrictions } from '@/lib/ce-restrictions-server'
import { cleanPlainText } from '@/lib/ce-restrictions'
import { readArticleImageSettings } from '@/lib/article-settings'

export const maxDuration = 120

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession()
  const body = await req.json().catch(() => ({}))
  const {
    keyword, title,
    siteName = '', brandTone = '',
    accentColor = '',
    width, height,
    type = 'cover' as 'cover' | 'mid',
    projectId,
    subtitle = '',
    bullets = [],
    // true = ทำตามตั้งค่ารูปปกของโปรเจกต์ (ปก มี/ไม่มีตัวหนังสือ) แบบเดียวกับตอนเขียนบทความ — ปุ่มสร้างปกใหม่หน้า SME ส่งมา
    followImageSettings = false,
    language: languageFromBody = null,
    language_mode: languageModeFromBody = null,
  } = body

  if (!keyword || !title) {
    return NextResponse.json({ error: 'keyword and title are required' }, { status: 400 })
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY is not configured' }, { status: 500 })
  }

  // กติกา: สร้างรูปต้องใช้ Image Prompt จาก Content Engine ของ scope เท่านั้น — ไม่มี fallback
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ce = await resolveContentEngine(orgId, projectId ? { projectId } : 'studio')
  if (!ce.imagePrompt) {
    return NextResponse.json({
      error: 'CONTENT_ENGINE_NOT_CONFIGURED',
      message: `ยังไม่มี Image Prompt ที่ Active ใน Content Engine (${projectId ? 'ของโปรเจกต์นี้' : 'ของ Studio'}) — ตั้งค่าก่อนสร้างรูป`,
    }, { status: 400 })
  }

  // Image Style Guide + ชุดสีธีม จาก Article Lab เป็นข้อมูลประกอบบรีฟของโปรเจกต์ — ทิศทางงานภาพยังมาจาก CE เท่านั้น
  let imageStyleGuide = ''
  let themeColor = ''
  let backgroundColor = ''
  let textColor = ''
  let effectiveAccent = accentColor
  // ภาษาของข้อความบนปก: ผู้เรียกส่งมาได้ตรง ๆ ไม่งั้นคิดจากภาษาโปรเจกต์ + โหมดภาษา + title/keyword
  // (โหมดไทย+อังกฤษ = อิงจาก title ก่อน, title อังกฤษล้วน = ปกอังกฤษ — กติกาเดียวกับตัวบทความ)
  let coverLanguage: 'th' | 'en' = languageFromBody === 'en' ? 'en' : 'th'
  let effectiveType: 'cover' | 'mid' = type === 'mid' ? 'mid' : 'cover'
  if (projectId) {
    try {
      const proj = await prisma.project.findFirst({
        where: { id: projectId, organizationId: orgId },
        select: { imageStyleGuide: true, themeColors: true, accentColor: true, language: true, pushPrefs: true },
      })
      if (!languageFromBody) {
        const mode = languageModeFromBody ?? readLanguagePrefs(proj?.pushPrefs, proj?.language).keywordMode
        coverLanguage = resolveArticleLanguage({ projectLanguage: proj?.language ?? 'th', mode, keyword, title })
      }
      imageStyleGuide = proj?.imageStyleGuide ?? ''
      const palette = resolveImagePalette(proj?.themeColors, proj?.accentColor)
      themeColor = palette.themeColor
      backgroundColor = palette.backgroundColor
      textColor = palette.textColor
      if (!effectiveAccent) effectiveAccent = palette.accentColor
      if (followImageSettings && effectiveType === 'cover') {
        let colors: Record<string, unknown> = {}
        try {
          const raw = proj?.themeColors as unknown
          colors = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw && typeof raw === 'object' ? raw as Record<string, unknown> : {})
        } catch { /* ค่าเสีย — ใช้ default */ }
        // ปิด "ปกมีตัวหนังสือ" = วาดแบบภาพไม่มีข้อความ เหมือน /api/article/write
        if (!readArticleImageSettings(colors.imageSettings).coverWithText) effectiveType = 'mid'
      }
    } catch { /* non-fatal */ }
  }

  try {
    // ข้อมูลเสริมบนปก (คำโปรย + bullet) — ผู้เรียกส่งมาเอง เช่น หน้า UI ที่มีบทความอยู่แล้ว
    // ข้อความที่จะวาดบนปก ต้องผ่านคำต้องห้ามของ scope เดียวกับ Content Engine ก่อน (บทความเก่า/แก้มือ อาจยังมีคำต้องห้าม)
    const tr = await loadTitleRestrictions(orgId, projectId ? { projectId } : 'studio')
    const clean = (t: string) => (tr.terms.length ? cleanPlainText(t, tr.terms).text : t)
    const coverTitle = clean(String(title))
    const withText = effectiveType === 'cover'
    const coverSubtitle = withText ? clean(typeof subtitle === 'string' ? subtitle : '') : ''
    const coverBullets = withText ? (Array.isArray(bullets) ? bullets.filter((b: unknown): b is string => typeof b === 'string').slice(0, 3) : []).map(clean) : []
    const result = await callGeminiImage({ client: await clientSlugForProject(projectId), keyword, title: coverTitle, type: effectiveType, siteName, brandTone, accentColor: effectiveAccent, themeColor, backgroundColor, textColor, width, height, promptTemplate: ce.imagePrompt.text, imageStyleGuide, coverSubtitle, coverBullets, imageAssets: ce.imageAssets, language: coverLanguage })

    // Log AI job for cost tracking
    try {
      const orgId = session?.user?.organizationId
      const userId = session?.user?.id
      if (orgId && userId) {
        await (prisma.aIJob as any).create({
          data: {
            organizationId: orgId,
            createdById: userId,
            ...(projectId && { projectId }),
            // ปก (แม้วาดแบบไม่มีตัวหนังสือ) นับเป็นค่าปก — 'mid' เฉพาะผู้เรียกขอรูปประกอบเอง
            jobType: type === 'mid' ? 'IMAGE_MID' : 'IMAGE_COVER',
            status: 'COMPLETED',
            modelProvider: 'OPENROUTER',
            modelName: OR_MODELS.image(),
            tokenUsed: result.totalTokens,
            estimatedCost: result.costUsd,
          },
        })
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({
      imageBase64: result.imageBase64,
      mimeType: result.mimeType,
      type: effectiveType, keyword, title,
      // ข้อมูลประกอบสำหรับหน้า Test Image (Article Lab) — ใช้ตรวจว่า prompt/ภาพอ้างอิง/โมเดลตรงตามที่ตั้งไว้
      meta: {
        model: result.model,
        imagePrompt: { id: ce.imagePrompt.id, name: ce.imagePrompt.name, version: ce.imagePrompt.version },
        referenceImageCount: result.referenceImageCount,
        logoAttached: result.logoAttached,
        language: coverLanguage,
        costUsd: result.costUsd,
      },
    })
  } catch (e: unknown) {
    console.error('[cover] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
