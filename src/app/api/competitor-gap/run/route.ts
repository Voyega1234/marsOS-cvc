/**
 * POST /api/competitor-gap/run — เดินงานสแกนคู่แข่งทีละเฟส
 * GET  /api/competitor-gap/run?runId=... — อ่านสถานะรอบที่กำลังทำงาน (ไม่เดินงาน ไม่มีค่าใช้จ่าย)
 *
 * ฝั่ง client เรียก POST ซ้ำจนกว่า status จะไม่ใช่ 'running' — หนึ่ง request = หนึ่งเฟส
 * ทำให้ไม่ชน maxDuration และมี checkpoint ทุกขั้น (งานที่จ่ายเงินไปแล้วไม่สูญ)
 *
 * หน้าเว็บจะไม่เรียก endpoint นี้เองตอนโหลด — ต้องกดปุ่มเท่านั้น (นโยบายคุมต้นทุน)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DEFAULT_COUNTRY, resolveCountry } from '@/lib/competitor-gap/locations'
import { advanceRun, createRun, type RunContext } from '@/lib/competitor-gap/runner'
import { loadRun, saveRun } from '@/lib/competitor-gap/store'
import type { AdvancedSettings, RunState } from '@/lib/competitor-gap/types'
import { toDomain, toOrigin } from '@/lib/competitor-gap/urls'

export const maxDuration = 300

const DEFAULT_ADVANCED: AdvancedSettings = {
  maxPagesPerDomain: 300,
  competitorCount: 5,
  includeKeywordGap: true,
  jsFallback: true,
}

/** ตอบกลับเฉพาะสถานะ — ไม่ส่งเนื้อหน้าเว็บทั้งหมดกลับไปให้เบราว์เซอร์ */
function toStatus(state: RunState) {
  return {
    runId: state.runId,
    status: state.status,
    phase: state.phase,
    steps: state.steps,
    costUsd: Number(state.costUsd.toFixed(6)),
    warnings: state.warnings,
    error: state.error,
    updatedAt: state.updatedAt,
  }
}

/**
 * คู่แข่งที่ผู้ใช้ระบุเอง — รับได้สูงสุด 5 เว็บ, ตัดค่าที่ไม่ใช่ URL ทิ้ง, กันซ้ำ
 * ไม่ตัดเว็บของเราออกตรงนี้ (runner กันซ้ำกับเว็บเราอีกชั้น)
 */
function sanitizeManualCompetitors(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,]/) : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const origin = toOrigin(String(item ?? '').trim())
    const domain = toDomain(origin)
    if (!origin || !domain || seen.has(domain)) continue
    seen.add(domain)
    out.push(origin)
    if (out.length >= 5) break
  }
  return out
}

function sanitizeAdvanced(raw: unknown): AdvancedSettings {
  const a = (raw ?? {}) as Partial<AdvancedSettings>
  return {
    maxPagesPerDomain: Math.max(50, Math.min(2000, Number(a.maxPagesPerDomain) || DEFAULT_ADVANCED.maxPagesPerDomain)),
    competitorCount: Math.max(3, Math.min(5, Number(a.competitorCount) || DEFAULT_ADVANCED.competitorCount)),
    includeKeywordGap: a.includeKeywordGap !== false,
    jsFallback: a.jsFallback !== false,
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const runId = new URL(req.url).searchParams.get('runId')
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 })

  const state = await loadRun(runId)
  if (!state) return NextResponse.json({ error: 'ไม่พบรอบสแกนนี้ (อาจหมดอายุแล้ว)' }, { status: 404 })
  const project = await prisma.project.findFirst({ where: { id: state.projectId, organizationId: orgId } })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  return NextResponse.json(toStatus(state))
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as {
    projectId?: string
    runId?: string
    keyword?: string
    country?: string
    ourWebsite?: string
    manualCompetitors?: unknown
    advanced?: unknown
  }

  // ── เดินงานรอบเดิมต่อ ──
  if (body.runId) {
    const state = await loadRun(body.runId)
    if (!state) return NextResponse.json({ error: 'ไม่พบรอบสแกนนี้ (อาจหมดอายุแล้ว)' }, { status: 404 })
    const project = await prisma.project.findFirst({ where: { id: state.projectId, organizationId: orgId } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const ctx: RunContext = { organizationId: orgId, userId: session.user.id, projectId: state.projectId }
    return NextResponse.json(toStatus(await advanceRun(state, ctx)))
  }

  // ── เริ่มรอบใหม่ ──
  const projectId = String(body.projectId ?? '')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const keyword = String(body.keyword ?? '').trim()
  if (!keyword) return NextResponse.json({ error: 'กรุณาระบุคีย์เวิร์ดเป้าหมาย' }, { status: 400 })

  const websiteInput = String(body.ourWebsite ?? project.website ?? '').trim()
  if (!websiteInput) return NextResponse.json({ error: 'โปรเจกต์นี้ยังไม่ได้ตั้งค่าเว็บไซต์' }, { status: 400 })
  let origin: string
  try {
    origin = toOrigin(websiteInput)
    if (!toDomain(origin)) throw new Error('bad host')
  } catch {
    return NextResponse.json({ error: 'รูปแบบเว็บไซต์ไม่ถูกต้อง' }, { status: 400 })
  }

  const country = resolveCountry(String(body.country ?? DEFAULT_COUNTRY))
  const runId = `cg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const state = createRun({
    projectId,
    ourWebsite: origin,
    keyword,
    country: country.key,
    manualCompetitors: sanitizeManualCompetitors(body.manualCompetitors),
    advanced: sanitizeAdvanced(body.advanced),
  }, runId)

  await saveRun(state)
  const ctx: RunContext = { organizationId: orgId, userId: session.user.id, projectId }
  return NextResponse.json(toStatus(await advanceRun(state, ctx)))
}
