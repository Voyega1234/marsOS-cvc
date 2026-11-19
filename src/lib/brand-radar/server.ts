/** Brand Radar — server helpers shared by every route (auth, project ownership, JSON columns) */
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isManualProjectId } from './types'

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
  // A project created inside Brand Radar has no Project row: its profile is the project. Same organization check.
  if (isManualProjectId(projectId)) {
    const m = await prisma.brandRadarProfile.findFirst({
      where: { projectId, organizationId: orgId },
      select: { projectId: true, brandName: true, primaryDomain: true, industry: true, language: true },
    })
    if (!m) return null
    return {
      id: m.projectId,
      name: m.brandName,
      clientName: m.brandName,
      website: m.primaryDomain,
      industry: m.industry ?? '',
      language: m.language ?? 'th',
    }
  }
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

export interface RadarCtx extends StaffCtx {
  project: ProjectRef
  /**
   * true = the caller is a CLIENT login reading its own report (requireProjectReader only).
   * The query layer then leaves out everything that is for staff: cost, errors, internal notes, backlink vendor data.
   */
  clientView?: boolean
}

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

// ── Client logins (read-only report) ─────────────────────────────────────────

/** A table or column that does not exist yet (its SQL file has not been run on this database) */
export function isMissingTable(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2021' || e.code === 'P2022')
}

/** Of the given ids, the ones that are projects of this organization (regular or created inside Brand Radar). Order kept. */
export async function ownedProjectIds(orgId: string, ids: unknown[]): Promise<string[]> {
  const uniq = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
  if (!orgId || uniq.length === 0) return []
  const manual = uniq.filter((id) => isManualProjectId(id))
  const regular = uniq.filter((id) => !isManualProjectId(id))
  const [m, p] = await Promise.all([
    manual.length
      ? prisma.brandRadarProfile.findMany({ where: { organizationId: orgId, projectId: { in: manual } }, select: { projectId: true } })
      : Promise.resolve([] as { projectId: string }[]),
    regular.length
      ? prisma.project.findMany({ where: { organizationId: orgId, id: { in: regular } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ])
  const ok = new Set<string>([...m.map((x) => x.projectId), ...p.map((x) => x.id)])
  return uniq.filter((id) => ok.has(id))
}

/**
 * Of the given ids, the ones that are projects of this organization AND have a Brand Radar profile. Order kept.
 * Used when an admin assigns Brand Radar projects to a customer login: only a project with a report can be assigned.
 */
export async function profiledProjectIds(orgId: string, ids: unknown[]): Promise<string[]> {
  const owned = await ownedProjectIds(orgId, ids)
  if (owned.length === 0) return []
  const rows = await prisma.brandRadarProfile.findMany({
    where: { organizationId: orgId, projectId: { in: owned } },
    select: { projectId: true },
  })
  const ok = new Set(rows.map((r) => r.projectId))
  return owned.filter((id) => ok.has(id))
}

/**
 * The Brand Radar projects a CLIENT login may read: its access rows in its own organization, minus rows whose
 * project no longer exists there. This is the single predicate for "may this client see Brand Radar": the API
 * gate, the /brand-radar page and the /projects landing page all use it, so they can never disagree.
 * A missing table means no access. Any other error is thrown: no error path answers "allowed".
 */
export async function clientRadarProjectIds(userId: string, orgId: string): Promise<string[]> {
  if (!userId || !orgId) return []
  let rows: { projectId: string }[]
  try {
    rows = await prisma.brandRadarClientAccess.findMany({
      where: { userId, organizationId: orgId },
      select: { projectId: true },
      orderBy: { createdAt: 'asc' },
    })
  } catch (e) {
    if (isMissingTable(e)) return []
    throw e
  }
  return ownedProjectIds(orgId, rows.map((r) => r.projectId))
}

export interface ReaderCtx extends StaffCtx {
  clientView: boolean
  /** CLIENT only: the project ids this login may read. null = staff, every project of the organization. */
  allowedIds: string[] | null
}

/**
 * For the read-only report endpoints ONLY. Staff pass as with requireStaff. A CLIENT login passes when it has
 * at least one Brand Radar project; everything it then reads must be limited to allowedIds.
 * Every endpoint that writes, runs a scan, or shows settings keeps requireStaff / requireProject.
 */
export async function requireReader(): Promise<ReaderCtx | NextResponse> {
  const session = await getSession()
  const u = session?.user
  if (!u?.organizationId || !u.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const base: StaffCtx = { orgId: u.organizationId, userId: u.id, role: String(u.role) }
  if (u.role !== 'CLIENT') return { ...base, clientView: false, allowedIds: null }
  const allowedIds = await clientRadarProjectIds(u.id, u.organizationId)
  if (allowedIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { ...base, clientView: true, allowedIds }
}

/**
 * requireProject for the read-only report endpoints ONLY: a CLIENT login is let in for a project it was given.
 * A project the client was not given answers 404, the same as an unknown id, so it cannot learn the project exists.
 */
export async function requireProjectReader(projectId: unknown): Promise<RadarCtx | NextResponse> {
  const session = await getSession()
  const u = session?.user
  if (!u?.organizationId || !u.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const base: StaffCtx = { orgId: u.organizationId, userId: u.id, role: String(u.role) }
  const notFound = () => NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (u.role !== 'CLIENT') {
    const project = await loadOwnedProject(base.orgId, projectId)
    if (!project) return notFound()
    return { ...base, project, clientView: false }
  }
  // CLIENT: the project row loads while the access rows are read, to save a round trip. The result is only
  // looked at after the access check passed, so the answers and their order are the same as checking first.
  const projectP: Promise<{ ok: true; value: ProjectRef | null } | { ok: false; error: unknown }> = loadOwnedProject(base.orgId, projectId)
    .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
  const allowedIds = await clientRadarProjectIds(base.userId, base.orgId)
  if (allowedIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (typeof projectId !== 'string' || !allowedIds.includes(projectId)) return notFound()
  const loaded = await projectP
  if (!loaded.ok) throw loaded.error
  if (!loaded.value) return notFound()
  return { ...base, project: loaded.value, clientView: true }
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
