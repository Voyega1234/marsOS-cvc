import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PROPOSAL_NOTE_PREFIX, type ProposalView } from '@/lib/client-proposal/constants'
import { parseProposalPayload, parseProposalStatus, proposalNote } from '@/lib/client-proposal/store'

// Team only: read / resolve proposals a client sent for an article
async function guard(articleId: string) {
  const session = await getSession()
  if (!session?.user?.id) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const orgId = session.user.organizationId
  if (!orgId) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId: orgId } },
    select: { id: true },
  })
  if (!article) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { res: null }
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (g.res) return g.res
  const rows = await prisma.articleVersion.findMany({
    where: { articleId: params.id, changeNote: { startsWith: PROPOSAL_NOTE_PREFIX } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, createdAt: true, changeNote: true, outline: true, changedBy: { select: { name: true } } },
  })
  const proposals: ProposalView[] = []
  for (const r of rows) {
    const status = parseProposalStatus(r.changeNote)
    const payload = parseProposalPayload(r.outline)
    if (!status || !payload) continue
    proposals.push({
      id: r.id,
      status,
      createdAt: r.createdAt.toISOString(),
      author: { name: r.changedBy?.name ?? null },
      comment: payload.comment,
      baseUpdatedAt: payload.baseUpdatedAt,
      edits: payload.edits,
    })
  }
  return NextResponse.json({ proposals })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (g.res) return g.res
  let body: { proposalId?: unknown; status?: unknown } | null
  try { body = await req.json() } catch { body = null }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  const { proposalId, status } = body
  if (typeof proposalId !== 'string' || (status !== 'resolved' && status !== 'dismissed')) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const row = await prisma.articleVersion.findFirst({
    where: { id: proposalId, articleId: params.id, changeNote: { startsWith: PROPOSAL_NOTE_PREFIX } },
    select: { id: true },
  })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.articleVersion.update({ where: { id: row.id }, data: { changeNote: proposalNote(status) } })
  return NextResponse.json({ ok: true })
}
