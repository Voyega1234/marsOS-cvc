import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { buildPromptList, parseFilters } from '@/lib/brand-radar/queries'
import { cleanPromptInput, pickCountry, pickLanguage, type CleanPrompt } from '@/lib/brand-radar/prompt-input'
import { LIMITS, type PromptSaveRes } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

const MAX_BATCH = 500

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const res = await buildPromptList(ctx, parseFilters(sp), {
    status: sp.get('status') ?? undefined, // missing = all statuses
    source: sp.get('source') ?? undefined,
    intent: sp.get('intent') ?? undefined,
    topic: sp.get('topic') ?? undefined,
    q: sp.get('q') ?? undefined,
    sort: sp.get('sort') ?? undefined,
    page: Number(sp.get('page')) || 1,
    pageSize: Number(sp.get('pageSize')) || 25,
  })
  return NextResponse.json(res)
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  if (!Array.isArray(body.prompts) || body.prompts.length === 0) return bad('No prompts to save')
  if (body.prompts.length > MAX_BATCH) return bad(`Save at most ${MAX_BATCH} prompts at a time`)

  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const [profile, existing] = await Promise.all([
    prisma.brandRadarProfile.findFirst({ where, select: { country: true, language: true } }),
    prisma.brandRadarPrompt.findMany({ where, select: { textKey: true } }),
  ])
  // project.language can be 'both' and profile values may be stale: only supported codes become defaults
  const defaults = {
    country: pickCountry(profile?.country) ?? 'TH',
    language: pickLanguage(profile?.language) ?? pickLanguage(ctx.project.language) ?? 'th',
  }
  const keys = new Set(existing.map((e) => e.textKey))
  let room = LIMITS.promptsPerProjectMax - existing.length

  const skipped: PromptSaveRes['skipped'] = []
  const toCreate: CleanPrompt[] = []
  for (const raw of body.prompts) {
    const c = cleanPromptInput(raw, defaults)
    if (!c.ok) { skipped.push({ text: c.text, reason: c.reason }); continue }
    const v = c.value
    if (keys.has(v.textKey)) { skipped.push({ text: v.text, reason: 'This prompt already exists' }); continue }
    if (room <= 0) { skipped.push({ text: v.text, reason: `Limit of ${LIMITS.promptsPerProjectMax} prompts per client reached` }); continue }
    keys.add(v.textKey)
    room--
    toCreate.push(v)
  }
  let created = 0
  if (toCreate.length > 0) {
    const r = await prisma.brandRadarPrompt.createMany({
      data: toCreate.map((v) => ({ ...where, ...v, createdById: ctx.userId })),
      skipDuplicates: true,
    })
    created = r.count
    for (let i = created; i < toCreate.length; i++) skipped.push({ text: toCreate[i].text, reason: 'This prompt already exists' })
  }
  return NextResponse.json({ created, skipped } satisfies PromptSaveRes)
}
