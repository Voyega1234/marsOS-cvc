import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runLabScan } from '@/lib/lab-scan'
import { logAIJob } from '@/lib/logAIJob'
import { OR_MODELS } from '@/lib/openrouter'
import { slugifyClient } from '@/lib/orClient'
import type { UploadTheme } from '@/lib/upload-article/types'

export const maxDuration = 300

/**
 * POST /api/upload-article/clients/[id]/theme-scan — สแกนเว็บต้นฉบับแล้วเสนอธีมสี/ฟอนต์
 * ไม่บันทึกลง DB — ทีมกดรับแล้วกด "บันทึกธีม" (PATCH client) เอง
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const raw = (typeof body.url === 'string' && body.url.trim()) || client.website || ''
  if (!raw.trim()) {
    return NextResponse.json({ error: 'ยังไม่มี URL เว็บไซต์ — กรอก URL ก่อนสแกน' }, { status: 400 })
  }
  const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`

  let currentTheme: UploadTheme
  try {
    currentTheme = JSON.parse(client.themeColors)
  } catch {
    currentTheme = { theme: '#2563eb', text: '#1f2937', border: '#e5e7eb', accent: '#2563eb', background: '', styleMode: 'embed' }
  }

  try {
    const result = await runLabScan(url, `upload-${slugifyClient(client.name)}`)
    logAIJob({
      organizationId: session.user.organizationId,
      projectId: null,
      jobType: 'UPLOAD_THEME_SCAN',
      modelProvider: 'OPENROUTER',
      modelName: OR_MODELS.default(),
      status: 'SUCCESS',
      tokenUsed: result.usage.totalTokens,
      estimatedCost: result.usage.costUsd,
      createdById: session.user.id,
    }).catch(() => {})

    // pickFont ของ lab-scan คืน 'Sarabun' เป็นค่า fallback เวลาไม่เจอฟอนต์บนเว็บเลย — ถ้าเว็บไม่ได้ใช้ Sarabun จริง
    // (ไม่เจอชื่อนี้ใน evidence.fonts ที่อ่านจาก CSS ของเว็บ) ให้ถือว่าเป็นค่าเดา ไม่เอามาทับธีมเดิม
    const evidenceHasFont = (name: string) => result.evidence.fonts.some((f) => f.name.toLowerCase().includes(name.toLowerCase()))
    const isGuessedSarabun = (v: string | undefined) => v === 'Sarabun' && !evidenceHasFont('Sarabun')
    const bodyFont = result.suggestion.fonts?.body
    const headingFont = result.suggestion.fonts?.heading

    const theme: UploadTheme = {
      theme: result.suggestion.colors.theme || currentTheme.theme,
      text: result.suggestion.colors.text || currentTheme.text,
      border: result.suggestion.colors.border || currentTheme.border,
      accent: result.suggestion.colors.accent || currentTheme.accent,
      background: result.suggestion.colors.background || currentTheme.background,
      styleMode: currentTheme.styleMode,
      fontFamily: bodyFont && !isGuessedSarabun(bodyFont) ? bodyFont : currentTheme.fontFamily,
      headingFont: headingFont && !isGuessedSarabun(headingFont) ? headingFont : currentTheme.headingFont,
    }

    return NextResponse.json({ theme, raw: result })
  } catch (err) {
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 })
  }
}
