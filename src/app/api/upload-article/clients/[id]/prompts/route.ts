import { NextRequest, NextResponse } from 'next/server'

import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withHumanVoice } from '@/lib/upload-article/human-voice'
import { resolveCeSet } from '@/lib/upload-article/pbn-context'

export const dynamic = 'force-dynamic'

/**
 * POST /api/upload-article/clients/[id]/prompts — สร้างแถว Content Engine (PromptTemplate)
 * ในขอบเขตของลูกค้า Upload Article รายนี้ (projectId = client id)
 * ลอกพฤติกรรมมาจาก POST /api/prompts ทุกจุด ต่างแค่บังคับ scope เป็นลูกค้ารายนี้เสมอ (ไม่รับ body.projectId)
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
  const { name, type, description, promptText, variables, modelProvider, modelName, temperature, maxTokens } = body

  if (!name?.trim() || !type || !promptText?.trim()) {
    return NextResponse.json({ error: 'name, type, and promptText are required' }, { status: 400 })
  }

  const resolvedProjectId = ceSet.scopeId

  // Layer แรกของ type นั้นใน scope นี้ → เปิดใช้งานให้เลย (เหมือน POST /api/prompts)
  const isCeLayer = typeof type === 'string' && type.startsWith('CE_')
  const hasActiveSibling = isCeLayer
    ? (await prisma.promptTemplate.count({
        where: { organizationId: orgId, projectId: resolvedProjectId, type, isActive: true },
      })) > 0
    : true

  const prompt = await prisma.promptTemplate.create({
    data: {
      name: name.trim(),
      type,
      description: description?.trim() ?? '',
      promptText: type === 'CE_MASTER_PROMPT' ? withHumanVoice(promptText) : promptText.trim(),
      variables: variables ?? '[]',
      modelProvider: modelProvider ?? 'CLAUDE',
      modelName: modelName ?? 'claude-sonnet-4-6',
      temperature: temperature ?? 0.7,
      maxTokens: maxTokens ?? 4000,
      isActive: isCeLayer && !hasActiveSibling,
      version: 1,
      organizationId: orgId,
      createdById: session.user.id,
      projectId: resolvedProjectId,
    },
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { versions: true } },
    },
  })

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId: session.user.id,
      action: 'CREATE_PROMPT',
      entityType: 'PromptTemplate',
      entityId: prompt.id,
      newValue: JSON.stringify({ name: prompt.name, type: prompt.type }),
    },
  })

  return NextResponse.json(prompt, { status: 201 })
}
