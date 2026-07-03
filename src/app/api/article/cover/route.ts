/**
 * Cover image generator — uses Gemini image generation (gemini-3.1-flash-image)
 * POST { keyword, title, siteName?, brandTone?, type?: 'cover'|'mid' }
 * Returns { imageBase64: string, mimeType: string, type, keyword, title }
 *
 * Cover: Claude Art Director analyzes topic → detailed infographic prompt → Gemini
 * Mid:   Keyword-specific editorial photo, NO text, NO infographics
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callGeminiImage } from '@/lib/geminiImage'
import { getMissingVertexEnvVars, VERTEX_IMAGE_MODEL } from '@/lib/vertex'

export const maxDuration = 120

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession()
  const body = await req.json()
  const {
    keyword, title,
    siteName = '', brandTone = '',
    accentColor = '',
    width = 1536, height = 864,
    type = 'cover' as 'cover' | 'mid',
    projectId,
  } = body

  if (!keyword || !title) {
    return NextResponse.json({ error: 'keyword and title are required' }, { status: 400 })
  }

  const missingVertexConfig = getMissingVertexEnvVars()
  if (missingVertexConfig.length > 0) {
    return NextResponse.json({ error: `Vertex AI OIDC configuration is incomplete: ${missingVertexConfig.join(', ')}` }, { status: 500 })
  }

  try {
    const result = await callGeminiImage({ keyword, title, type, siteName, brandTone, accentColor, width, height })

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
            modelProvider: 'GEMINI',
            modelName: VERTEX_IMAGE_MODEL,
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
