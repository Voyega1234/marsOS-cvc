import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { usage } from '@/lib/brand-radar/runner'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireProject(req.nextUrl.searchParams.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  try {
    return NextResponse.json(await usage(ctx))
  } catch (e) {
    console.error('[brand-radar usage]', errMsg(e))
    return bad('Could not load usage', 500)
  }
}
