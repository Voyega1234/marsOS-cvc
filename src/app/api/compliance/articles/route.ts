import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errMsg, requireStaff } from '@/lib/compliance/server'

export const dynamic = 'force-dynamic'

/** รายชื่อบทความให้เลือกตรวจ — ไม่ส่งเนื้อหา */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const source = req.nextUrl.searchParams.get('source')
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100)
    const titleFilter = q ? { title: { contains: q, mode: 'insensitive' as const } } : {}

    if (source === 'sme') {
      const rows = await prisma.article.findMany({
        where: { project: { organizationId: ctx.orgId }, ...titleFilter },
        select: { id: true, title: true, status: true, updatedAt: true, project: { select: { name: true, clientName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      })
      return NextResponse.json({
        articles: rows.map((r) => ({
          id: r.id, title: r.title, ownerLabel: r.project?.clientName || r.project?.name || '', status: r.status, updatedAt: r.updatedAt,
        })),
      })
    }
    if (source === 'upload') {
      const rows = await prisma.uploadArticle.findMany({
        where: { organizationId: ctx.orgId, ...titleFilter },
        select: { id: true, title: true, status: true, updatedAt: true, client: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      })
      return NextResponse.json({
        articles: rows.map((r) => ({ id: r.id, title: r.title, ownerLabel: r.client?.name ?? '', status: r.status, updatedAt: r.updatedAt })),
      })
    }
    return NextResponse.json({ error: 'source ต้องเป็น sme หรือ upload' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
