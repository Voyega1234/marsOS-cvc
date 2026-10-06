import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveContentEngine, type ResolvedLayer } from '@/lib/content-engine-resolve'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { pickLinksForKeyword } from '@/lib/upload-article/internal-links'
import { loadArticleLinkPairs } from '@/lib/upload-article/article-links'
import {
  buildWriterSystemPrompt,
  buildWriterUserPrompt,
  isWritingStale,
  missingWriterLayers,
  parseWriterOutput,
  MIN_CLEANED_HTML_LENGTH,
  WRITER_MAX_CONTINUATIONS,
  WRITER_MIN_FAQ_ITEMS,
  isTruncatedFinish,
  buildContinuePrompt,
  buildFaqFillPrompt,
  cleanContinuation,
  cleanFaqFill,
} from '@/lib/upload-article/writer'
import { cleanSemanticHtml } from '@/lib/upload-article/clean-html'
import { buildUploadArticleHtml, countFaqItems, replaceFaqSection, uploadArticleLanguage } from '@/lib/upload-article/build-html'
import { readUploadAuthor, pickAuthorForArticle } from '@/lib/upload-article/author'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { orChatStream, OR_MODELS } from '@/lib/openrouter'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { readUploadCta, isUploadCtaReady } from '@/lib/upload-article/cta'
import { insertUploadCta } from '@/lib/upload-article/cta-insert'
import { PBN_MAX_VARIANTS, isPbnPrefsRaw, readPbnSites, writerSourceName } from '@/lib/upload-article/pbn'
import { PBN_MAIN_PROFILE, isPbnProfileId, readPbnProfiles, readPbnArticleTargets } from '@/lib/upload-article/pbn-sets'
import { pbnEffectiveClient, resolveCeSet } from '@/lib/upload-article/pbn-context'
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks, type UploadKeyword, type UploadTheme } from '@/lib/upload-article/types'

export const maxDuration = 800
/** เวลาที่ใช้ได้ทั้งงาน (เผื่อบันทึกผลก่อนชน maxDuration) — รอบเขียนต่อ/เติม FAQ ต้องอยู่ในกรอบนี้ */
const WRITE_BUDGET_MS = 770_000
/** รอบเสริมต้องมีเวลาเหลืออย่างน้อยเท่านี้ถึงจะเริ่ม */
const EXTRA_ROUND_MIN_MS = 60_000

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
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  // PBN Backlinks: ?set=<id> = เช็ค Content Engine ของ set ข้อมูลโปรเจกต์นั้น
  const ceSet = resolveCeSet(client, req.url)
  if ('error' in ceSet) return NextResponse.json({ error: ceSet.error }, { status: 400 })
  const ce = await resolveContentEngine(session.user.organizationId, { projectId: ceSet.scopeId })
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

/** POST /api/upload-article/clients/[id]/write body {keywordId, withCta?, variant?, variantTotal?} — สตรีม NDJSON ระหว่างเขียนบทความจาก keyword */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const requestStartedAt = Date.now()
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
  // PBN Backlinks: เขียนหลายเวอร์ชันจาก keyword เดียว — ไม่ส่ง = เวอร์ชันเดียวแบบเดิม
  const intIn = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PBN_MAX_VARIANTS ? v : fallback
  const variantTotal = intIn(body?.variantTotal, 1)
  const variant = Math.min(intIn(body?.variant, 1), variantTotal)
  const isPrimary = variant === 1

  const prefs = await readPrefs(client.id, orgId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  // PBN Backlinks: ต้องบอกว่าบทความนี้เขียนเพื่อขึ้นเว็บ PBN ไหน (สไตล์ตามเว็บนั้น + push ได้แค่เว็บนั้น) และใช้ set ข้อมูลโปรเจกต์ไหน
  const isPbn = isPbnPrefsRaw(client.pushPrefs)
  let target: { siteId: string; profileId: string } | null = null
  if (isPbn) {
    const siteId = typeof body?.siteId === 'string' ? body.siteId : ''
    if (!siteId || !readPbnSites(prefs).some((s) => s.id === siteId)) {
      return NextResponse.json({ error: 'เลือกเว็บ PBN ที่จะ push บทความนี้ก่อนเขียน (เว็บนี้อาจถูกลบไปแล้ว)' }, { status: 400 })
    }
    const profileId = isPbnProfileId(body?.profileId) ? body.profileId : PBN_MAIN_PROFILE
    if (profileId !== PBN_MAIN_PROFILE && !readPbnProfiles(prefs).some((p) => p.id === profileId)) {
      return NextResponse.json({ error: 'ไม่พบ set ข้อมูลโปรเจกต์ที่เลือก (อาจถูกลบไปแล้ว)' }, { status: 400 })
    }
    target = { siteId, profileId }
  }
  // client ที่ใช้เขียนจริง — PBN: เว็บหลัก/ภาษาตาม set + สไตล์ตามเว็บปลายทาง, Upload Article: ค่าเดิม
  const effective = pbnEffectiveClient({ ...client, pushPrefs: JSON.stringify(prefs) }, target)
  const writeClient = effective.client
  const plan = readPlan(prefs)
  const keyword = plan.find((k) => k.id === keywordId)
  if (!keyword) return NextResponse.json({ error: 'ไม่พบ keyword นี้' }, { status: 404 })

  // keyword นี้กำลังเขียนอยู่แล้ว (ไม่นับที่ค้างเกิน 6 นาที — proc ตายกลางทาง ลบแล้วเขียนใหม่ได้)
  const sourceName = writerSourceName(keywordId, variant)
  // 3 การอ่านนี้เป็นอิสระจากกัน (ไม่พึ่งผลของกันและกัน) — ยิงพร้อมกันได้ แต่ยังเช็ค error ตามลำดับเดิม (409 → 422 → CTA 400)
  const [existingWriting, ce, extraLinks] = await Promise.all([
    prisma.uploadArticle.findMany({
      where: { clientId: client.id, organizationId: orgId, sourceName, status: 'WRITING' },
    }),
    resolveContentEngine(orgId, { projectId: effective.ceScopeId }),
    loadArticleLinkPairs(client.id, orgId, prefs),
  ])
  const staleIds: string[] = []
  for (const a of existingWriting) {
    if (isWritingStale(a.updatedAt)) staleIds.push(a.id)
    else return NextResponse.json({ error: 'keyword นี้กำลังเขียนอยู่ รอสักครู่แล้วลองใหม่' }, { status: 409 })
  }
  if (staleIds.length) await prisma.uploadArticle.deleteMany({ where: { id: { in: staleIds } } })

  const missing = missingWriterLayers(ce)
  if (missing.length > 0) {
    return NextResponse.json({ error: 'CONTENT_ENGINE_NOT_CONFIGURED', missing }, { status: 422 })
  }
  // ผ่านเช็ค missing ด้านบนแล้ว — 4 layer นี้มีจริงแน่นอน
  // กฎภาษามนุษย์ไม่ต้องแนบที่ Master Prompt แล้ว — Mars Human Voice Skill อยู่ใน user prompt ทุกครั้ง (buildWriterUserPrompt)
  const masterPrompt = ce.masterPrompt!.text
  const businessSkill = ce.businessSkill!.text
  const articleBrief = ce.articleBrief!.text
  const validatorPack = ce.validatorPack!.text

  let theme: UploadTheme
  try {
    theme = JSON.parse(writeClient.themeColors)
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
  const linkPairs = pickLinksForKeyword(links, { keyword: keyword.keyword, slug: keyword.slug, extra: extraLinks })

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

  // รวม 2 การแก้ pushPrefs (เป้าหมาย PBN + ผูก keyword กับบทความ) เป็น read-modify-write ครั้งเดียว — เรียงลำดับเดิม (target ก่อน แล้วค่อยผูก plan)
  if (target || isPrimary) await updatePrefs(client.id, orgId, (current) => {
    let next = current
    let changed = false
    if (target) {
      next = { ...next, pbnArticleTargets: { ...readPbnArticleTargets(next), [article.id]: target } }
      changed = true
    }
    // keyword ผูกกับบทความเวอร์ชัน 1 เท่านั้น — เวอร์ชันอื่นหาเจอจาก sourceName
    if (isPrimary) {
      const p = readPlan(next)
      const idx = p.findIndex((k) => k.id === keywordId)
      if (idx !== -1) {
        const list = [...p]
        const item = { ...list[idx], articleId: article.id }
        delete item.writeError
        list[idx] = item
        next = { ...next, keywordPlan: list }
        changed = true
      }
    }
    return changed ? { prefs: next, result: null } : { result: null }
  })

  const system = buildWriterSystemPrompt({ masterPrompt, businessSkill, articleBrief, validatorPack })
  // ภาษาของบทความนี้ตามโหมดภาษาของลูกค้า (ไทย / อังกฤษ / ไทย+อังกฤษ = ดูจาก title ก่อน)
  const language = uploadArticleLanguage(writeClient.language, title, keyword.keyword)
  const user = buildWriterUserPrompt({
    keyword,
    links: linkPairs,
    language,
    brandNames: [client.name],
    variant: variantTotal > 1 ? { index: variant, total: variantTotal } : undefined,
  })
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
        const baseMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]
        const remainingMs = () => WRITE_BUDGET_MS - (Date.now() - requestStartedAt)
        const usage = { totalTokens: 0, costUsd: 0 }
        const runWriter = async (messages: typeof baseMessages, timeoutMs: number) => {
          const r = await withOrClient(clientSlug, () =>
            orChatStream({
              trace: 'upload_article_write',
              messages,
              model: OR_MODELS.writer(),
              maxTokens: 20000,
              timeoutMs,
              onDelta: (delta) => {
                charCount += delta.length
              },
            }),
          )
          usage.totalTokens += r.usage.totalTokens
          usage.costUsd += r.usage.costUsd
          return r
        }
        // รอบเสริมทำให้เขียนนานเกิน 6 นาทีได้ — ขยับ updatedAt กันคำขอใหม่มองว่าค้าง (isWritingStale) แล้วลบทิ้งกลางทาง
        const touchWriting = () =>
          prisma.uploadArticle.update({ where: { id: article.id }, data: { status: 'WRITING' } }).catch(() => {})

        const first = await runWriter(baseMessages, 700_000)
        let rawText = first.text

        // ชน max_tokens = บทความถูกตัดกลางทาง (FAQ ท้ายบทความหาย) → เขียนต่อจากจุดที่ขาดจนจบ
        let truncated = isTruncatedFinish(first.finishReason)
        for (let round = 0; truncated && round < WRITER_MAX_CONTINUATIONS; round++) {
          if (remainingMs() < EXTRA_ROUND_MIN_MS) break
          await touchWriting()
          const more = await runWriter(
            [...baseMessages, { role: 'assistant', content: rawText }, { role: 'user', content: buildContinuePrompt(language) }],
            Math.max(30_000, remainingMs() - 20_000),
          )
          rawText += cleanContinuation(more.text)
          truncated = isTruncatedFinish(more.finishReason)
        }
        if (truncated) {
          throw new Error('บทความยาวเกินจนเขียนไม่จบ (ถูกตัดกลางทาง) — ลองเขียนใหม่อีกครั้ง')
        }

        const parsed = parseWriterOutput(rawText)
        let cleaned = cleanSemanticHtml(parsed.html)
        if (cleaned.trim().length < MIN_CLEANED_HTML_LENGTH) {
          throw new Error('เนื้อหาที่ได้สั้นเกินไป (โมเดลอาจตอบว่างหรือถูกตัดกลางทาง) ลองเขียนใหม่อีกครั้ง')
        }

        // FAQ ไม่มีหรือมีแค่ข้อเดียว → เขียนส่วน FAQ ใหม่ทั้งส่วน (ไม่สำเร็จ = เก็บบทความเดิมไว้ ไม่ทิ้งค่าเขียนทั้งบทความ)
        let faqItems = countFaqItems(cleaned)
        for (let attempt = 0; faqItems < WRITER_MIN_FAQ_ITEMS && attempt < 2; attempt++) {
          if (remainingMs() < EXTRA_ROUND_MIN_MS) break
          try {
            await touchWriting()
            const fill = await runWriter(
              [...baseMessages, { role: 'assistant', content: rawText }, { role: 'user', content: buildFaqFillPrompt(language) }],
              Math.max(30_000, remainingMs() - 20_000),
            )
            const faqHtml = cleanSemanticHtml(cleanFaqFill(fill.text))
            if (!faqHtml || isTruncatedFinish(fill.finishReason)) continue
            const next = replaceFaqSection(cleaned, faqHtml)
            const nextItems = countFaqItems(next)
            if (nextItems > faqItems) {
              cleaned = next
              faqItems = nextItems
            }
          } catch (e) {
            // รอบเติม FAQ ล้ม — ลองอีกรอบ/ใช้บทความเดิม
            console.warn('[upload-article/write] เติม FAQ ไม่สำเร็จ', e instanceof Error ? e.message : e)
          }
        }

        // แทรกกล่อง CTA ลง sourceHtml เลย — Generate ใหม่กี่รอบก็ยังอยู่ (ข้อความ CTA มาจากที่ทีมตั้ง ไม่ใช่ AI)
        const sourceHtml = withCta ? insertUploadCta(cleaned, cta).html : cleaned

        const built = buildUploadArticleHtml({
          sourceHtml,
          mode: 'html',
          theme,
          site: { name: client.name, url: writeClient.website, language },
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
          tokenUsed: usage.totalTokens,
          estimatedCost: usage.costUsd,
          createdById: userId,
        }).catch(() => {})

        safeEnqueue({ type: 'done', article: toUploadArticleDTO(updated, false) })
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 300) : String(e)

        await prisma.uploadArticle.delete({ where: { id: article.id } }).catch(() => {})
        if (target) await updatePrefs(client.id, orgId, (current) => {
          const targets = readPbnArticleTargets(current)
          delete targets[article.id]
          return { prefs: { ...current, pbnArticleTargets: targets }, result: null }
        }).catch(() => {})
        if (isPrimary) await updatePrefs(client.id, orgId, (current) => {
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
