/**
 * GET /api/seo-lab/cost
 * Returns: DFS cost summary for SEO Lab jobs (this session / all time)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = session.user.organizationId

  const jobs = await prisma.aIJob.findMany({
    where: {
      organizationId: orgId,
      jobType:        { startsWith: 'SEO_LAB_' },
      externalApi:    'DataForSEO',
    },
    select: {
      jobType:       true,
      externalCost:  true,
      externalCalls: true,
      status:        true,
      createdAt:     true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const totalCost  = jobs.reduce((s, j) => s + (j.externalCost ?? 0), 0)
  const totalCalls = jobs.reduce((s, j) => s + (j.externalCalls ?? 0), 0)

  const byType = jobs.reduce<Record<string, { cost: number; calls: number; count: number }>>((acc, j) => {
    const t = j.jobType
    if (!acc[t]) acc[t] = { cost: 0, calls: 0, count: 0 }
    acc[t].cost  += j.externalCost  ?? 0
    acc[t].calls += j.externalCalls ?? 0
    acc[t].count += 1
    return acc
  }, {})

  const today = new Date().toISOString().slice(0, 10)
  const todayCost = jobs
    .filter(j => j.createdAt.toISOString().slice(0, 10) === today)
    .reduce((s, j) => s + (j.externalCost ?? 0), 0)

  return NextResponse.json({
    totalCost:   Math.round(totalCost  * 10000) / 10000,
    totalCalls,
    todayCost:   Math.round(todayCost  * 10000) / 10000,
    byType,
    recentJobs:  jobs.slice(0, 10),
  })
}
