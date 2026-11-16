import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { GENERATE_SOURCES, generateCandidates } from '@/lib/brand-radar/prompt-sources'
import type { PromptSource } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Returns candidates only. Nothing is saved. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const source = body.source
  if (typeof source !== 'string' || !(GENERATE_SOURCES as readonly string[]).includes(source)) return bad('Unsupported source')
  try {
    const res = await generateCandidates(
      ctx, source as PromptSource,
      typeof body.count === 'number' ? body.count : undefined,
      typeof body.seed === 'string' ? body.seed : undefined,
    )
    return NextResponse.json(res)
  } catch (e) {
    return bad(errMsg(e), 502)
  }
}
