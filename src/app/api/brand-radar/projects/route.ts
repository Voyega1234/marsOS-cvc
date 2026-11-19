import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isCtx, isRadarCtx, requireProject, requireReader, requireStaff } from '@/lib/brand-radar/server'
import { deleteRadarProject } from '@/lib/brand-radar/delete-project'
import { buildProjectOptions, buildProjectOptionsFor } from '@/lib/brand-radar/queries'
import { DEFAULT_PROVIDERS, cleanCompetitorInput, cleanProfileInput } from '@/lib/brand-radar/profile-input'
import { nameKey } from '@/lib/brand-radar/normalize'
import { nextRunAfter } from '@/lib/brand-radar/schedule'
import { LIMITS, MANUAL_PROJECT_PREFIX, isManualProjectId, type CreateProjectRes, type ProjectsRes, type Schedule } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireReader()
  if (ctx instanceof NextResponse) return ctx
  const projects = await buildProjectOptionsFor(ctx.orgId, ctx.allowedIds, ctx.clientView)
  return NextResponse.json({ projects } satisfies ProjectsRes)
}

const sameName = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Create a project that exists only inside Brand Radar (owner request, 2026-11-18): a brand that is not a client
 * in the rest of MarsOS. No Project row is written. The project is a BrandRadarProfile whose projectId is generated
 * here with MANUAL_PROJECT_PREFIX, so every other route finds it through loadOwnedProject like any other project.
 * Optional in the same call: the AI platforms to track (default: all) and the competitors to monitor next to the brand.
 */
export async function POST(req: NextRequest) {
  const staff = await requireStaff()
  if (!isCtx(staff)) return staff
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')

  const clean = cleanProfileInput({
    brandName: body.name,
    primaryDomain: body.website,
    // Other names and spellings of the brand; an answer that uses any of them counts as a mention.
    ...(Array.isArray(body.aliases) ? { aliases: body.aliases } : {}),
    ...(Array.isArray(body.providers) ? { providers: body.providers } : {}),
  })
  if (!clean.ok) return bad(clean.error)
  const { brandName, primaryDomain } = clean.data
  if (!brandName) return bad('Brand name is required')
  if (!primaryDomain) return bad('Primary domain is required')
  // No platform ticked (or none sent) = track every platform, the same default as before.
  const providers = clean.data.providers && clean.data.providers.length > 0 ? clean.data.providers : DEFAULT_PROVIDERS

  // Competitors typed in the dialog. Blank rows, repeats and the brand itself are skipped, not rejected.
  const competitors: Array<{ name: string; nameKey: string; domains: string[] }> = []
  const rawCompetitors: unknown[] = Array.isArray(body.competitors) ? body.competitors.slice(0, LIMITS.competitorsMax * 2) : []
  for (const raw of rawCompetitors) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.name !== 'string' || !r.name.trim()) continue
    const domain = typeof r.domain === 'string' ? r.domain.trim() : ''
    const c = cleanCompetitorInput({ name: r.name, domains: domain ? [domain] : [] })
    if (!c.ok) return bad(c.error)
    const name = c.data.name ?? ''
    const key = nameKey(name)
    if (!name || !key || key === nameKey(brandName) || competitors.some((x) => x.nameKey === key)) continue
    competitors.push({ name, nameKey: key, domains: c.data.domains ?? [] })
    if (competitors.length >= LIMITS.competitorsMax) break
  }

  // One name, one project: a second "Acme" in the picker could not be told apart from the first.
  const existing = await buildProjectOptions(staff.orgId)
  if (existing.some((p) => sameName(p.name, brandName) || sameName(p.clientName, brandName))) {
    return bad('มีโปรเจกต์ชื่อนี้อยู่แล้ว เลือกจากรายการได้เลย', 409)
  }

  const schedule: Schedule = 'weekly'
  const id = MANUAL_PROJECT_PREFIX + randomBytes(12).toString('hex')
  const createProfile = prisma.brandRadarProfile.create({
    data: {
      organizationId: staff.orgId,
      projectId: id,
      brandName,
      primaryDomain,
      aliases: JSON.stringify((clean.data.aliases ?? []).filter((a) => nameKey(a) !== nameKey(brandName))),
      country: 'TH',
      providers: JSON.stringify(providers),
      promptSources: JSON.stringify(['manual']),
      maxPromptsPerRun: 50,
      ownedDomains: JSON.stringify([primaryDomain]),
      schedule,
      nextRunAt: nextRunAfter(schedule, new Date()),
      createdById: staff.userId,
      updatedById: staff.userId,
    },
  })
  const createCompetitors = prisma.brandRadarCompetitor.createMany({
    data: competitors.map((c) => ({
      organizationId: staff.orgId, projectId: id, name: c.name, nameKey: c.nameKey,
      aliases: '[]', domains: JSON.stringify(c.domains), status: 'ACTIVE', createdById: staff.userId,
    })),
  })
  // One transaction: a project never appears without the competitors that were typed with it.
  await prisma.$transaction([createProfile, createCompetitors])

  const project = (await buildProjectOptions(staff.orgId)).find((p) => p.id === id)
  if (!project) return bad('สร้างโปรเจกต์ไม่สำเร็จ', 500)
  return NextResponse.json({ project } satisfies CreateProjectRes)
}

/**
 * Delete a project from Brand Radar (owner request, 2026-11-19): its settings, competitors, prompts, every scan and
 * every stored AI answer. Staff only, and only a project of the caller's own organization (requireProject).
 * The MarsOS Project row, other modules' data and the AI cost history are never touched: see delete-project.ts.
 * Refused with 409 while AI calls for the project are still in flight.
 */
export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const ctx = await requireProject(sp.get('project') || sp.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const result = await deleteRadarProject(ctx.orgId, ctx.project.id)
  if (result.kind === 'busy') {
    return bad('ระบบกำลังถาม AI ของโปรเจกต์นี้อยู่ กดยกเลิกการสแกนแล้วรอสักครู่ (ไม่เกิน 5 นาที) จึงลบได้', 409)
  }
  return NextResponse.json({ ok: true, manual: isManualProjectId(ctx.project.id), deleted: result.counts })
}
