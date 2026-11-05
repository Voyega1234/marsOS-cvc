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
  composeWriterConstraints,
  isWritingStale,
  missingWriterLayers,
  parseWriterOutput,
  MIN_CLEANED_HTML_LENGTH,
  WRITER_MAX_CONTINUATIONS,
  WRITER_MAX_DURATION_S,
  WRITER_STALE_MS,
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
import {
  bannedTermsOf, cleanPlainText, cleanSlug, hasRestrictions, hitWarnings, keywordWarnings,
} from '@/lib/ce-restrictions'
import { enforceRestrictions, judgeRelatedProducts, loadClientComments, loadRestrictions } from '@/lib/ce-restrictions-server'
import { hasClientComments } from '@/lib/ce-client-comments'
import { checkAgainstComments, type CommentFix } from '@/lib/ce-comment-check'
import { stripEditorialNotes } from '@/lib/article-human-voice-skill'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { readUploadCta, isUploadCtaReady, hasUploadCta } from '@/lib/upload-article/cta'
import { insertUploadCta } from '@/lib/upload-article/cta-insert'
import { boxReferencesSection, structureOptionsFromDetail } from '@/lib/upload-article/references'
import { mergeEvidence, mergeLibrary, searchReferences, withFoundReferences } from '@/lib/upload-article/reference-search'
import { PBN_MAX_VARIANTS, isPbnPrefsRaw, parseWriterSourceName, readPbnSites, writerSourceName } from '@/lib/upload-article/pbn'
import { buildWriteStampInput, computeWriteStamp } from '@/lib/upload-article/write-stamp'
import { PBN_MAIN_PROFILE, isPbnProfileId, readPbnProfiles, readPbnArticleTargets } from '@/lib/upload-article/pbn-sets'
import { pbnEffectiveClient, resolveCeSet } from '@/lib/upload-article/pbn-context'
import { effectiveTocPosition } from '@/lib/upload-article/toc-position'
import { PUSH_LOCK_MS, REWRITE_SOURCE_TYPE, rewriteBackupName } from '@/lib/upload-article/rewrite-lock'
import { isNormalStopFinish, rewriteOutputProblem } from '@/lib/upload-article/rewrite-guard'
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks, type UploadKeyword, type UploadTheme } from '@/lib/upload-article/types'

export const maxDuration = WRITER_MAX_DURATION_S
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

/** ลองเขียน pushPrefs ซ้ำเมื่อพลาดชั่วคราว (ผลลัพธ์ที่ client รออยู่ต้องไปถึง) */
async function updatePrefsRetry(clientId: string, orgId: string, fn: Parameters<typeof updatePrefs>[2], tries = 3): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      await updatePrefs(clientId, orgId, fn)
      return true
    } catch (e) {
      console.warn('[upload-article/write] เขียน pushPrefs ไม่สำเร็จ', i + 1, e instanceof Error ? e.message : e)
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  return false
}

/** บันทึกผลเขียนใหม่ที่ล้มเหลว — บทความเดิมถูกลบไปแล้วไม่ต้องบันทึก */
async function recordRewriteFailure(clientId: string, orgId: string, articleId: string, message: string) {
  const exists = await prisma.uploadArticle.findFirst({ where: { id: articleId, organizationId: orgId }, select: { id: true } }).catch(() => null)
  if (!exists) return
  await updatePrefsRetry(clientId, orgId, (current) => ({
    prefs: { ...current, articleRewriteResults: { ...((current.articleRewriteResults as Record<string, unknown>) || {}), [articleId]: { at: new Date().toISOString(), ok: false, error: message } } },
    result: null,
  }))
}

/** ทรานแซกชันสลับเนื้อหา: ลองซ้ำเมื่อ P2028/P2034 (รอคิวเชื่อมต่อ/ชนกัน) — ไม่ทิ้งผลที่จ่ายเงินไปแล้ว */
async function withTxRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (i + 1 >= tries || (code !== 'P2028' && code !== 'P2034')) throw e
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
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
  let withCta = body?.withCta === true
  // เขียนใหม่ทับบทความเดิม (Re-generate หน้า Review) — เขียนลงแถวเงา แล้วสลับเนื้อหาเข้าแถวเดิมตอนจบ
  const rewriteArticleId = typeof body?.rewriteArticleId === 'string' ? body.rewriteArticleId : ''
  // PBN Backlinks: เขียนหลายเวอร์ชันจาก keyword เดียว — ไม่ส่ง = เวอร์ชันเดียวแบบเดิม
  const intIn = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PBN_MAX_VARIANTS ? v : fallback
  let variantTotal = intIn(body?.variantTotal, 1)
  let variant = Math.min(intIn(body?.variant, 1), variantTotal)
  let isPrimary = variant === 1

  const prefs = await readPrefs(client.id, orgId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  // PBN Backlinks: ต้องบอกว่าบทความนี้เขียนเพื่อขึ้นเว็บ PBN ไหน (สไตล์ตามเว็บนั้น + push ได้แค่เว็บนั้น) และใช้ set ข้อมูลโปรเจกต์ไหน
  const isPbn = isPbnPrefsRaw(client.pushPrefs)
  let target: { siteId: string; profileId: string } | null = null
  const rewriteOf = rewriteArticleId
    ? await prisma.uploadArticle.findFirst({ where: { id: rewriteArticleId, clientId: client.id, organizationId: orgId } })
    : null
  if (rewriteArticleId) {
    if (!rewriteOf) return NextResponse.json({ error: 'ไม่พบบทความที่จะเขียนใหม่' }, { status: 404 })
    // เขียนใหม่: เวอร์ชันมาจาก sourceName ของบทความเดิม (client ไม่ต้องส่ง variantTotal)
    const own = parseWriterSourceName(rewriteOf.sourceName)
    if (rewriteOf.sourceType !== 'ai' || !own || own.keywordId !== keywordId) {
      return NextResponse.json({ error: 'บทความนี้ไม่ได้เขียนจาก keyword นี้ — เขียนใหม่ด้วย AI ไม่ได้' }, { status: 400 })
    }
    const siblings = await prisma.uploadArticle.findMany({
      where: { clientId: client.id, organizationId: orgId, sourceType: 'ai', sourceName: { startsWith: `kw:${keywordId}` } },
      select: { sourceName: true },
    })
    variant = own.variant
    variantTotal = Math.min(
      PBN_MAX_VARIANTS,
      Math.max(variant, ...siblings.map((s) => { const p = parseWriterSourceName(s.sourceName); return p && p.keywordId === keywordId ? p.variant : 1 })),
    )
    isPrimary = variant === 1
    // PUSHING ที่ค้างเกิน PUSH_LOCK_MS (ฟังก์ชัน push ถูกตัดกลางทาง) ไม่นับว่ากำลังทำงาน
    const pushingFresh = rewriteOf.status === 'PUSHING' && rewriteOf.updatedAt.getTime() > Date.now() - PUSH_LOCK_MS
    if (rewriteOf.status === 'WRITING' || pushingFresh) {
      return NextResponse.json({ error: 'บทความนี้กำลังทำงานอยู่ รอสักครู่แล้วลองใหม่' }, { status: 409 })
    }
    // CTA ตามที่บทความเดิมมีอยู่
    withCta = hasUploadCta(rewriteOf.sourceHtml)
  }
  if (isPbn && rewriteOf) {
    // เขียนใหม่ใช้เว็บ/set ที่บทความเดิมถูกเขียนมา
    const saved = readPbnArticleTargets(prefs)[rewriteOf.id]
    if (!saved || !readPbnSites(prefs).some((s) => s.id === saved.siteId)) {
      return NextResponse.json({ error: 'ไม่พบเว็บ PBN ของบทความนี้ (อาจถูกลบไปแล้ว) — เขียนใหม่ด้วย AI ไม่ได้' }, { status: 400 })
    }
    target = saved
  } else if (isPbn) {
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

  // keyword นี้กำลังเขียนอยู่แล้ว (ไม่นับที่ค้างเกิน WRITER_STALE_MS — proc ตายกลางทาง ลบแล้วเขียนใหม่ได้)
  const sourceName = rewriteOf ? `rw:${rewriteOf.id}` : writerSourceName(keywordId, variant)
  // 3 การอ่านนี้เป็นอิสระจากกัน (ไม่พึ่งผลของกันและกัน) — ยิงพร้อมกันได้ แต่ยังเช็ค error ตามลำดับเดิม (409 → 422 → CTA 400)
  const [existingWriting, ce, extraLinks, restrictions] = await Promise.all([
    prisma.uploadArticle.findMany({
      where: { clientId: client.id, organizationId: orgId, sourceName, status: 'WRITING' },
    }),
    resolveContentEngine(orgId, { projectId: effective.ceScopeId }),
    loadArticleLinkPairs(client.id, orgId, prefs),
    // Content Engine > ข้อจำกัด ของ scope เดียวกับ CE (ไม่มี/Draft = null)
    loadRestrictions(orgId, { projectId: effective.ceScopeId }),
  ])
  // Comment ไม่บังคับ — โหลดพังก็เขียนต่อได้
  const clientComments = await loadClientComments(orgId, { projectId: effective.ceScopeId }).catch(() => null)
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
  const linkPairs = pickLinksForKeyword(links, { keyword: keyword.keyword, title: keyword.title, slug: keyword.slug, extra: extraLinks, ...(rewriteOf?.wordpressUrl ? { excludeUrl: rewriteOf.wordpressUrl } : {}) })

  // คำต้องห้าม (Content Engine > ข้อจำกัด) ในช่อง title / SEO title / slug ที่มาจากแผน keyword — แทนคำที่มีคำแทนไว้, ที่เหลือเตือน
  // keyword หลักห้ามแก้ — มีคำต้องห้ามแค่เตือน
  const bannedTerms = restrictions ? bannedTermsOf(restrictions.data) : []
  // เขียนใหม่: ชื่อ/slug คงตามบทความเดิม (H1 ต้องตรง) — แผน keyword เปลี่ยนไม่มีผล ตรวจคำต้องห้ามกับของที่คงไว้
  const titleClean = cleanPlainText(rewriteOf ? rewriteOf.title : keyword.title || keyword.keyword, bannedTerms)
  const slugClean = cleanSlug(rewriteOf ? rewriteOf.slug || keyword.slug || '' : keyword.slug || '', bannedTerms)
  const title = rewriteOf ? rewriteOf.title : titleClean.text
  const seoTitle = title.slice(0, 70)
  const articleSlug = rewriteOf ? rewriteOf.slug || slugClean.text : slugClean.text
  const fieldWarnings = [
    ...keywordWarnings(keyword.keyword, bannedTerms),
    ...hitWarnings('title', titleClean.remaining),
    ...hitWarnings('slug', slugClean.remaining),
    ...(rewriteOf && titleClean.replaced > 0 ? ['title: ชื่อเดิมมีคำต้องห้าม (ไม่ได้แก้ชื่อบทความที่คงไว้)'] : []),
    ...(rewriteOf && slugClean.replaced > 0 ? ['slug: slug เดิมมีคำต้องห้าม (ไม่ได้แก้ slug ที่คงไว้)'] : []),
  ]

  // claim แบบ atomic: สร้างแถว WRITING เฉพาะเมื่อยังไม่มีแถว WRITING ของ keyword นี้ที่ยังสด (กัน 2 request ผ่านเช็ค 409 พร้อมกัน)
  const article = await prisma.$transaction(async (tx) => {
    // ล็อกแถวลูกค้าให้ request ที่แข่งกันต่อคิว
    await tx.$queryRaw`SELECT id FROM "plans_seo_pipeline"."UploadClient" WHERE id = ${client.id} FOR UPDATE`
    const fresh = await tx.uploadArticle.count({
      where: {
        clientId: client.id, organizationId: orgId, sourceName, status: 'WRITING',
        updatedAt: { gt: new Date(Date.now() - WRITER_STALE_MS) },
      },
    })
    if (fresh > 0) return null
    return tx.uploadArticle.create({
      data: {
        organizationId: orgId,
        clientId: client.id,
        title: title.slice(0, 200),
        sourceType: rewriteOf ? 'ai-rewrite' : 'ai',
        sourceName,
        sourceHtml: '',
        seoTitle,
        slug: articleSlug,
        status: 'WRITING',
        createdById: userId,
      },
    })
  })
  if (!article) return NextResponse.json({ error: 'keyword นี้กำลังเขียนอยู่ รอสักครู่แล้วลองใหม่' }, { status: 409 })

  // ขั้นเตรียม prompt ทั้งหมดอยู่ใน try — พังหลัง claim แถวเงาแล้วต้องลบแถวเงา ไม่งั้นบทความโดนล็อก ~920 วินาที
  const prep = await (async () => {
    // รวม 2 การแก้ pushPrefs (เป้าหมาย PBN + ผูก keyword กับบทความ) เป็น read-modify-write ครั้งเดียว — เรียงลำดับเดิม (target ก่อน แล้วค่อยผูก plan)
    if (!rewriteOf && (target || isPrimary)) await updatePrefs(client.id, orgId, (current) => {
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

    const clientSlug = `upload-${slugifyClient(client.name)}`
    const restrictionsTopic = { keyword: keyword.keyword, title, outline: keyword.note }
    // ค้นแหล่งอ้างอิงเฉพาะโดเมนที่เว็บนี้เคยอ้างอิง — ปิดส่วนอ้างอิงหรือไม่มีคลัง = ไม่เรียก AI
    const [relatedProductIds, found] = await Promise.all([
      judgeRelatedProducts(restrictions, restrictionsTopic, {
        trace: 'upload_article_restrictions_match',
        client: clientSlug,
      }),
      searchReferences({
        detail: theme.detail,
        title,
        keyword: keyword.keyword,
        ownSite: writeClient.website,
        trace: 'upload_article_reference_search',
        client: clientSlug,
      }),
    ])
    const writeRestrictions = mergeEvidence(restrictions, found.references)
    const constraints = composeWriterConstraints({
      restrictions: writeRestrictions,
      clientComments,
      topic: { ...restrictionsTopic, relatedProductIds },
    })
    const system = buildWriterSystemPrompt({
      masterPrompt,
      businessSkill,
      articleBrief,
      validatorPack,
      restrictions: constraints.restrictions,
      restrictionsNote: constraints.restrictionsNote,
    })
    // ภาษาของบทความนี้ตามโหมดภาษาของลูกค้า (ไทย / อังกฤษ / ไทย+อังกฤษ = ดูจาก title ก่อน)
    const language = uploadArticleLanguage(writeClient.language, title, keyword.keyword)
    const user = buildWriterUserPrompt({
      keyword: rewriteOf
        ? { ...keyword, title: rewriteOf.title, slug: rewriteOf.slug || articleSlug || keyword.slug }
        : { ...keyword, title: keyword.title ? title : keyword.title, slug: keyword.slug ? articleSlug : keyword.slug },
      links: linkPairs,
      language,
      brandNames: [client.name],
      constraintLayers: constraints.layerNames,
      structure: withFoundReferences(structureOptionsFromDetail(theme.detail, `${title} ${keyword.keyword}`), found.references),
      variant: variantTotal > 1 ? { index: variant, total: variantTotal } : undefined,
    })

    const writeStamp = computeWriteStamp(buildWriteStampInput({ ce, restrictions, clientComments, keyword, detail: theme.detail, topic: `${title} ${keyword.keyword}`, language }))
    return { constraints, system, user, language, writeStamp, clientSlug, found, writeRestrictions }
  })().catch(async (e) => {
    const message = e instanceof Error ? e.message.slice(0, 300) : String(e)
    await prisma.uploadArticle.delete({ where: { id: article.id } }).catch(() => {})
    if (rewriteOf) await recordRewriteFailure(client.id, orgId, rewriteOf.id, message)
    return { failed: message } as const
  })
  if ('failed' in prep) return NextResponse.json({ error: prep.failed }, { status: 500 })
  const { constraints, system, user, language, writeStamp, clientSlug, found, writeRestrictions } = prep

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
        const usage = { totalTokens: found.tokens, costUsd: found.costUsd }
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
        // รอบเสริมทำให้เขียนนานเกินเวลา stale ได้ — ขยับ updatedAt กันคำขอใหม่มองว่าค้าง (isWritingStale) แล้วลบทิ้งกลางทาง
        const touchWriting = () =>
          prisma.uploadArticle.update({ where: { id: article.id }, data: { status: 'WRITING' } }).catch(() => {})

        const first = await runWriter(baseMessages, 700_000)
        let rawText = first.text
        let lastFinish = first.finishReason

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
          lastFinish = more.finishReason
        }
        if (truncated) {
          throw new Error('บทความยาวเกินจนเขียนไม่จบ (ถูกตัดกลางทาง) — ลองเขียนใหม่อีกครั้ง')
        }
        // เขียนใหม่ทับของเดิม: ต้องจบด้วยเหตุผลปกติเท่านั้น (stream ปิดเฉย ๆ/ถูกกรอง = ได้เนื้อไม่ครบ ห้ามทับ)
        if (rewriteOf && !isNormalStopFinish(lastFinish)) {
          throw new Error(`โมเดลหยุดเขียนผิดปกติ (${lastFinish || 'ไม่ระบุสาเหตุ'}) — เก็บบทความเดิมไว้ ลองเขียนใหม่อีกครั้ง`)
        }

        const parsed = parseWriterOutput(rawText)
        let cleaned = stripEditorialNotes(cleanSemanticHtml(parsed.html))
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
              [...baseMessages, { role: 'assistant', content: rawText }, { role: 'user', content: buildFaqFillPrompt(language, constraints.layerNames) }],
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

        // คำต้องห้ามของลูกค้า (Content Engine > ข้อจำกัด) — แทนคำ/เขียนท่อนใหม่ก่อนแทรก CTA (CTA เป็นข้อความของทีม ไม่แตะ)
        let metaDescription = parsed.metaDescription
        let restrictionWarnings: string[] | undefined = fieldWarnings.length ? [...fieldWarnings] : undefined
        if (hasRestrictions(writeRestrictions)) {
          const enforced = await withOrClient(clientSlug, () =>
            enforceRestrictions({
              ctx: writeRestrictions,
              html: cleaned,
              metaDescription,
              trace: 'upload_article_restrictions',
              rewrite: remainingMs() >= EXTRA_ROUND_MIN_MS,
              timeoutMs: Math.max(30_000, Math.min(120_000, remainingMs() - 20_000)),
            }),
          )
          cleaned = enforced.html
          metaDescription = enforced.metaDescription
          if (enforced.remaining.length || enforced.citationWarnings.length) {
            restrictionWarnings = [...enforced.remaining.map((h) => `${h.term} (${h.count})`), ...enforced.citationWarnings, ...fieldWarnings]
          }
        }

        // ตรวจกับ Comment ลูกค้า แล้วแก้เฉพาะท่อนที่ขัด — ไม่มี Comment = ไม่เรียก AI
        let commentFixes: CommentFix[] = []
        if (hasClientComments(clientComments)) {
          if (remainingMs() >= EXTRA_ROUND_MIN_MS) {
            const checked = await checkAgainstComments({
              comments: clientComments,
              rulesText: constraints.restrictions,
              html: cleaned,
              bannedTerms,
              trace: 'upload_article_comment_check',
              client: clientSlug,
              timeoutMs: Math.max(30_000, Math.min(90_000, remainingMs() - 20_000)),
            })
            cleaned = checked.html
            commentFixes = checked.fixes
            usage.totalTokens += checked.tokens
            usage.costUsd += checked.costUsd
            if (checked.warnings.length) restrictionWarnings = [...(restrictionWarnings ?? []), ...checked.warnings]
          } else {
            restrictionWarnings = [...(restrictionWarnings ?? []), 'ไม่ได้ตรวจกับ Comment เพราะเวลาไม่พอ กรุณาตรวจเอง']
          }
        }
        if (found.warning) restrictionWarnings = [...(restrictionWarnings ?? []), found.warning]

        // แทรกกล่อง CTA ลง sourceHtml เลย — Generate ใหม่กี่รอบก็ยังอยู่ (ข้อความ CTA มาจากที่ทีมตั้ง ไม่ใช่ AI)
        const withCtaHtml = withCta ? insertUploadCta(cleaned, cta).html : cleaned
        // แหล่งที่ค้นเจอไม่อยู่ในคลังของเว็บ ต้องจัดกล่องตอนนี้ ไม่งั้น Re-generate จะตัดทิ้ง
        const sourceHtml = found.references.length && theme.detail?.structure?.references
          ? boxReferencesSection(withCtaHtml, {
              library: mergeLibrary(theme.detail.references ?? [], found.references),
              title: theme.detail.structure.referencesTitle,
              language,
              onlyListed: true,
            })
          : withCtaHtml
        if (rewriteOf) {
          const problem = rewriteOutputProblem(rewriteOf.sourceHtml, sourceHtml)
          if (problem) throw new Error(problem)
        }

        const built = buildUploadArticleHtml({
          sourceHtml,
          mode: rewriteOf?.outputMode === 'text' ? 'text' : 'html',
          theme,
          aiSource: true,
          site: { name: client.name, url: writeClient.website, language },
          meta: rewriteOf
            ? { title: rewriteOf.title, seoTitle: rewriteOf.seoTitle || seoTitle, metaDescription: (metaDescription || rewriteOf.metaDescription) || undefined, slug: rewriteOf.slug || articleSlug || undefined }
            : { title, seoTitle, metaDescription: metaDescription || undefined, slug: articleSlug || undefined },
          cover: rewriteOf?.coverImageUrl ? { url: rewriteOf.coverImageUrl, alt: rewriteOf.coverAlt || rewriteOf.title } : null,
          breadcrumb: true,
          cta: ctaDesign,
          author: authorForArticle(rewriteOf?.id ?? article.id),
          // ตำแหน่งสารบัญเดียวกับปุ่ม Generate (ไม่ตั้ง = แบบเดิม) — PBN ไม่ใช้
          tocPosition: isPbn ? undefined : effectiveTocPosition(prefs),
        })

        let updated
        if (rewriteOf) {
          // สลับเนื้อหาเข้าแถวเดิมในทรานแซกชันเดียว (id/slug/post id/ปก/ค่าตั้งต่อบทความคงเดิม) แล้วลบแถวเงา
          updated = await withTxRetry(() => prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ status: string; updatedAt: Date }>>`
              SELECT "status", "updatedAt" FROM "plans_seo_pipeline"."UploadArticle" WHERE id = ${rewriteOf.id} FOR UPDATE`
            if (rows.length === 0) throw new Error('บทความเดิมถูกลบระหว่างเขียนใหม่')
            const pushingFresh = rows[0].status === 'PUSHING' && new Date(rows[0].updatedAt).getTime() > Date.now() - PUSH_LOCK_MS
            if (pushingFresh) throw new Error('บทความเดิมกำลัง push ระหว่างเขียนใหม่ — ลองเขียนใหม่อีกครั้ง')
            // เก็บของเดิมไว้แถวเดียวต่อบทความ (แทนที่ของรอบก่อน) ให้กดย้อนกลับได้
            const current = await tx.uploadArticle.findUniqueOrThrow({ where: { id: rewriteOf.id } })
            await tx.uploadArticle.deleteMany({ where: { organizationId: orgId, sourceType: REWRITE_SOURCE_TYPE, sourceName: rewriteBackupName(rewriteOf.id) } })
            await tx.uploadArticle.create({
              data: {
                organizationId: orgId,
                clientId: client.id,
                title: current.title.slice(0, 200),
                sourceType: REWRITE_SOURCE_TYPE,
                sourceName: rewriteBackupName(rewriteOf.id),
                sourceHtml: current.sourceHtml,
                htmlContent: current.htmlContent,
                metaDescription: current.metaDescription,
                slug: current.slug,
                status: 'GENERATED',
                createdById: userId,
              },
            })
            const row = await tx.uploadArticle.update({
              where: { id: rewriteOf.id },
              data: {
                sourceHtml,
                htmlContent: built.html,
                ...(metaDescription ? { metaDescription } : {}),
                // PUSHING ที่หมดอายุ = push ไม่จบ: ถือว่าขึ้นเว็บแล้วถ้ามีโพสต์ ไม่งั้น GENERATED
                status: rows[0].status === 'PUSHED' ? 'PUSHED'
                  : rows[0].status === 'PUSHING' ? (current.wordpressPostId || current.pushedAt ? 'PUSHED' : 'GENERATED')
                  : 'GENERATED',
              },
            })
            await tx.uploadArticle.delete({ where: { id: article.id } }).catch(() => {})
            return row
          }, { timeout: 15_000, maxWait: 10_000 }))
        } else {
          updated = await prisma.uploadArticle.update({
            where: { id: article.id },
            data: {
              sourceHtml,
              htmlContent: built.html,
              metaDescription,
              status: 'GENERATED',
            },
          })
        }

        // ตราประทับ: บทความนี้เขียนจากอะไร (ใช้ตัดสินตอนกด Re-generate) + ผลลัพธ์ของการเขียนใหม่ (เผื่อ client หลุดระหว่างทาง)
        await updatePrefsRetry(client.id, orgId, (current) => {
          const stamps = { ...((current.articleWriteStamps as Record<string, unknown>) || {}), [updated.id]: writeStamp }
          const next: Record<string, unknown> = { ...current, articleWriteStamps: stamps }
          if (rewriteOf) {
            next.articleRewriteResults = { ...((current.articleRewriteResults as Record<string, unknown>) || {}), [updated.id]: { at: new Date().toISOString(), ok: true, costUsd: usage.costUsd, warnings: (restrictionWarnings || []).slice(0, 10) } }
          }
          return { prefs: next, result: null }
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

        safeEnqueue({
          type: 'done',
          article: toUploadArticleDTO(updated, false),
          restrictionWarnings,
          ...(commentFixes.length ? { commentFixes } : {}),
          ...(found.references.length ? { foundReferences: found.references.map((r) => ({ title: r.title, url: r.url, via: r.via })) } : {}),
        })
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 300) : String(e)

        await prisma.uploadArticle.delete({ where: { id: article.id } }).catch(() => {})
        if (rewriteOf) await recordRewriteFailure(client.id, orgId, rewriteOf.id, message)
        if (target && !rewriteOf) await updatePrefs(client.id, orgId, (current) => {
          const targets = readPbnArticleTargets(current)
          delete targets[article.id]
          return { prefs: { ...current, pbnArticleTargets: targets }, result: null }
        }).catch(() => {})
        if (isPrimary && !rewriteOf) await updatePrefs(client.id, orgId, (current) => {
          const p = readPlan(current)
          const idx = p.findIndex((k) => k.id === keywordId)
          if (idx === -1) return { result: null }
          const next = [...p]
          // ล้างเฉพาะเมื่อ articleId ยังเป็นของ request นี้ (กันล้างของการเขียนรอบใหม่กว่า)
          if (next[idx].articleId !== article.id) return { result: null }
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
