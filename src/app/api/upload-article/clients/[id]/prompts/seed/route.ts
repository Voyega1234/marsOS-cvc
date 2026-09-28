import { NextRequest, NextResponse } from 'next/server'

import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CE_TYPES = ['CE_BUSINESS_SKILL', 'CE_MASTER_PROMPT', 'CE_ARTICLE_BRIEF', 'CE_VALIDATOR_PACK', 'CE_IMAGE_PROMPT']

/**
 * POST /api/upload-article/clients/[id]/prompts/seed
 * คัดลอกแถว Content Engine ที่ active อยู่ใน Studio (projectId=null) มาให้ลูกค้ารายนี้
 * เฉพาะ type ที่ยังไม่มีแถวเลยในขอบเขตนี้ — idempotent (เรียกซ้ำแล้ว created=0)
 * Business Skill: ปกติ Studio ไม่มี active BS อยู่แล้ว จึงข้ามไปเองตามกติกาเดียวกัน (ไม่คัดลอกแถวที่ inactive)
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const createdTypes: string[] = []

  for (const type of CE_TYPES) {
    const existingCount = await prisma.promptTemplate.count({
      where: { organizationId: orgId, projectId: client.id, type },
    })
    if (existingCount > 0) continue

    const studioActive = await prisma.promptTemplate.findFirst({
      where: { organizationId: orgId, projectId: null, type, isActive: true },
    })
    if (!studioActive) continue

    await prisma.promptTemplate.create({
      data: {
        name: studioActive.name,
        type: studioActive.type,
        description: studioActive.description,
        promptText: studioActive.promptText,
        variables: studioActive.variables,
        modelProvider: studioActive.modelProvider,
        modelName: studioActive.modelName,
        temperature: studioActive.temperature,
        maxTokens: studioActive.maxTokens,
        isActive: true,
        version: 1,
        organizationId: orgId,
        createdById: session.user.id,
        projectId: client.id,
      },
    })
    createdTypes.push(type)
  }

  return NextResponse.json({ created: createdTypes.length, types: createdTypes })
}
