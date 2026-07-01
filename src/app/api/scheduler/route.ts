/**
 * GET /api/scheduler?projectId=xxx
 * Returns pending timeline entries whose date <= today and status === 'pending'
 * Used by client-side poller to know which articles to auto-write next.
 *
 * PATCH /api/scheduler
 * Body: { projectId, timeline, autoSchedule }
 * Saves timeline + autoSchedule flag back to project in DB.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/logActivity'

interface TimelineEntry {
  date: string        // YYYY-MM-DD
  keyword: string
  title: string
  articleStatus: string
  [key: string]: unknown
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: session.user.organizationId },
    select: { id: true, timeline: true, autoSchedule: true },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const today = new Date().toISOString().slice(0, 10)
  let timeline: TimelineEntry[] = []
  try { timeline = JSON.parse(project.timeline || '[]') } catch { timeline = [] }

  // Return entries due today or earlier that are still pending
  // keywordRows are NOT included here — use GET /api/projects/[id]/keywords-cache instead
  const due = timeline
    .map((e, idx) => ({ ...e, idx }))
    .filter(e => e.date <= today && e.articleStatus === 'pending')

  return NextResponse.json({ autoSchedule: project.autoSchedule, due, total: timeline.length })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { projectId, timeline, autoSchedule } = body
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const existing = await prisma.project.findFirst({
    where: { id: projectId, organizationId: session.user.organizationId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (timeline !== undefined) data.timeline = JSON.stringify(timeline)
  if (autoSchedule !== undefined) data.autoSchedule = autoSchedule
  // keywordRows must be saved via PATCH /api/projects/[id]/keywords-cache — not here

  await prisma.project.update({ where: { id: projectId }, data })

  // Log timeline generate/clear (skip routine autoSchedule-only saves)
  if (timeline !== undefined) {
    const tl = Array.isArray(timeline) ? timeline : []
    const action = tl.length === 0 ? 'CLEAR_TIMELINE' : 'GENERATE_TIMELINE'
    logActivity({ organizationId: session.user.organizationId, userId: session.user.id, action, entityType: 'Project', entityId: projectId, newValue: tl.length > 0 ? `${tl.length} entries` : undefined }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
