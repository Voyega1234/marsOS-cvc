import { NextRequest, NextResponse } from 'next/server'

import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withHumanVoice } from '@/lib/upload-article/human-voice'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { OR_MODELS } from '@/lib/openrouter'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { proposeMasterPromptEdit, MASTER_EDIT_MAX_INSTRUCTION_CHARS } from '@/lib/upload-article/master-prompt-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/upload-article/clients/[id]/prompts/master-edit
 * body: { promptId, instruction }
 * เสนอ Master Prompt ฉบับแก้ไขตาม instruction — ไม่บันทึกลง DB ทีมกดบันทึกเองผ่าน PUT /api/prompts/[id]
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const promptId = typeof body.promptId === 'string' ? body.promptId : ''
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''

  if (!promptId) return NextResponse.json({ error: 'ต้องระบุ promptId' }, { status: 400 })
  if (!instruction) return NextResponse.json({ error: 'ต้องระบุคำสั่งแก้ไข' }, { status: 400 })
  if (instruction.length > MASTER_EDIT_MAX_INSTRUCTION_CHARS) {
    return NextResponse.json({ error: `คำสั่งแก้ไขยาวเกินไป (สูงสุด ${MASTER_EDIT_MAX_INSTRUCTION_CHARS} ตัวอักษร)` }, { status: 400 })
  }

  const existing = await prisma.promptTemplate.findFirst({
    where: { id: promptId, organizationId: orgId, projectId: client.id, type: 'CE_MASTER_PROMPT' },
  })
  if (!existing) return NextResponse.json({ error: 'ไม่พบ Master Prompt นี้ในขอบเขตของลูกค้ารายนี้' }, { status: 404 })

  let isJson = true
  try {
    JSON.parse(existing.promptText)
  } catch {
    isJson = false
  }

  const clientSlug = `upload-${slugifyClient(client.name)}`
  try {
    const result = await withOrClient(clientSlug, () =>
      proposeMasterPromptEdit(existing.promptText, instruction, isJson, clientSlug),
    )
    logAIJob({
      organizationId: orgId,
      projectId: null,
      inputSummary: uaJobInput(client.id),
      jobType: 'CE_MASTER_PROMPT_EDIT',
      modelProvider: 'OPENROUTER',
      modelName: OR_MODELS.writer(),
      status: 'SUCCESS',
      tokenUsed: result.usage.totalTokens,
      estimatedCost: result.usage.costUsd,
      createdById: session.user.id,
    }).catch(() => {})
    // AI แก้แล้วเผลอตัดกฎภาษามนุษย์ทิ้ง → แนบกลับ (ผู้ใช้ลบเองได้ตอนแก้ในหน้า Content Engine)
    return NextResponse.json({ promptText: withHumanVoice(result.promptText), summary: result.summary })
  } catch (err) {
    logAIJob({
      organizationId: orgId,
      projectId: null,
      inputSummary: uaJobInput(client.id),
      jobType: 'CE_MASTER_PROMPT_EDIT',
      modelProvider: 'OPENROUTER',
      modelName: OR_MODELS.writer(),
      status: 'FAILED',
      errorMessage: (err as Error).message,
      createdById: session.user.id,
    }).catch(() => {})
    return NextResponse.json({ error: `แก้ไข Master Prompt ไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 })
  }
}
