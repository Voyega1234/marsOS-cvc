/** Brand Radar — server helpers shared by every route (auth, project ownership, JSON columns) */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface StaffCtx { orgId: string; userId: string; role: string }

/** No organization → 401. Role CLIENT → 403. Brand Radar is staff-only. */
export async function requireStaff(): Promise<StaffCtx | NextResponse> {
  const session = await getSession()
  const u = session?.user
  if (!u?.organizationId || !u.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (u.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { orgId: u.organizationId, userId: u.id, role: String(u.role) }
}

export function isCtx(x: StaffCtx | NextResponse): x is StaffCtx {
  return !(x instanceof NextResponse)
}

export interface ProjectRef { id: string; name: string; clientName: string; website: string; industry: string; language: string }

/**
 * The project must belong to the caller's organization.
 * Returns null for a missing id, an unknown id and another organization's id alike,
 * so a caller can never learn that a foreign project exists.
 */
export async function loadOwnedProject(orgId: string, projectId: unknown): Promise<ProjectRef | null> {
  if (typeof projectId !== 'string' || !projectId) return null
  const p = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true, name: true, clientName: true, website: true, industry: true, language: true },
  })
  if (!p) return null
  return {
    id: p.id,
    name: p.name,
    clientName: p.clientName ?? '',
    website: p.website ?? '',
    industry: p.industry ?? '',
    language: p.language ?? 'th',
  }
}

export interface RadarCtx extends StaffCtx { project: ProjectRef }

/**
 * Staff + project ownership in one call. Use at the top of every route:
 *   const ctx = await requireProject(projectId); if (!isRadarCtx(ctx)) return ctx
 * Every query after that MUST filter by both ctx.orgId and ctx.project.id.
 */
export async function requireProject(projectId: unknown): Promise<RadarCtx | NextResponse> {
  const staff = await requireStaff()
  if (!isCtx(staff)) return staff
  const project = await loadOwnedProject(staff.orgId, projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  return { ...staff, project }
}

export function isRadarCtx(x: RadarCtx | NextResponse): x is RadarCtx {
  return !(x instanceof NextResponse)
}

export function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status })
}

export function parseStrings(s: string | null | undefined): string[] {
  try {
    const v = JSON.parse(s || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function parseObject(s: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Trimmed, de-duplicated (case-insensitive), capped list of short strings from unknown input */
export function cleanStrings(v: unknown, max: number, maxLen = 200): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (typeof x !== 'string') continue
    const t = x.trim().slice(0, maxLen)
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

export async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)))
  if (!uniq.length) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } })
  return new Map(users.map((u) => [u.id, u.name || u.email || u.id]))
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
