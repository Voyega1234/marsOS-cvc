import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import {
  COMMENT_REVISE_JOB_TYPE,
  MAX_CHANGES_PER_COMMENT,
  MAX_COMMENT_CHARS,
  isPendingComment,
  manualComment,
  readArticleComments,
  setCommentChanges,
  type ArticleComment,
  type ArticleCommentChange,
} from '@/lib/upload-article/article-comments'
import { claimReviseLock, releaseReviseLock, replaceArticleComments } from '@/lib/upload-article/article-comments-store'
import {
  REVISE_MAX_TOKENS,
  REVISE_TIMEOUT_MS,
  ReviseInputError,
  ReviseOutputError,
  applyRevision,
  buildReviseSystemPrompt,
  planRevision,
  type ReviseComment,
  type RevisePlan,
  type ReviseResult,
  type ReviseUnresolved,
} from '@/lib/upload-article/comment-revise'
import { PUSH_LOCK_MS, REWRITE_SOURCE_TYPE, freshRewriteShadow, rewriteBackupName } from '@/lib/upload-article/rewrite-lock'
import { rewriteOutputProblem } from '@/lib/upload-article/rewrite-guard'
import { uploadArticleLanguage } from '@/lib/upload-article/build-html'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { isPbnPrefsRaw } from '@/lib/upload-article/pbn'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { bannedTermsOf, buildRestrictionsBlock } from '@/lib/ce-restrictions'
import { loadRestrictions } from '@/lib/ce-restrictions-server'
import { orChat, type ORUsage } from '@/lib/openrouter'
import { resolveCeModel } from '@/lib/ce-ai-models-server'
import { withOrClient, slugifyClient } from '@/lib/orClient'
import { logAIJob } from '@/lib/logAIJob'

// Next.js อ่านค่า maxDuration ได้เฉพาะตัวเลข literal
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_COMMENT_IDS = 100
/** อายุล็อก "กำลังปรับตาม Comment" — นานกว่าเวลารอ AI เล็กน้อย งานที่ถูกตัดกลางทางจะปลดเองเมื่อครบ */
const REVISE_LOCK_TTL_MS = REVISE_TIMEOUT_MS + 60_000

/** หยุดงานพร้อมสถานะ HTTP ที่ต้องตอบ (ใช้ใน transaction) */
class ReviseAbort extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** ลองซ้ำเมื่อ transaction ชนกัน/หมดเวลารอ (P2028 / P2034) */
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

const isFreshPushing = (status: string, updatedAt: Date) =>
  status === 'PUSHING' && new Date(updatedAt).getTime() > Date.now() - PUSH_LOCK_MS

/**
 * POST /api/upload-article/articles/[articleId]/comment-revise  body { commentIds?, extraText? }
 * AI แก้ต้นฉบับ (sourceHtml) เฉพาะจุดที่ Comment ของลูกค้าขอ — ไม่ส่ง commentIds = ใช้ทุกข้อที่ยังไม่ได้ปรับ
 * แก้เฉพาะเนื้อหา: ชื่อเรื่อง SEO title meta slug สถานะ และ HTML ที่ generate ไว้ไม่ถูกแตะ (ผู้เรียก generate ต่อเอง)
 * เก็บเวอร์ชันก่อนแก้ไว้ 1 ขั้นในแถวสำรองเดียวกับ "AI เขียนใหม่" (ย้อนได้ด้วย rewrite-undo)
 * Comment รวมใน Content Engine ไม่เกี่ยวกับเส้นนี้ — ที่นี่ใช้เฉพาะ Comment รายบทความ + ข้อจำกัดของแบรนด์
 * บทความ 1 ชิ้นปรับได้ทีละคำขอ (ล็อกใน pushPrefs) — คำขอที่ชนกันตอบ 409 ก่อนเรียก AI จึงไม่เสียเงินซ้ำ
 */
export async function POST(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId
  const userId = session.user.id

  const body = (await req.json().catch(() => ({}))) as { commentIds?: unknown; extraText?: unknown } | null
  const givenIds = Array.isArray(body?.commentIds)
    ? new Set(body.commentIds.filter((v): v is string => typeof v === 'string').slice(0, MAX_COMMENT_IDS))
    : null
  const extraText = typeof body?.extraText === 'string' ? body.extraText.trim().slice(0, MAX_COMMENT_CHARS) : ''

  const found = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!found || found.sourceType === REWRITE_SOURCE_TYPE) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const client = await prisma.uploadClient.findFirst({ where: { id: found.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if (isPbnPrefsRaw(client.pushPrefs)) {
    return NextResponse.json({ error: 'บทความ PBN ยังไม่รองรับการปรับตาม Comment' }, { status: 400 })
  }

  // จองบทความก่อนอ่านเนื้อหาที่จะส่งให้ AI — คำขอที่มาชนกันหยุดตรงนี้ ยังไม่เสียเงิน
  let claim: Awaited<ReturnType<typeof claimReviseLock>>
  try {
    claim = await claimReviseLock(client.id, orgId, found.id, REVISE_LOCK_TTL_MS)
  } catch (e) {
    console.error('[upload-article] comment-revise: claim lock failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'เริ่มปรับตาม Comment ไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 })
  }
  if (claim === null) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if (claim === 'busy') {
    return NextResponse.json({ error: 'บทความนี้กำลังปรับตาม Comment อยู่ (อาจกดจากอีกหน้าจอ) รอให้เสร็จก่อนแล้วลองใหม่' }, { status: 409 })
  }
  const lockToken = claim

  try {
    // อ่านบทความอีกครั้งหลังได้ล็อก — งานปรับรอบก่อนหน้าอาจเพิ่งบันทึกเสร็จ
    const article = await prisma.uploadArticle.findFirst({ where: { id: found.id, organizationId: orgId } })
    if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

    if (article.status === 'WRITING' || (await freshRewriteShadow(article.id, orgId))) {
      return NextResponse.json({ error: 'AI กำลังเขียนบทความนี้อยู่ รอให้เสร็จก่อนแล้วลองใหม่' }, { status: 409 })
    }
    if (isFreshPushing(article.status, article.updatedAt)) {
      return NextResponse.json({ error: 'บทความนี้กำลัง Push ขึ้นเว็บ รอให้เสร็จก่อนแล้วลองใหม่' }, { status: 409 })
    }

    const prefs = await readPrefs(client.id, orgId)
    if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
    const stored = readArticleComments(prefs, article.id)
    const chosen = givenIds ? stored.filter((c) => givenIds.has(c.id)) : stored.filter(isPendingComment)
    const reviseComments: ReviseComment[] = chosen.map((c) => ({ id: c.id, text: c.text, ...(c.quote ? { quote: c.quote } : {}) }))
    if (extraText) reviseComments.push({ id: null, text: extraText })
    if (reviseComments.length === 0) {
      return NextResponse.json({ error: 'ไม่มี Comment ให้ปรับ — เลือก Comment หรือพิมพ์เพิ่มก่อน' }, { status: 400 })
    }

    let plan: RevisePlan
    try {
      plan = planRevision({ title: article.title, sourceHtml: article.sourceHtml || '', comments: reviseComments })
    } catch (e) {
      if (e instanceof ReviseInputError) return NextResponse.json({ error: e.message }, { status: 400 })
      throw e
    }

    // ข้อจำกัดของแบรนด์ต้องอ่านให้ได้ก่อนเรียก AI — อ่านไม่ได้ = ไม่ทำ (ไม่ยอมให้ AI แก้โดยไม่รู้ข้อห้าม)
    let restrictions: Awaited<ReturnType<typeof loadRestrictions>>
    try {
      restrictions = await loadRestrictions(orgId, { projectId: client.id })
    } catch (e) {
      console.error('[upload-article] comment-revise: loadRestrictions failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'โหลดข้อจำกัดของ Content Engine ไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 })
    }
    const system = buildReviseSystemPrompt({
      restrictionsBlock: buildRestrictionsBlock(restrictions, { title: article.title }),
      language: uploadArticleLanguage(client.language, article.title),
      // ภาษาจากเนื้อบทความจริงชนะค่าตั้งของโปรเจกต์ (บทความอังกฤษ + Comment ไทย)
      articleLanguage: plan.language ?? uploadArticleLanguage(client.language, article.title),
    })

    const model = await resolveCeModel(orgId, client.id, 'regenerate')
    const logJob = (status: 'SUCCESS' | 'FAILED', usage: ORUsage | undefined, errorMessage?: string) =>
      logAIJob({
        organizationId: orgId,
        projectId: null,
        inputSummary: uaJobInput(client.id),
        jobType: COMMENT_REVISE_JOB_TYPE,
        modelProvider: 'OPENROUTER',
        modelName: model,
        status,
        tokenUsed: usage?.totalTokens,
        estimatedCost: usage?.costUsd,
        errorMessage,
        createdById: userId,
      }).catch(() => {})

    let usage: ORUsage | undefined
    let result: ReviseResult
    try {
      const res = await withOrClient(`upload-${slugifyClient(client.name)}`, () =>
        orChat({
          trace: 'upload_comment_revise',
          model,
          jsonMode: true,
          maxTokens: REVISE_MAX_TOKENS,
          timeoutMs: REVISE_TIMEOUT_MS,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: plan.user },
          ],
        }),
      )
      usage = res.usage
      result = applyRevision(plan, res.text, restrictions ? bannedTermsOf(restrictions.data) : [])
      const problem = result.changed > 0 ? rewriteOutputProblem(article.sourceHtml, result.html) : null
      if (problem) throw new ReviseOutputError(problem)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await logJob('FAILED', usage ?? (e as Error & { usage?: ORUsage }).usage, message)
      console.warn('[upload-article] comment-revise failed:', message)
      const error = e instanceof ReviseOutputError
        ? `${message} — บทความเดิมยังอยู่ครบ ลองใหม่อีกครั้ง`
        : `AI ปรับตาม Comment ไม่สำเร็จ: ${message.slice(0, 300)} — บทความเดิมยังอยู่ครบ ลองใหม่อีกครั้ง`
      return NextResponse.json({ error }, { status: 502 })
    }
    const costUsd = usage?.costUsd ?? 0

    // AI ไม่ได้แก้อะไร: ไม่สร้างแถวสำรอง ไม่ถือว่า Comment ข้อไหนถูกปรับ — บอกเหตุผลกลับไปให้ครบทุกข้อ
    let unresolved: ReviseUnresolved[] = result.unresolved
    if (result.changed === 0) {
      const told = new Set(unresolved.map((u) => u.commentId))
      unresolved = [
        ...unresolved,
        ...plan.comments
          .filter((c) => !told.has(c.id))
          .map((c) => ({ commentId: c.id, text: c.text, reason: 'AI ไม่ได้แก้เนื้อหาตาม Comment ข้อนี้ (อาจไม่มีจุดที่ต้องแก้)' })),
      ]
    }

    let row = article
    if (result.changed > 0) {
      const revisedHtml = result.html
      try {
        row = await withTxRetry(() =>
          prisma.$transaction(
            async (tx) => {
              const rows = await tx.$queryRaw<Array<{ status: string; updatedAt: Date }>>`
                SELECT "status", "updatedAt" FROM "plans_seo_pipeline"."UploadArticle" WHERE id = ${article.id} FOR UPDATE`
              if (!rows[0]) throw new ReviseAbort('บทความถูกลบระหว่างที่ AI ทำงาน', 404)
              // "AI เขียนใหม่" เริ่มระหว่างที่รอ AI: สถานะบทความยังไม่เปลี่ยน มีแค่แถวเงา — ต้องเช็คแถวเงาด้วย
              if (
                rows[0].status === 'WRITING' ||
                isFreshPushing(rows[0].status, rows[0].updatedAt) ||
                (await freshRewriteShadow(article.id, orgId, tx))
              ) {
                throw new ReviseAbort('บทความนี้กำลังถูกเขียนใหม่หรือ Push อยู่ — ผลที่ AI ปรับรอบนี้ไม่ถูกบันทึก ลองใหม่อีกครั้ง', 409)
              }
              const current = await tx.uploadArticle.findUniqueOrThrow({ where: { id: article.id } })
              // ต้นฉบับถูกแก้ระหว่างที่ AI ทำงาน = ผลของ AI อิงเนื้อหาเก่า เขียนทับไม่ได้
              if ((current.sourceHtml || '') !== (article.sourceHtml || '')) {
                throw new ReviseAbort('เนื้อหาบทความถูกแก้ระหว่างที่ AI ทำงาน — ผลที่ AI ปรับรอบนี้ไม่ถูกบันทึก ลองใหม่อีกครั้ง', 409)
              }
              await tx.uploadArticle.deleteMany({
                where: { organizationId: orgId, sourceType: REWRITE_SOURCE_TYPE, sourceName: rewriteBackupName(article.id) },
              })
              await tx.uploadArticle.create({
                data: {
                  organizationId: orgId,
                  clientId: client.id,
                  title: current.title.slice(0, 200),
                  seoTitle: current.seoTitle,
                  sourceType: REWRITE_SOURCE_TYPE,
                  sourceName: rewriteBackupName(article.id),
                  sourceHtml: current.sourceHtml,
                  htmlContent: current.htmlContent,
                  metaDescription: current.metaDescription,
                  slug: current.slug,
                  status: 'GENERATED',
                  createdById: userId,
                },
              })
              return tx.uploadArticle.update({ where: { id: article.id }, data: { sourceHtml: revisedHtml } })
            },
            { timeout: 15_000, maxWait: 10_000 },
          ),
        )
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await logJob('FAILED', usage, message)
        if (e instanceof ReviseAbort) return NextResponse.json({ error: e.message }, { status: e.status })
        console.error('[upload-article] comment-revise: save failed:', message)
        return NextResponse.json({ error: 'บันทึกเนื้อหาที่ปรับแล้วไม่สำเร็จ — บทความเดิมยังอยู่ครบ ลองใหม่อีกครั้ง' }, { status: 500 })
      }
    }
    await logJob('SUCCESS', usage)

    // จำว่า Comment ข้อไหนปรับแล้ว + เก็บข้อความที่พิมพ์เพิ่มเป็น Comment พิมพ์เอง (เก็บหลัง AI ตอบสำเร็จเท่านั้น — เรียกซ้ำตอนล้มจะได้ไม่ซ้ำ)
    const unresolvedIds = new Set(unresolved.map((u) => u.commentId))
    const chosenIds = new Set(chosen.map((c) => c.id))
    const now = new Date()
    const appliedAt = now.toISOString()
    const warnings = [...result.warnings]
    // สิ่งที่ AI แก้ แยกตาม Comment (id null = ข้อความที่พิมพ์เพิ่มรอบนี้) — แสดงเป็นการ์ดใต้ Comment แต่ละข้อ
    const changesById = new Map<string | null, ArticleCommentChange[]>()
    for (const entry of result.changes) {
      for (const n of entry.comments) {
        const target = plan.comments[n - 1]
        if (!target) continue
        changesById.set(target.id, [...(changesById.get(target.id) ?? []), entry.change])
      }
    }
    // มีรายการแก้ใหม่ = แทนบันทึกเดิม; ปรับแล้วแต่ไม่มีรายการแก้ที่ระบุได้ = ลบบันทึกเก่า (ไม่ให้การ์ดรอบก่อนค้าง)
    const noteChanges = (c: ArticleComment, id: string | null, applied: boolean): ArticleComment => {
      const list = changesById.get(id) ?? []
      if (list.length > 0) return setCommentChanges(c, list, Math.max(0, list.length - MAX_CHANGES_PER_COMMENT))
      return applied ? setCommentChanges(c, []) : c
    }
    let comments: ArticleComment[] = stored
    try {
      const saved = await replaceArticleComments(client.id, orgId, article.id, (current) => {
        const next = current.map((c) => {
          if (!chosenIds.has(c.id)) return c
          const applied = !unresolvedIds.has(c.id)
          return noteChanges(applied ? { ...c, appliedAt } : c, c.id, applied)
        })
        const typed = extraText ? manualComment(extraText, now) : null
        if (typed) {
          const applied = !unresolvedIds.has(null)
          next.push(noteChanges(applied ? { ...typed, appliedAt } : typed, null, applied))
        }
        return next
      })
      if (saved) comments = saved
    } catch (e) {
      // เนื้อหาถูกบันทึกแล้ว — จำสถานะ Comment ไม่ได้ไม่ควรทำให้ทั้งงานล้ม
      console.error('[upload-article] comment-revise: mark applied failed:', e instanceof Error ? e.message : e)
      warnings.push('ปรับเนื้อหาแล้ว แต่บันทึกสถานะ "ปรับแล้ว" ของ Comment ไม่สำเร็จ — Comment ยังแสดงว่ายังไม่ได้ปรับ')
    }

    return NextResponse.json({
      article: toUploadArticleDTO(row, true),
      comments,
      changed: result.changed,
      unresolved,
      warnings,
      costUsd,
    })
  } finally {
    // ปล่อยไม่สำเร็จ = ล็อกหมดอายุเองใน REVISE_LOCK_TTL_MS
    await releaseReviseLock(client.id, orgId, found.id, lockToken, REVISE_LOCK_TTL_MS).catch((e) =>
      console.error('[upload-article] comment-revise: release lock failed:', e instanceof Error ? e.message : e),
    )
  }
}
