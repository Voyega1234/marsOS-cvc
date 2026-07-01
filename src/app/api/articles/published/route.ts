import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const articles = await prisma.article.findMany({
    where: {
      projectId,
      project: { organizationId: session.user.organizationId },
      OR: [
        { status: 'POSTED' },
        { status: 'WORDPRESS_DRAFTED' },
        { wordpressUrl: { not: null } },
      ],
    },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      wordpressUrl: true,
      keyword: { select: { keyword: true } },
      updatedAt: true,
      funnelStage: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json(articles)
}
