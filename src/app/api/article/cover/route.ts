/**
 * Cover image generator — uses Gemini image generation (gemini-3.1-flash-image)
 * POST { keyword, title, siteName?, brandTone?, type?: 'cover'|'mid' }
 * Returns { imageBase64: string, mimeType: string, type, keyword, title }
 *
 * Cover: Claude Art Director analyzes topic → detailed infographic prompt → Gemini
 * Mid:   Keyword-specific editorial photo, NO text, NO infographics
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveImagePalette } from '@/lib/articleTheme'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'
import { clientSlugForProject } from '@/lib/orClient'
import { OR_MODELS } from '@/lib/openrouter'
import { resolveContentEngine } from '@/lib/content-engine-resolve'

export const maxDuration = 120

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession()
  const body = await req.json()
  const {
    keyword, title,
    siteName = '', brandTone = '',
    accentColor = '',
    width, height,
    type = 'cover' as 'cover' | 'mid',
    projectId,
    subtitle = '',
    bullets = [],
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
  if (projectId) {
    try {
      const proj = await prisma.project.findFirst({
        where: { id: projectId, organizationId: orgId },
        select: { imageStyleGuide: true, themeColors: true, accentColor: true },
      })
      imageStyleGuide = proj?.imageStyleGuide ?? ''
      const palette = resolveImagePalette(proj?.themeColors, proj?.accentColor)
      themeColor = palette.themeColor
      backgroundColor = palette.backgroundColor
      textColor = palette.textColor
      if (!effectiveAccent) effectiveAccent = palette.accentColor
    } catch { /* non-fatal */ }
  }

  try {
    // ข้อมูลเสริมบนปก (คำโปรย + bullet) — ผู้เรียกส่งมาเอง เช่น หน้า UI ที่มีบทความอยู่แล้ว
    const coverSubtitle = typeof subtitle === 'string' ? subtitle : ''
    const coverBullets = Array.isArray(bullets) ? bullets.filter((b: unknown): b is string => typeof b === 'string').slice(0, 3) : []
    const result = await callGeminiImage({ client: await clientSlugForProject(projectId), keyword, title, type, siteName, brandTone, accentColor: effectiveAccent, themeColor, backgroundColor, textColor, width, height, promptTemplate: ce.imagePrompt.text, imageStyleGuide, coverSubtitle, coverBullets })

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
      type, keyword, title,
    })
  } catch (e: unknown) {
    console.error('[cover] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
