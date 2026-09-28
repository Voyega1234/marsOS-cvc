import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeClientCounts, toUploadClientDTO } from '@/lib/upload-article/serialize'
import { PBN_PREFS_MARK } from '@/lib/upload-article/pbn'

/** GET /api/upload-article/clients — รายชื่อลูกค้า Upload Article (ใหม่สุดก่อน) */
export async function GET() {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const clients = await prisma.uploadClient.findMany({
    // แถวโปรเจกต์ PBN Backlinks อยู่เมนูของมันเอง ไม่แสดงในรายชื่อลูกค้า Upload Article
    where: { organizationId: session.user.organizationId, NOT: { pushPrefs: { contains: PBN_PREFS_MARK } } },
    orderBy: { updatedAt: 'desc' },
    include: { articles: { select: { status: true } } },
  })

  const dtos = clients.map((c) => toUploadClientDTO(c, computeClientCounts(c.articles)))
  return NextResponse.json(dtos)
}

/** POST /api/upload-article/clients — สร้างลูกค้าใหม่ { name, website? } */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? '').trim().slice(0, 120)
  const website = String(body?.website ?? '').trim()
  if (!name) return NextResponse.json({ error: 'กรุณากรอกชื่อลูกค้า' }, { status: 400 })

  const created = await prisma.uploadClient.create({
    data: {
      organizationId: session.user.organizationId,
      name,
      website,
      createdById: session.user.id,
    },
  })

  return NextResponse.json(toUploadClientDTO(created, { total: 0, imported: 0, generated: 0, reviewed: 0, pushed: 0, failed: 0 }), { status: 201 })
}
