import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { providerStatuses } from '@/lib/brand-radar/providers'
import { UNSUPPORTED_PLATFORMS, isProviderKey, type ProviderKey, type ProvidersRes } from '@/lib/brand-radar/types'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireProject(req.nextUrl.searchParams.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  try {
    const profile = await prisma.brandRadarProfile.findFirst({
      where: { organizationId: ctx.orgId, projectId: ctx.project.id },
      select: { providers: true, providerStatus: true },
    })
    let enabled: ProviderKey[] = []
    try {
      const v = JSON.parse(profile?.providers || '[]')
      enabled = Array.isArray(v) ? v.filter(isProviderKey) : []
    } catch { /* keep empty */ }
    const res: ProvidersRes = {
      providers: providerStatuses(profile?.providerStatus, enabled),
      unsupported: UNSUPPORTED_PLATFORMS.map((u) => ({ label: u.label, reason: u.reason })),
    }
    return NextResponse.json(res)
  } catch (e) {
    console.error('[brand-radar providers]', errMsg(e))
    return bad('Could not load providers', 500)
  }
}
