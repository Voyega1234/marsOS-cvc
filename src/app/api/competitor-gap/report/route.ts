/**
 * GET /api/competitor-gap/report?projectId=... — อ่านรายงานล่าสุดที่เคยสแกนไว้
 * อ่านจากแคชอย่างเดียว ไม่ยิง API ที่มีค่าใช้จ่ายใด ๆ
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { latestRunId, loadReport, loadSnapshots } from '@/lib/competitor-gap/store'

export async function GET(req: NextRequest) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const report = await loadReport(projectId)
  return NextResponse.json({
    report,
    history: await loadSnapshots(projectId),
    lastRunId: await latestRunId(projectId),
    projectWebsite: project.website ?? null,
  })
}
