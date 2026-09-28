import { NextRequest, NextResponse } from 'next/server'

import { getSession } from '@/lib/auth'
import { runBusinessSkillScan } from '@/lib/business-skill-scan'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { OR_MODELS } from '@/lib/openrouter'
import { prisma } from '@/lib/prisma'
import { resolveCeSet } from '@/lib/upload-article/pbn-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/upload-article/clients/[id]/prompts/business-skill-scan
 * เหมือน POST /api/prompts/business-skill-scan ทุกจุด — ต่างแค่ url fallback ใช้ client.website
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  // PBN Backlinks: ?set=<id> = Content Engine ของ set ข้อมูลโปรเจกต์นั้น (ไม่ส่ง = ขอบเขตเดิม)
  const ceSet = resolveCeSet(client, req.url)
  if ('error' in ceSet) return NextResponse.json({ error: ceSet.error }, { status: 400 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const raw = ((typeof body.url === 'string' && body.url.trim()) || ceSet.client.website || '').trim()
  if (!raw) {
    return NextResponse.json({ error: 'ยังไม่มี URL เว็บไซต์ — วางลิงก์ก่อนสแกน' }, { status: 400 })
  }
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  try {
    const result = await runBusinessSkillScan(url)
    logAIJob({
      organizationId: orgId,
      projectId: null,
      inputSummary: uaJobInput(client.id),
      jobType: 'BUSINESS_SKILL_SCAN',
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
