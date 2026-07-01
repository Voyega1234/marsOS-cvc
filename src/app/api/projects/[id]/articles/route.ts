import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status')
  const where: any = { projectId: params.id, project: { organizationId: session.user.organizationId } }
  if (status) where.status = status

  const articles = await prisma.article.findMany({
    where,
    select: { id: true, title: true, slug: true, status: true, keywordId: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({ articles })
}
