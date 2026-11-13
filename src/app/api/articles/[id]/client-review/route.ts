import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CLIENT_REVIEW_VISIBLE } from '@/lib/client-proposal/constants'
import { proposalNote, validateProposalInput } from '@/lib/client-proposal/store'
import { notifyTeamOfClientAction } from '@/lib/client-proposal/notify'

// Client: approve, request revision or propose text edits on an article
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { body = null }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const { action, comment } = body as { action?: unknown; comment?: unknown }
  // action: 'approve' | 'revision' | 'propose'
  if (typeof action !== 'string' || !['approve', 'revision', 'propose'].includes(action)) {
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

  const isClient = userRole === 'CLIENT'
  const link = `/projects/${article.projectId}?tab=review&proposal=${article.id}`

  if (action === 'propose') {
    if (!isClient) return NextResponse.json({ error: 'เฉพาะบัญชีลูกค้าเท่านั้น' }, { status: 403 })
    if (!(CLIENT_REVIEW_VISIBLE as readonly string[]).includes(article.status)) {
      return NextResponse.json({ error: 'บทความนี้ยังไม่อยู่ในขั้นตอนรีวิว จึงส่งข้อเสนอแก้ไขไม่ได้' }, { status: 409 })
    }
    const input = validateProposalInput(body)
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: input.status })
    if (input.baseUpdatedAt && input.baseUpdatedAt !== article.updatedAt.toISOString()) {
      return NextResponse.json({ error: 'บทความถูกอัปเดตระหว่างที่คุณแก้ไข กรุณาโหลดใหม่แล้วลองอีกครั้ง' }, { status: 409 })
    }

    const n = input.edits.length
    const userId = session.user.id
    const proposalId = await prisma.$transaction(async (tx) => {
      await tx.articleVersion.updateMany({
        where: { articleId: params.id, changeNote: proposalNote('pending') },
        data: { changeNote: proposalNote('superseded') },
      })
      const version = await tx.articleVersion.create({
        data: {
          articleId: params.id,
          versionNumber: 0,
          changedById: userId,
          changeNote: proposalNote('pending'),
          title: article.title,
          htmlContent: null,
          outline: JSON.stringify({ v: 1, baseUpdatedAt: input.baseUpdatedAt, comment: input.comment, edits: input.edits }),
        },
      })
      await tx.comment.create({
        data: {
          articleId: params.id,
          userId,
          body: `[📝 Client เสนอแก้ไข ${n} จุด]${input.comment ? ` ${input.comment}` : ''}`,
          fieldName: `client_proposal:${version.id}`,
        },
      })
      await tx.article.update({ where: { id: params.id }, data: { status: 'CLIENT_REVISION' } })
      await tx.activityLog.create({
        data: {
          organizationId: article.project.organizationId,
          userId,
          action: 'CLIENT_PROPOSAL_SENT',
          entityType: 'Article',
          entityId: params.id,
          newValue: JSON.stringify({ proposalId: version.id, edits: n, ...(input.comment ? { comment: input.comment } : {}) }),
        },
      })
      return version.id
    })

    await notifyTeamOfClientAction({
      articleId: params.id,
      type: 'CLIENT_PROPOSAL',
      title: 'ลูกค้าเสนอแก้ไขบทความ',
      body: `${article.title} — แก้ ${n} จุด`,
      link,
    })
    return NextResponse.json({ ok: true, status: 'CLIENT_REVISION', proposalId })
  }

  // approve ได้เฉพาะบทความที่อยู่ในขั้น review (APPROVED ซ้ำ = idempotent) — กัน approve ทับบทความที่ push/ยังไม่เสร็จ
  if (action === 'approve' && !['REVIEW', 'CLIENT_REVIEW', 'APPROVED'].includes(article.status)) {
    return NextResponse.json({ error: 'บทความนี้ยังไม่อยู่ในขั้นตอนรีวิว จึงอนุมัติไม่ได้' }, { status: 409 })
  }

  // ลูกค้าขอแก้ได้เฉพาะบทความที่เห็นในแท็บ Review — กันยิง API ตรง ๆ เปลี่ยนสถานะบทความที่ push แล้ว / กำลังเขียน
  // (ทีมงานเรียก action นี้ได้ตามเดิม)
  if (action === 'revision' && isClient && !(CLIENT_REVIEW_VISIBLE as readonly string[]).includes(article.status)) {
    return NextResponse.json({ error: 'บทความนี้ยังไม่อยู่ในขั้นตอนรีวิว จึงขอแก้ไขไม่ได้' }, { status: 409 })
  }

  const newStatus = action === 'approve' ? 'APPROVED' : 'CLIENT_REVISION'

  await prisma.article.update({
    where: { id: params.id },
    data: { status: newStatus },
  })

  // Save comment
  const commentText = typeof comment === 'string' ? comment.trim() : undefined
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

  if (isClient) {
    await notifyTeamOfClientAction({
      articleId: params.id,
      type: action === 'approve' ? 'CLIENT_APPROVED' : 'CLIENT_REVISION',
      title: action === 'approve' ? 'ลูกค้าอนุมัติบทความ' : 'ลูกค้าขอแก้ไขบทความ',
      body: article.title,
      link,
    })
  }

  return NextResponse.json({ ok: true, status: newStatus })
}
