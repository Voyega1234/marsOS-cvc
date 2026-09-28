import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveContentEngine, type ResolvedLayer } from '@/lib/content-engine-resolve'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { pickLinksForKeyword } from '@/lib/upload-article/internal-links'
import {
  buildWriterSystemPrompt,
  buildWriterUserPrompt,
  isWritingStale,
  missingWriterLayers,
  parseWriterOutput,
  MIN_CLEANED_HTML_LENGTH,
} from '@/lib/upload-article/writer'
import { cleanSemanticHtml } from '@/lib/upload-article/clean-html'
import { buildUploadArticleHtml, uploadArticleLanguage } from '@/lib/upload-article/build-html'
import { readUploadAuthor, pickAuthorForArticle } from '@/lib/upload-article/author'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { orChatStream, OR_MODELS } from '@/lib/openrouter'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { ensureHumanVoiceText } from '@/lib/upload-article/human-voice'
import { readUploadCta, isUploadCtaReady } from '@/lib/upload-article/cta'
import { insertUploadCta } from '@/lib/upload-article/cta-insert'
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks, type UploadKeyword, type UploadTheme } from '@/lib/upload-article/types'

export const maxDuration = 800

function readPlan(prefs: Record<string, unknown> | null): UploadKeyword[] {
  const raw = prefs?.keywordPlan
  return Array.isArray(raw) ? (raw as UploadKeyword[]) : []
}

function readLinks(prefs: Record<string, unknown> | null): UploadInternalLinks {
  const raw = prefs?.internalLinks
  return { ...DEFAULT_UPLOAD_INTERNAL_LINKS, ...(raw && typeof raw === 'object' ? (raw as Partial<UploadInternalLinks>) : {}) }
}

function layerSummary(l: ResolvedLayer | null): { id: string; name: string; version: number } | null {
  return l ? { id: l.id, name: l.name, version: l.version } : null
}

/** GET /api/upload-article/clients/[id]/write — เช็คว่า Content Engine ของลูกค้าพร้อมเขียนหรือยัง */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const ce = await resolveContentEngine(session.user.organizationId, { projectId: client.id })
  const missing = missingWriterLayers(ce)

  return NextResponse.json({
    ready: missing.length === 0,
    missing,
    layers: {
      businessSkill: layerSummary(ce.businessSkill),
      masterPrompt: layerSummary(ce.masterPrompt),
      articleBrief: layerSummary(ce.articleBrief),
      validatorPack: layerSummary(ce.validatorPack),
    },
  })
}

/** POST /api/upload-article/clients/[id]/write body {keywordId, withCta?} — สตรีม NDJSON ระหว่างเขียนบทความจาก keyword */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const userId = session.user.id
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const keywordId = typeof body?.keywordId === 'string' ? body.keywordId : ''
  if (!keywordId) return NextResponse.json({ error: 'ต้องระบุ keywordId' }, { status: 400 })
  const withCta = body?.withCta === true

  const prefs = await readPrefs(client.id, orgId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  const plan = readPlan(prefs)
  const keyword = plan.find((k) => k.id === keywordId)
  if (!keyword) return NextResponse.json({ error: 'ไม่พบ keyword นี้' }, { status: 404 })

  // keyword นี้กำลังเขียนอยู่แล้ว (ไม่นับที่ค้างเกิน 6 นาที — proc ตายกลางทาง ลบแล้วเขียนใหม่ได้)
  const sourceName = `kw:${keywordId}`
  const existingWriting = await prisma.uploadArticle.findMany({
    where: { clientId: client.id, organizationId: orgId, sourceName, status: 'WRITING' },
  })
  const staleIds: string[] = []
  for (const a of existingWriting) {
    if (isWritingStale(a.updatedAt)) staleIds.push(a.id)
    else return NextResponse.json({ error: 'keyword นี้กำลังเขียนอยู่ รอสักครู่แล้วลองใหม่' }, { status: 409 })
  }
  if (staleIds.length) await prisma.uploadArticle.deleteMany({ where: { id: { in: staleIds } } })

  const ce = await resolveContentEngine(orgId, { projectId: client.id })
  const missing = missingWriterLayers(ce)
  if (missing.length > 0) {
    return NextResponse.json({ error: 'CONTENT_ENGINE_NOT_CONFIGURED', missing }, { status: 422 })
  }
  // ผ่านเช็ค missing ด้านบนแล้ว — 4 layer นี้มีจริงแน่นอน
  // Master Prompt เก่า/ที่แก้ผ่าน Content Engine อาจยังไม่มีกฎภาษามนุษย์ — แนบให้ถ้ายังไม่มี
  const masterPrompt = ensureHumanVoiceText(ce.masterPrompt!.text)
  const businessSkill = ce.businessSkill!.text
  const articleBrief = ce.articleBrief!.text
  const validatorPack = ce.validatorPack!.text

  let theme: UploadTheme
  try {
    theme = JSON.parse(client.themeColors)
  } catch {
    theme = { theme: '#2563eb', text: '#1f2937', border: '#e5e7eb', accent: '#2563eb', background: '', styleMode: 'embed' }
  }

  // CTA ตาม Project Setting > CTA — ทีมติ๊ก "ใส่ CTA" แต่ยังตั้งค่าไม่ครบ = แจ้งก่อนเริ่ม ไม่เสียค่าเขียน
  const cta = readUploadCta(prefs.cta)
  if (withCta && !isUploadCtaReady(cta)) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า CTA ให้ครบ — ไปที่ Project Setting > CTA' }, { status: 400 })
  }
  const ctaDesign = cta

  // Author Box ตาม Project Setting > Author Box — ปิดอยู่/ยังไม่มีผู้เขียน = ไม่ใส่
  const authorSettings = readUploadAuthor(prefs.author)
  const authorForArticle = (articleId: string) => {
    const profile = pickAuthorForArticle(authorSettings, articleId)
    return profile ? { profile, style: authorSettings.style } : null
  }

  const links = readLinks(prefs)
  const linkPairs = pickLinksForKeyword(links, { keyword: keyword.keyword, slug: keyword.slug })

  const title = keyword.title || keyword.keyword
  const seoTitle = title.slice(0, 70)

  const article = await prisma.uploadArticle.create({
    data: {
      organizationId: orgId,
      clientId: client.id,
      title: title.slice(0, 200),
      sourceType: 'ai',
      sourceName,
      sourceHtml: '',
      seoTitle,
      slug: keyword.slug || '',
      status: 'WRITING',
      createdById: userId,
    },
  })

  await updatePrefs(client.id, orgId, (current) => {
    const p = readPlan(current)
    const idx = p.findIndex((k) => k.id === keywordId)
    if (idx === -1) return { result: null }
    const next = [...p]
    const item = { ...next[idx], articleId: article.id }
    delete item.writeError
    next[idx] = item
    return { prefs: { ...current, keywordPlan: next }, result: null }
  })

  const system = buildWriterSystemPrompt({ masterPrompt, businessSkill, articleBrief, validatorPack })
  // ภาษาของบทความนี้ตามโหมดภาษาของลูกค้า (ไทย / อังกฤษ / ไทย+อังกฤษ = ดูจาก title ก่อน)
  const language = uploadArticleLanguage(client.language, title, keyword.keyword)
  const user = buildWriterUserPrompt({ keyword, links: linkPairs, language })
  const clientSlug = `upload-${slugifyClient(client.name)}`

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const safeEnqueue = (obj: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        } catch {
          // client ตัดการเชื่อมต่อไปแล้ว — งานเขียน/บันทึกผลยังทำต่อจนจบตามปกติ ไม่โยน error ต่อ
        }
      }

      safeEnqueue({ type: 'start', articleId: article.id })

      let charCount = 0
      const startedAt = Date.now()
      const heartbeat = setInterval(() => {
        safeEnqueue({ type: 'heartbeat', elapsed: Math.round((Date.now() - startedAt) / 1000), chars: charCount })
      }, 5000)

      try {
        const result = await withOrClient(clientSlug, () =>
          orChatStream({
            trace: 'upload_article_write',
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            model: OR_MODELS.writer(),
            maxTokens: 20000,
            timeoutMs: 700_000,
            onDelta: (delta) => {
              charCount += delta.length
            },
          }),
        )

        const parsed = parseWriterOutput(result.text)
        const cleaned = cleanSemanticHtml(parsed.html)
        if (cleaned.trim().length < MIN_CLEANED_HTML_LENGTH) {
          throw new Error('เนื้อหาที่ได้สั้นเกินไป (โมเดลอาจตอบว่างหรือถูกตัดกลางทาง) ลองเขียนใหม่อีกครั้ง')
        }

        // แทรกกล่อง CTA ลง sourceHtml เลย — Generate ใหม่กี่รอบก็ยังอยู่ (ข้อความ CTA มาจากที่ทีมตั้ง ไม่ใช่ AI)
        const sourceHtml = withCta ? insertUploadCta(cleaned, cta).html : cleaned

        const built = buildUploadArticleHtml({
          sourceHtml,
          mode: 'html',
          theme,
          site: { name: client.name, url: client.website, language },
          meta: { title, seoTitle, metaDescription: parsed.metaDescription || undefined, slug: keyword.slug || undefined },
          cover: null,
          breadcrumb: true,
          cta: ctaDesign,
          author: authorForArticle(article.id),
        })

        const updated = await prisma.uploadArticle.update({
          where: { id: article.id },
          data: {
            sourceHtml,
            htmlContent: built.html,
            metaDescription: parsed.metaDescription,
            status: 'GENERATED',
          },
        })

        logAIJob({
          organizationId: orgId,
          projectId: null,
          inputSummary: uaJobInput(client.id),
          jobType: 'UPLOAD_ARTICLE_WRITE',
          modelProvider: 'OPENROUTER',
          modelName: OR_MODELS.writer(),
          status: 'SUCCESS',
          tokenUsed: result.usage.totalTokens,
          estimatedCost: result.usage.costUsd,
          createdById: userId,
        }).catch(() => {})

        safeEnqueue({ type: 'done', article: toUploadArticleDTO(updated, false) })
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 300) : String(e)

        await prisma.uploadArticle.delete({ where: { id: article.id } }).catch(() => {})
        await updatePrefs(client.id, orgId, (current) => {
          const p = readPlan(current)
          const idx = p.findIndex((k) => k.id === keywordId)
          if (idx === -1) return { result: null }
          const next = [...p]
          const item = { ...next[idx] }
          delete item.articleId
          item.writeError = 'เขียนบทความไม่สำเร็จ — ลองใหม่อีกครั้ง'
          next[idx] = item
          return { prefs: { ...current, keywordPlan: next }, result: null }
        }).catch(() => {})

        logAIJob({
          organizationId: orgId,
          projectId: null,
          inputSummary: uaJobInput(client.id),
          jobType: 'UPLOAD_ARTICLE_WRITE',
          modelProvider: 'OPENROUTER',
          modelName: OR_MODELS.writer(),
          status: 'FAILED',
          errorMessage: message,
          createdById: userId,
        }).catch(() => {})

        safeEnqueue({ type: 'error', error: message })
      } finally {
        clearInterval(heartbeat)
        closed = true
        try {
          controller.close()
        } catch {
          // ปิดไปแล้ว (client ตัดการเชื่อมต่อ) — ไม่ต้องทำอะไรต่อ
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}

export const dynamic = 'force-dynamic'
