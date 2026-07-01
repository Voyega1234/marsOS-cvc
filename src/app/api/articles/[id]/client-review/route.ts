import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Client: approve or request revision on an article
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, comment } = await req.json()
  // action: 'approve' | 'revision'
  if (!['approve', 'revision'].includes(action)) {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  }

  const article = await prisma.article.findUnique({
    where: { id: params.id },
    include: { project: { select: { organizationId: true } } },
  })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Allow: CLIENT with access to this project, or ADMIN/team in same org
  const userRole = session.user.role ?? ''
  const orgId = session.user.organizationId ?? ''

  if (userRole === 'CLIENT') {
    const access = await prisma.clientProjectAccess.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId: article.projectId } },
    })
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (article.project.organizationId !== orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const newStatus = action === 'approve' ? 'APPROVED' : 'CLIENT_REVISION'

  await prisma.article.update({
    where: { id: params.id },
    data: { status: newStatus },
  })

  // Save comment
  const commentText = comment?.trim()
  if (commentText) {
    const prefix = action === 'approve' ? '✅ Client Approved' : '✏️ Client ขอแก้ไข'
    await prisma.comment.create({
      data: {
        articleId: params.id,
        userId: session.user.id,
        body: `[${prefix}] ${commentText}`,
      },
    })
  } else if (action === 'revision') {
    // Always save a marker comment for revision even without text
    await prisma.comment.create({
      data: {
        articleId: params.id,
        userId: session.user.id,
        body: '✏️ Client ขอแก้ไขบทความ',
      },
    })
  }

  // Log activity
  try {
    await prisma.activityLog.create({
      data: {
        organizationId: article.project.organizationId,
        userId: session.user.id,
        action: action === 'approve' ? 'CLIENT_APPROVED' : 'CLIENT_REVISION_REQUESTED',
        entityType: 'Article',
        entityId: params.id,
        newValue: commentText ? JSON.stringify({ comment: commentText }) : null,
      },
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, status: newStatus })
}
