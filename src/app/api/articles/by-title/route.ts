import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const title     = searchParams.get('title')
  // id = แถวที่หน้าเรียกรู้อยู่แล้ว — ชื่อซ้ำกันหลายแถวจะได้แถวที่ถูก ไม่ต้องเดาจากชื่อ
  const id        = searchParams.get('id')

  if (!projectId || (!title && !id)) return NextResponse.json({ error: 'projectId and title (or id) required' }, { status: 400 })

  const userRole = session.user.role ?? ''
  let whereClause: Record<string, unknown>

  if (userRole === 'CLIENT') {
    // Verify client has access to this project
    const access = await prisma.clientProjectAccess.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    whereClause = id ? { id, projectId } : { projectId, title }
  } else {
    if (!session.user.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    whereClause = id
      ? { id, projectId, project: { organizationId: session.user.organizationId } }
      : { projectId, title, project: { organizationId: session.user.organizationId } }
  }

  // fields=html = เอาแค่เนื้อหา (หน้า Push โหลดทีละบทความ) — ไม่ส่งปก data URI/คอมเมนต์ที่ไม่ได้ใช้
  if (searchParams.get('fields') === 'html') {
    const lite = await prisma.article.findFirst({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, status: true, htmlContent: true, updatedAt: true },
    })
    if (!lite) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(lite)
  }

  const article = await prisma.article.findFirst({
    where: whereClause,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, title: true, htmlContent: true, status: true, slug: true, metaDescription: true, seoTitle: true,
      // ปกที่เปลี่ยนในแท็บ Review เก็บเป็น data URI — ต้องส่งกลับไปโชว์ตอนเปิดรอบใหม่
      coverImageUrl: true,
      comments: { include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: 'asc' as const } },
    },
  })

  if (!article) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(article)
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, title, id, wordpressUrl, status, scheduledAt } = await req.json()
  if (!projectId || (!title && !id)) return NextResponse.json({ error: 'projectId and title (or id) required' }, { status: 400 })

  // scheduledAt มาจาก Content Map เป็น 'YYYY-MM-DD' — ตีความเป็นเที่ยงคืนตามเวลาท้องถิ่น
  // ไม่ใช่ UTC ไม่งั้นโซนเวลาไทยจะทำให้วันที่เพี้ยนไป 1 วัน
  let scheduledValue: Date | null | undefined
  if (scheduledAt !== undefined) {
    if (scheduledAt === null || scheduledAt === '') {
      scheduledValue = null
    } else {
      const parsed = new Date(`${scheduledAt}T00:00:00`)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'invalid scheduledAt' }, { status: 400 })
      }
      scheduledValue = parsed
    }
  }

  // มี id ใช้ id ก่อน · ไม่มีหาตามชื่อเรียง updatedAt desc ให้ตรงกับ GET (ชื่อซ้ำได้แถวเดียวกัน)
  const article = await prisma.article.findFirst({
    where: typeof id === 'string' && id
      ? { id, projectId, project: { organizationId: session.user.organizationId } }
      : { projectId, title, project: { organizationId: session.user.organizationId } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  if (!article) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.article.update({
    where: { id: article.id },
    data: {
      ...(wordpressUrl !== undefined && { wordpressUrl }),
      ...(status !== undefined && { status }),
      ...(scheduledValue !== undefined && { scheduledAt: scheduledValue }),
    },
  })
  return NextResponse.json({ ok: true })
}
