import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveContentEngine } from '@/lib/content-engine-resolve'
import { loadClientComments, loadRestrictions } from '@/lib/ce-restrictions-server'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import { missingWriterLayers } from '@/lib/upload-article/writer'
import { isPbnPrefsRaw, parseWriterSourceName, readPbnSites } from '@/lib/upload-article/pbn'
import { readPbnArticleTargets } from '@/lib/upload-article/pbn-sets'
import { pbnEffectiveClient } from '@/lib/upload-article/pbn-context'
import { uploadArticleLanguage } from '@/lib/upload-article/build-html'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { PUSH_LOCK_MS, findRewriteBackup, freshRewriteShadow } from '@/lib/upload-article/rewrite-lock'
import { REWRITE_RESULT_TTL_MS } from '@/lib/upload-article/rewrite-guard'
import {
  averageCost, buildWriteStampInput, computeWriteStamp, diffWriteStamp, legacyChangedLayers, readWriteStamp,
  type StampChange,
} from '@/lib/upload-article/write-stamp'
import type { UploadKeyword, UploadTheme } from '@/lib/upload-article/types'

/**
 * GET /api/upload-article/articles/[articleId]/rewrite-check
 * ก่อนกด Re-generate: ของที่ใช้เขียนบทความนี้เปลี่ยนไปไหม (ควรให้ AI เขียนใหม่ทั้งบทความหรือไม่)
 * อ่านอย่างเดียว ไม่เรียก AI ไม่เขียน DB
 */
export async function GET(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const client = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  const prefs = (await readPrefs(client.id, orgId)) ?? {}

  const shadow = await freshRewriteShadow(article.id, orgId)
  const lastResultRaw = (prefs.articleRewriteResults as Record<string, unknown> | undefined)?.[article.id]
  // ผลเก่าเกิน TTL ไม่ส่งกลับ (เทียบด้วยเวลา server) — กัน toast เดิมเด้งซ้ำทุกครั้งที่เปิดบทความ
  const serverNow = Date.now()
  const lastResultObj = lastResultRaw && typeof lastResultRaw === 'object' ? (lastResultRaw as { at?: string }) : null
  const resultAge = lastResultObj?.at ? serverNow - Date.parse(lastResultObj.at) : NaN
  const lastResult = lastResultObj && Number.isFinite(resultAge) && resultAge <= REWRITE_RESULT_TTL_MS ? lastResultObj : null
  const backup = await findRewriteBackup(article.id, orgId).catch(() => null)
  const pushing = article.status === 'PUSHING' && article.updatedAt.getTime() > serverNow - PUSH_LOCK_MS
  const base = { rewriting: !!shadow, startedAt: shadow?.createdAt ?? null, lastResult, serverNow: new Date(serverNow).toISOString(), hasBackup: !!backup, pushing }

  const no = (reason: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ...base, canRewrite: false, changed: [], unknown: false, reason, ...extra })

  try {
    const parsed = parseWriterSourceName(article.sourceName)
    if (article.sourceType !== 'ai' || !parsed) return no('บทความนี้ไม่ได้เขียนด้วย AI จาก keyword — สร้าง HTML ใหม่ได้อย่างเดียว')
    const plan = Array.isArray(prefs.keywordPlan) ? (prefs.keywordPlan as UploadKeyword[]) : []
    const keyword = plan.find((k) => k.id === parsed.keywordId)
    if (!keyword) return no('keyword ของบทความนี้ถูกลบจากแผนแล้ว — AI เขียนใหม่ไม่ได้ สร้าง HTML ใหม่ได้อย่างเดียว')

    let target: { siteId: string; profileId: string } | null = null
    if (isPbnPrefsRaw(client.pushPrefs)) {
      target = readPbnArticleTargets(prefs)[article.id] ?? null
      if (!target || !readPbnSites(prefs).some((s) => s.id === target!.siteId)) {
        return no('เว็บ PBN ของบทความนี้ถูกลบแล้ว — AI เขียนใหม่ไม่ได้ สร้าง HTML ใหม่ได้อย่างเดียว')
      }
    }
    const effective = pbnEffectiveClient({ ...client, pushPrefs: JSON.stringify(prefs) }, target)
    const scope = { projectId: effective.ceScopeId }

    // โหลดพัง ≠ ไม่มีข้อมูล — พังแล้วห้ามนับว่า "เปลี่ยน"
    const safe = <T,>(p: Promise<T | null>) => p.then((v) => ({ v, ok: true })).catch(() => ({ v: null as T | null, ok: false }))
    const [ce, restrictionsR, commentsR] = await Promise.all([
      resolveContentEngine(orgId, scope),
      safe(loadRestrictions(orgId, scope)),
      safe(loadClientComments(orgId, scope)),
    ])
    const restrictions = restrictionsR.v
    const clientComments = commentsR.v
    const missing = missingWriterLayers(ce)
    if (missing.length > 0) return no('Content Engine ยังตั้งค่าไม่ครบ — AI เขียนใหม่ไม่ได้', { missing })

    let theme: UploadTheme | null = null
    try { theme = JSON.parse(effective.client.themeColors) as UploadTheme } catch { /* ไม่มีธีม = ไม่มี structure */ }
    const current = computeWriteStamp(buildWriteStampInput({ ce, restrictions, clientComments, keyword, detail: theme?.detail, topic: `${article.title} ${keyword.keyword}`, language: uploadArticleLanguage(effective.client.language, article.title, keyword.keyword) }))
    if (!restrictionsR.ok) delete current.restrictions
    if (!commentsR.ok) delete current.comments

    let changed: StampChange[] = []
    let unknown = false
    const stored = readWriteStamp(prefs, article.id)
    if (stored) {
      changed = diffWriteStamp(stored, current)
    } else {
      // บทความเก่าไม่มีตรา — เดาจากเวลาแก้ layer (ไม่เห็น layer ที่ปิดไปหรือไฟล์ที่ลบ)
      unknown = true
      const ids = [ce.businessSkill, ce.masterPrompt, ce.articleBrief, ce.validatorPack].map((l) => l?.id)
      const keys = ['businessSkill', 'masterPrompt', 'articleBrief', 'validatorPack']
      const fileIds = (c: { files: Array<{ id?: string }> } | null) => (c ? c.files.map((f) => f.id).filter((x): x is string => !!x) : [])
    const extraIds = [restrictions?.rowId, clientComments?.rowId, ...fileIds(restrictions), ...fileIds(clientComments)]
      const rows = await prisma.promptTemplate.findMany({
        where: { organizationId: orgId, id: { in: [...ids, ...extraIds].filter((x): x is string => !!x) } },
        select: { id: true, updatedAt: true },
      })
      const at = new Map(rows.map((r) => [r.id, r.updatedAt]))
      // เทียบเฉพาะ layer ที่มี context จริง และโหลดสำเร็จ (ไฟล์ Comment ไม่ปนเข้าข้อจำกัด) — null = ข้าม ไม่นับเปลี่ยน
    const newest = (...ds: Array<Date | null | undefined>) => ds.filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null
    const at2 = (id?: string | null) => (id ? at.get(id) : null)
    changed = legacyChangedLayers([
      ...keys.map((key, i) => ({ key, updatedAt: ids[i] ? at.get(ids[i]!) : null })),
      ...(restrictions ? [{ key: 'restrictions', updatedAt: newest(at2(restrictions.rowId), ...restrictions.files.map((f) => at2(f.id))) }] : []),
      ...(clientComments ? [{ key: 'comments', updatedAt: newest(at2(clientComments.rowId), ...clientComments.files.map((f) => at2(f.id))) }] : []),
    ], article.createdAt)
    }

    // ต้นทุนเขียนต่อบทความจากงานล่าสุดของลูกค้านี้ (ไม่มี = ลองทั้งองค์กร)
    const recent = async (inputSummary?: string) =>
      prisma.aIJob.findMany({
        where: { organizationId: orgId, jobType: 'UPLOAD_ARTICLE_WRITE', status: 'SUCCESS', estimatedCost: { not: null }, ...(inputSummary ? { input: inputSummary } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { estimatedCost: true },
      })
    let jobs = await recent(uaJobInput(client.id))
    if (jobs.length === 0) jobs = await recent()
    const cost = averageCost(jobs.map((j) => (j.estimatedCost == null ? null : Number(j.estimatedCost))))

    return NextResponse.json({
      ...base,
      canRewrite: true,
      changed,
      unknown,
      avgCostUsd: cost?.avg ?? null,
      costSamples: cost?.samples ?? 0,
    })
  } catch (e) {
    // เช็คการเปลี่ยนพัง — ยังต้องส่ง rewriting/lastResult ให้ client ที่รอผลอยู่
    console.warn('[rewrite-check]', e instanceof Error ? e.message : e)
    return no('ตรวจสอบสิ่งที่เปลี่ยนไม่สำเร็จ ลองใหม่อีกครั้ง', { checkFailed: true })
  }
}

export const dynamic = 'force-dynamic'
