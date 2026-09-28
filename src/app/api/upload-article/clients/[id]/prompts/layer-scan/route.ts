import { NextRequest, NextResponse } from 'next/server'

import { getSession } from '@/lib/auth'
import { runLayerScan, type CELayerScanType } from '@/lib/ce-layer-scan'
import { logAIJob } from '@/lib/logAIJob'
import { OR_MODELS } from '@/lib/openrouter'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const VALID_LAYERS: CELayerScanType[] = ['CE_MASTER_PROMPT', 'CE_ARTICLE_BRIEF', 'CE_VALIDATOR_PACK', 'CE_IMAGE_PROMPT']

/**
 * POST /api/upload-article/clients/[id]/prompts/layer-scan
 * เหมือน POST /api/prompts/layer-scan ทุกจุด — ต่างแค่ url fallback ใช้ client.website (ไม่ใช่ Project.website)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const layer = typeof body.layer === 'string' ? (body.layer as CELayerScanType) : null
  if (!layer || !VALID_LAYERS.includes(layer)) {
    return NextResponse.json({ error: 'layer ไม่ถูกต้อง' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const url = ((typeof body.url === 'string' && body.url.trim()) || (!text && client.website) || '').trim()

  if (!url && !text) {
    return NextResponse.json({ error: 'ต้องวางลิงก์หรือวางข้อความก่อนสแกน' }, { status: 400 })
  }

  try {
    const result = await runLayerScan({ layer, url: url || undefined, text: text || undefined })
    logAIJob({
      organizationId: orgId,
      projectId: null,
      jobType: 'CE_LAYER_SCAN',
      modelProvider: 'OPENROUTER',
      modelName: OR_MODELS.default(),
      status: 'SUCCESS',
      tokenUsed: result.usage.totalTokens,
      estimatedCost: result.usage.costUsd,
      createdById: session.user.id,
    }).catch(() => {})
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 })
  }
}
