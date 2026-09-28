import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { normalizeIntent, sanitizeSlugCandidate, uniqueSlug } from '@/lib/upload-article/keywords-ai'
import type { UploadKeyword, UploadKeywordIntent } from '@/lib/upload-article/types'

const KEYWORD_MAX = 200
const PLAN_MAX = 500

function readPlan(prefs: Record<string, unknown> | null): UploadKeyword[] {
  const raw = prefs?.keywordPlan
  return Array.isArray(raw) ? (raw as UploadKeyword[]) : []
}

/** GET /api/upload-article/clients/[id]/keywords */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prefs = await readPrefs(params.id, session.user.organizationId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  return NextResponse.json({ items: readPlan(prefs) })
}

/** POST /api/upload-article/clients/[id]/keywords — เพิ่มคำใหม่เข้าแผน (dedupe, ≤500 คำรวม) */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const rawItems = Array.isArray(body?.items) ? body.items : []
  if (rawItems.length === 0) return NextResponse.json({ error: 'ไม่พบรายการ keyword' }, { status: 400 })

  const candidates: { keyword: string; volume: number | null }[] = []
  for (const it of rawItems) {
    const keyword = typeof it?.keyword === 'string' ? it.keyword.trim().slice(0, KEYWORD_MAX) : ''
    if (!keyword) continue
    const volume = typeof it?.volume === 'number' && Number.isFinite(it.volume) ? it.volume : null
    candidates.push({ keyword, volume })
  }
  if (candidates.length === 0) return NextResponse.json({ error: 'keyword ทุกรายการว่าง' }, { status: 400 })

  const result = await updatePrefs<{ items: UploadKeyword[] } | { error: string }>(params.id, session.user.organizationId, (current) => {
    const plan = readPlan(current)
    const existingKeys = new Set(plan.map((k) => k.keyword.trim().toLowerCase()))
    const seenInBatch = new Set<string>()
    const now = new Date().toISOString()
    const toAdd: UploadKeyword[] = []
    for (const c of candidates) {
      const key = c.keyword.toLowerCase()
      if (existingKeys.has(key) || seenInBatch.has(key)) continue
      seenInBatch.add(key)
      toAdd.push({
        id: randomUUID(),
        keyword: c.keyword,
        volume: c.volume,
        title: '',
        slug: '',
        intent: '',
        articleType: '',
        createdAt: now,
      })
    }
    if (plan.length + toAdd.length > PLAN_MAX) {
      return { result: { error: `เกินเพดาน ${PLAN_MAX} คำ (มีอยู่ ${plan.length} คำ เพิ่มได้อีก ${Math.max(0, PLAN_MAX - plan.length)} คำ)` } }
    }
    const nextPlan = [...plan, ...toAdd]
    return { prefs: { ...current, keywordPlan: nextPlan }, result: { items: nextPlan } }
  })

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if ('error' in result.result) return NextResponse.json({ error: result.result.error }, { status: 400 })
  return NextResponse.json(result.result)
}

/** PATCH /api/upload-article/clients/[id]/keywords — แก้ไข keyword รายตัว */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  const patch = body?.patch && typeof body.patch === 'object' ? (body.patch as Record<string, unknown>) : null
  if (!id || !patch) return NextResponse.json({ error: 'ต้องระบุ id และ patch' }, { status: 400 })

  const result = await updatePrefs<{ item: UploadKeyword } | { error: 'not_found' }>(params.id, session.user.organizationId, (current) => {
    const plan = readPlan(current)
    const idx = plan.findIndex((k) => k.id === id)
    if (idx === -1) return { result: { error: 'not_found' as const } }

    const item = { ...plan[idx] }
    if (typeof patch.keyword === 'string') item.keyword = patch.keyword.trim().slice(0, KEYWORD_MAX)
    if (typeof patch.title === 'string') item.title = patch.title.trim().slice(0, 200)
    if (typeof patch.note === 'string') item.note = patch.note.trim().slice(0, 2000)
    if (typeof patch.articleType === 'string') item.articleType = patch.articleType.trim().slice(0, 100)
    if (patch.volume === null) item.volume = null
    else if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) item.volume = patch.volume
    if (patch.intent !== undefined) {
      if (patch.intent === '') item.intent = ''
      else item.intent = normalizeIntent(patch.intent) as UploadKeywordIntent | ''
    }
    if (typeof patch.slug === 'string') {
      const base = sanitizeSlugCandidate(patch.slug)
      const taken = new Set(plan.filter((k) => k.id !== id).map((k) => k.slug).filter(Boolean))
      item.slug = base ? uniqueSlug(base, taken) : ''
    }

    const nextPlan = [...plan]
    nextPlan[idx] = item
    return { prefs: { ...current, keywordPlan: nextPlan }, result: { item } }
  })

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if ('error' in result.result) return NextResponse.json({ error: 'ไม่พบ keyword นี้' }, { status: 404 })
  return NextResponse.json(result.result)
}

/** DELETE /api/upload-article/clients/[id]/keywords — ลบ keyword หลายรายการ */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'ต้องระบุ ids' }, { status: 400 })

  const idSet = new Set(ids)
  const result = await updatePrefs(params.id, session.user.organizationId, (current) => {
    const plan = readPlan(current)
    const nextPlan = plan.filter((k) => !idSet.has(k.id))
    return { prefs: { ...current, keywordPlan: nextPlan }, result: { items: nextPlan } }
  })

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
