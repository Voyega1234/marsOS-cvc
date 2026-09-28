import { NextRequest, NextResponse } from 'next/server'

import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAIJob } from '@/lib/logAIJob'
import { OR_MODELS } from '@/lib/openrouter'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import {
  buildMasterPromptFromExamples,
  extractExampleSources,
  MASTER_EXAMPLES_MAX_SOURCES,
  MASTER_EXAMPLES_MIN_SOURCES,
  type MasterExampleSourceInput,
} from '@/lib/upload-article/master-prompt-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function defaultName(): string {
  const now = new Date()
  return `Master Prompt จากบทความตัวอย่าง ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`
}

/**
 * POST /api/upload-article/clients/[id]/prompts/master-from-examples
 * body: { sources: ({url}|{text})[] (3-5), name?, activate? }
 * อ่านบทความตัวอย่างแล้วถอดแพทเทิร์นเป็น Master Prompt (ข้อความไทยล้วน — เปิดในโหมด raw)
 * บันทึกเป็น PromptTemplate CE_MASTER_PROMPT แถวใหม่ในขอบเขตลูกค้ารายนี้ ไม่ active โดยอัตโนมัติ
 * เว้นแต่ activate=true (จะ deactivate แถวเดิมแล้ว activate แถวใหม่ในทรานแซกชันเดียว)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const rawSources = Array.isArray(body.sources) ? (body.sources as MasterExampleSourceInput[]) : []

  if (rawSources.length < MASTER_EXAMPLES_MIN_SOURCES || rawSources.length > MASTER_EXAMPLES_MAX_SOURCES) {
    return NextResponse.json(
      { error: `ต้องมีตัวอย่างบทความ ${MASTER_EXAMPLES_MIN_SOURCES}-${MASTER_EXAMPLES_MAX_SOURCES} ชิ้น` },
      { status: 400 },
    )
  }

  const extracted = await extractExampleSources(rawSources)
  if (!extracted.ok) {
    return NextResponse.json({ error: extracted.error || 'ตัวอย่างบทความไม่พอสำหรับวิเคราะห์' }, { status: 400 })
  }

  const clientSlug = `upload-${slugifyClient(client.name)}`
  let promptText = ''
  try {
    const result = await withOrClient(clientSlug, () => buildMasterPromptFromExamples(extracted.sources, clientSlug))
    promptText = result.text
    logAIJob({
      organizationId: orgId,
      projectId: null,
      jobType: 'CE_MASTER_PROMPT_FROM_EXAMPLES',
      modelProvider: 'OPENROUTER',
      modelName: OR_MODELS.writer(),
      status: 'SUCCESS',
      tokenUsed: result.usage.totalTokens,
      estimatedCost: result.usage.costUsd,
      createdById: session.user.id,
    }).catch(() => {})
  } catch (err) {
    logAIJob({
      organizationId: orgId,
      projectId: null,
      jobType: 'CE_MASTER_PROMPT_FROM_EXAMPLES',
      modelProvider: 'OPENROUTER',
      modelName: OR_MODELS.writer(),
      status: 'FAILED',
      errorMessage: (err as Error).message,
      createdById: session.user.id,
    }).catch(() => {})
    return NextResponse.json({ error: `สร้าง Master Prompt ไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 })
  }

  if (!promptText.trim()) {
    return NextResponse.json({ error: 'AI ไม่ได้ตอบ Master Prompt กลับมา' }, { status: 502 })
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : defaultName()
  const activate = body.activate === true

  const prompt = await prisma.$transaction(async (tx) => {
    if (activate) {
      await tx.promptTemplate.updateMany({
        where: { organizationId: orgId, projectId: client.id, type: 'CE_MASTER_PROMPT', isActive: true },
        data: { isActive: false },
      })
    }
    return tx.promptTemplate.create({
      data: {
        name,
        type: 'CE_MASTER_PROMPT',
        description: '',
        promptText: promptText.trim(),
        variables: '[]',
        modelProvider: 'CLAUDE',
        modelName: 'claude-sonnet-4-6',
        temperature: 0.7,
        maxTokens: 4000,
        isActive: activate,
        version: 1,
        organizationId: orgId,
        createdById: session.user.id,
        projectId: client.id,
      },
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { versions: true } },
      },
    })
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

  return NextResponse.json({ prompt }, { status: 201 })
}
