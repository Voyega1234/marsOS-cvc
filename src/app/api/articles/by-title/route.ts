import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const title     = searchParams.get('title')

  if (!projectId || !title) return NextResponse.json({ error: 'projectId and title required' }, { status: 400 })

  const userRole = session.user.role ?? ''
  let whereClause: Record<string, unknown>

  if (userRole === 'CLIENT') {
    // Verify client has access to this project
    const access = await prisma.clientProjectAccess.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    whereClause = { projectId, title }
  } else {
    if (!session.user.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    whereClause = { projectId, title, project: { organizationId: session.user.organizationId } }
  }

  const article = await prisma.article.findFirst({
    where: whereClause,
    select: {
      id: true, title: true, htmlContent: true, status: true, slug: true, metaDescription: true, seoTitle: true,
      comments: { include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: 'asc' as const } },
    },
  })

  if (!article) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(article)
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, title, wordpressUrl, status } = await req.json()
  if (!projectId || !title) return NextResponse.json({ error: 'projectId and title required' }, { status: 400 })

  const article = await prisma.article.findFirst({
    where: { projectId, title, project: { organizationId: session.user.organizationId } },
    select: { id: true },
  })
  if (!article) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.article.update({
    where: { id: article.id },
    data: {
      ...(wordpressUrl !== undefined && { wordpressUrl }),
      ...(status !== undefined && { status }),
    },
  })
  return NextResponse.json({ ok: true })
}
