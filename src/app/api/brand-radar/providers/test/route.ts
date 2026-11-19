import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, parseObject, requireProject } from '@/lib/brand-radar/server'
import { hasCredentials, statusEntry, storedStatusFor, testProvider } from '@/lib/brand-radar/providers'
import { isProviderKey } from '@/lib/brand-radar/types'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; provider?: unknown }
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  if (!isProviderKey(body.provider)) return bad('Unknown provider')
  const key = body.provider
  try {
    const profile = await prisma.brandRadarProfile.findFirst({ where: { organizationId: ctx.orgId, projectId: ctx.project.id } })
    if (!profile) return bad('Set up Brand Radar for this client first')
    if (!hasCredentials(key)) {
      return NextResponse.json({ provider: statusEntry(key, undefined, false) })
    }
    const outcome = await testProvider(key, {
      orgId: ctx.orgId, userId: ctx.userId, projectId: ctx.project.id,
      country: profile.country, language: profile.language, clientName: ctx.project.clientName || ctx.project.name,
    })
    // re-read right before writing so a concurrent test of another provider is not overwritten
    const fresh = await prisma.brandRadarProfile.findFirst({ where: { id: profile.id, organizationId: ctx.orgId }, select: { providerStatus: true, providers: true } })
    const status = parseObject(fresh?.providerStatus)
    status[key] = storedStatusFor(outcome)
    await prisma.brandRadarProfile.updateMany({ where: { id: profile.id, organizationId: ctx.orgId }, data: { providerStatus: JSON.stringify(status) } })
    let enabled = false
    try { enabled = (JSON.parse(fresh?.providers || '[]') as string[]).includes(key) } catch { /* not enabled */ }
    return NextResponse.json({ provider: statusEntry(key, storedStatusFor(outcome), enabled) })
  } catch (e) {
    console.error('[brand-radar provider test]', errMsg(e))
    return bad('Provider test failed', 500)
  }
}
