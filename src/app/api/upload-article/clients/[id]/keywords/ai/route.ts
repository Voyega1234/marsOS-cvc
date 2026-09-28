import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { generateKeywordPlan, sanitizeSlugCandidate, uniqueSlug, type KeywordAiInput } from '@/lib/upload-article/keywords-ai'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { OR_MODELS } from '@/lib/openrouter'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import type { UploadKeyword } from '@/lib/upload-article/types'
import { resolveContentEngine } from '@/lib/content-engine-resolve'

export const maxDuration = 300

const MAX_IDS = 40

function readPlan(prefs: Record<string, unknown> | null): UploadKeyword[] {
  const raw = prefs?.keywordPlan
  return Array.isArray(raw) ? (raw as UploadKeyword[]) : []
}

/** POST /api/upload-article/clients/[id]/keywords/ai — ให้ AI ตั้ง title/slug/intent/articleType ให้ keyword ที่เลือก
 *  mode "rewrite" (ค่าเริ่มต้น) = เขียนใหม่ทับของเดิมทั้งหมด (keyword ที่ทีมติ๊กเลือก)
 *  mode "fill" = เติมเฉพาะช่องที่ยังว่าง — title ที่มีอยู่แล้ว (เช่นมากับไฟล์) ไม่โดนแตะ */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'ต้องระบุ ids' }, { status: 400 })
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `เลือกได้ไม่เกิน ${MAX_IDS} คำต่อครั้ง` }, { status: 400 })

  const prefs = await readPrefs(client.id, orgId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  const plan = readPlan(prefs)
  const idSet = new Set(ids)
  const fill = body?.mode === 'fill'
  const inputs: KeywordAiInput[] = plan
    .filter((k) => idSet.has(k.id))
    .map((k) => ({ id: k.id, keyword: k.keyword, volume: k.volume, ...(fill && k.title ? { fixedTitle: k.title } : {}) }))
  if (inputs.length === 0) return NextResponse.json({ error: 'ไม่พบ keyword ที่เลือก' }, { status: 404 })

  const language = client.language === 'en' || client.language === 'both' ? client.language : 'th'
  // Business Skill ของลูกค้านี้ (ถ้าตั้งไว้) ให้ตั้งชื่อตรงกับธุรกิจ — ไม่มีก็ไม่ส่ง ห้ามเดา
  const ce = await resolveContentEngine(orgId, { projectId: client.id })
  const businessSkill = ce.businessSkill?.text?.trim() || undefined
  const clientSlug = `upload-${slugifyClient(client.name)}`
  const aiResult = await withOrClient(clientSlug, () =>
    generateKeywordPlan({ items: inputs, clientName: client.name, website: client.website, language, businessSkill }),
  )

  logAIJob({
    organizationId: orgId,
    projectId: null,
    inputSummary: uaJobInput(client.id),
    jobType: 'UPLOAD_ARTICLE_KEYWORDS_AI',
    modelProvider: 'OPENROUTER',
    modelName: OR_MODELS.keyword(),
    status: aiResult.errors.length ? 'FAILED' : 'SUCCESS',
    tokenUsed: aiResult.usage.totalTokens,
    estimatedCost: aiResult.usage.costUsd,
    errorMessage: aiResult.errors.join('; ').slice(0, 500) || undefined,
    createdById: session.user.id,
  }).catch(() => {})

  const aiById = new Map(aiResult.items.map((it) => [it.id, it]))

  const result = await updatePrefs(client.id, orgId, (current) => {
    const currentPlan = readPlan(current)
    const takenSlugs = new Set(currentPlan.map((k) => k.slug).filter(Boolean))
    const nextPlan = currentPlan.map((k) => {
      const ai = aiById.get(k.id)
      if (!ai) return k
      const next = { ...k }
      if (ai.title && !(fill && k.title)) next.title = ai.title
      if (ai.intent && !(fill && k.intent)) next.intent = ai.intent
      if (ai.articleType && !(fill && k.articleType)) next.articleType = ai.articleType
      if (ai.slug && !(fill && k.slug)) {
        takenSlugs.delete(k.slug) // ไม่ชนกับ slug เดิมของตัวเอง
        const base = sanitizeSlugCandidate(ai.slug)
        const slug = base ? uniqueSlug(base, takenSlugs) : k.slug
        next.slug = slug
        takenSlugs.add(slug)
      }
      return next
    })
    return { prefs: { ...current, keywordPlan: nextPlan }, result: { items: nextPlan } }
  })

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
