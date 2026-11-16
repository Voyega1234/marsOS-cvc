import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { bad, isRadarCtx, requireProject } from '@/lib/brand-radar/server'
import { toCompetitorDTO, toProfileDTO } from '@/lib/brand-radar/queries'
import { DEFAULT_PROVIDERS, cleanProfileInput } from '@/lib/brand-radar/profile-input'
import { nextRunAfter } from '@/lib/brand-radar/schedule'
import type { ProfileRes, Schedule } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireProject(req.nextUrl.searchParams.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const [profile, competitors] = await Promise.all([
    prisma.brandRadarProfile.findFirst({ where }),
    prisma.brandRadarCompetitor.findMany({ where, orderBy: { createdAt: 'asc' } }),
  ])
  const res: ProfileRes = {
    profile: profile ? toProfileDTO(profile) : null,
    competitors: competitors.map(toCompetitorDTO),
    project: ctx.project,
  }
  return NextResponse.json(res)
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx

  const clean = cleanProfileInput(body)
  if (!clean.ok) return bad(clean.error)
  const d = clean.data
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const existing = await prisma.brandRadarProfile.findFirst({ where })
  const now = new Date()

  // The primary domain always counts as an owned domain.
  const primary = d.primaryDomain ?? existing?.primaryDomain ?? ''
  const owned = d.ownedDomains
  if (owned && primary && !owned.includes(primary)) owned.unshift(primary)

  // providerStatus is never written here: connectivity test results belong to the providers routes.
  const data = {
    ...(d.brandName !== undefined ? { brandName: d.brandName } : {}),
    ...(d.aliases ? { aliases: JSON.stringify(d.aliases) } : {}),
    ...(d.ambiguousAliases ? { ambiguousAliases: JSON.stringify(d.ambiguousAliases) } : {}),
    ...(d.contextTerms ? { contextTerms: JSON.stringify(d.contextTerms) } : {}),
    ...(d.primaryDomain !== undefined ? { primaryDomain: d.primaryDomain } : {}),
    ...(owned ? { ownedDomains: JSON.stringify(owned) } : {}),
    ...(d.country ? { country: d.country } : {}),
    ...(d.language ? { language: d.language } : {}),
    ...(d.industry !== undefined ? { industry: d.industry } : {}),
    ...(d.products ? { products: JSON.stringify(d.products) } : {}),
    ...(d.providers ? { providers: JSON.stringify(d.providers) } : {}),
    ...(d.promptSources ? { promptSources: JSON.stringify(d.promptSources) } : {}),
    ...(d.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: d.monthlyBudgetUsd } : {}),
    ...(d.maxPromptsPerRun !== undefined ? { maxPromptsPerRun: d.maxPromptsPerRun } : {}),
    ...(d.samplesPerPrompt !== undefined ? { samplesPerPrompt: d.samplesPerPrompt } : {}),
    updatedById: ctx.userId,
  }

  if (!existing) {
    if (!d.brandName) return bad('Brand name is required')
    if (!d.primaryDomain) return bad('Primary domain is required')
    const schedule: Schedule = d.schedule ?? 'weekly'
    const ownedList = owned ?? [d.primaryDomain]
    const created = await prisma.brandRadarProfile.create({
      data: {
        organizationId: ctx.orgId,
        projectId: ctx.project.id,
        brandName: d.brandName,
        primaryDomain: d.primaryDomain,
        country: 'TH',
        providers: JSON.stringify(DEFAULT_PROVIDERS),
        promptSources: JSON.stringify(['manual']),
        maxPromptsPerRun: 50,
        ...data,
        ownedDomains: JSON.stringify(ownedList),
        schedule,
        nextRunAt: nextRunAfter(schedule, now),
        createdById: ctx.userId,
      },
    })
    return NextResponse.json({ profile: toProfileDTO(created) })
  }

  const scheduleChanged = d.schedule !== undefined && d.schedule !== existing.schedule
  const updated = await prisma.brandRadarProfile.update({
    where: { id: existing.id },
    data: {
      ...data,
      ...(d.schedule !== undefined ? { schedule: d.schedule } : {}),
      ...(scheduleChanged ? { nextRunAt: nextRunAfter(d.schedule as Schedule, now) } : {}),
    },
  })
  return NextResponse.json({ profile: toProfileDTO(updated) })
}
