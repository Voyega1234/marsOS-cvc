import { NextRequest, NextResponse } from 'next/server'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { refreshOpportunities } from '@/lib/brand-radar/queries'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  return NextResponse.json({ total: await refreshOpportunities(ctx) })
}
