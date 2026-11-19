import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { getSiteReadiness } from '@/lib/brand-radar/site-readiness-fetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Staff only. The domain is read from the stored profile; the request cannot set it or force a refresh.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  try {
    const profile = await prisma.brandRadarProfile.findFirst({
      where: { organizationId: ctx.orgId, projectId: ctx.project.id },
      select: { primaryDomain: true },
    })
    return NextResponse.json(await getSiteReadiness(ctx.project.id, profile?.primaryDomain))
  } catch (e) {
    console.error('[brand-radar site-readiness]', errMsg(e))
    return bad('Site check failed', 500)
  }
}
