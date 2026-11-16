import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { cleanPromptInput } from '@/lib/brand-radar/prompt-input'
import { markDuplicates } from '@/lib/brand-radar/prompts'
import type { PromptCandidate } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

/** Dry run: classify and flag duplicates. Nothing is saved. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  if (!Array.isArray(body.prompts)) return bad('No prompts to check')
  if (body.prompts.length > 2000) return bad('Check at most 2000 prompts at a time')

  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const [profile, existing] = await Promise.all([
    prisma.brandRadarProfile.findFirst({ where, select: { country: true, language: true } }),
    prisma.brandRadarPrompt.findMany({ where, select: { text: true } }),
  ])
  const defaults = { country: profile?.country ?? 'TH', language: profile?.language ?? ctx.project.language ?? 'th' }
  const cands: PromptCandidate[] = []
  for (const raw of body.prompts) {
    const c = cleanPromptInput({ source: 'imported', ...(raw && typeof raw === 'object' ? raw : {}) }, defaults)
    if (!c.ok) continue
    const { textKey: _k, ...rest } = c.value
    void _k
    cands.push(rest)
  }
  return NextResponse.json({ candidates: markDuplicates(cands, existing.map((e) => e.text)) })
}
