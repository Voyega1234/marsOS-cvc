import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { slugifyClient } from '@/lib/orClient'
import { logAIJob } from '@/lib/logAIJob'
import { audit, errMsg, parseJsonArray, requireStaff, toRuleLite, userNames } from '@/lib/compliance/server'
import { contentHash, findTermHits, htmlToText, mergeAiResult, ruleSnapshot, scoreRisk } from '@/lib/compliance/engine'
import { runAiContextCheck } from '@/lib/compliance/ai'
import { industryLabel, type Finding } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_SNAPSHOT = 200_000

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const sp = req.nextUrl.searchParams
    const status = sp.get('status')?.trim()
    const industry = sp.get('industry')?.trim()
    const q = (sp.get('q') ?? '').trim().slice(0, 100)
    const rows = await prisma.complianceCheck.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(status ? { status } : {}),
        ...(industry ? { industry } : {}),
        ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true, industry: true, articleSource: true, articleId: true, ownerLabel: true, title: true,
        riskLevel: true, riskScore: true, summary: true, aiUsed: true, aiModel: true, aiError: true,
        status: true, reviewedById: true, reviewedAt: true, createdById: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const names = await userNames(rows.flatMap((r) => [r.createdById, r.reviewedById]))
    return NextResponse.json({
      checks: rows.map((r) => ({
        ...r,
        createdByName: names.get(r.createdById) ?? '',
        reviewedByName: r.reviewedById ? names.get(r.reviewedById) ?? '' : '',
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const industry = typeof body.industry === 'string' ? body.industry.trim() : ''
    const source = body.source
    if (!industry) return NextResponse.json({ error: 'ต้องเลือกอุตสาหกรรม' }, { status: 400 })
    if (source !== 'sme' && source !== 'upload' && source !== 'manual') return NextResponse.json({ error: 'source ไม่ถูกต้อง' }, { status: 400 })
    const useAi = body.useAi !== false

    // ── โหลดเนื้อหา (จำกัดตามองค์กร) ──
    let title = ''
    let text = ''
    let ownerLabel = ''
    let projectId: string | null = null
    let articleId: string | null = null
    if (source === 'sme') {
      const id = typeof body.articleId === 'string' ? body.articleId : ''
      const a = id
        ? await prisma.article.findFirst({
            where: { id, project: { organizationId: ctx.orgId } },
            select: { id: true, title: true, htmlContent: true, metaDescription: true, projectId: true, project: { select: { name: true, clientName: true } } },
          })
        : null
      if (!a) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
      title = a.title
      ownerLabel = a.project?.clientName || a.project?.name || ''
      projectId = a.projectId
      articleId = a.id
      text = [a.title, a.metaDescription ?? '', htmlToText(a.htmlContent ?? '')].filter(Boolean).join('\n\n')
    } else if (source === 'upload') {
      const id = typeof body.articleId === 'string' ? body.articleId : ''
      const a = id
        ? await prisma.uploadArticle.findFirst({
            where: { id, organizationId: ctx.orgId },
            select: { id: true, title: true, htmlContent: true, sourceHtml: true, metaDescription: true, client: { select: { name: true } } },
          })
        : null
      if (!a) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
      title = a.title
      ownerLabel = a.client?.name ?? ''
      articleId = a.id
      text = [a.title, a.metaDescription, htmlToText(a.htmlContent ?? a.sourceHtml ?? '')].filter(Boolean).join('\n\n')
    } else {
      const pasted = typeof body.text === 'string' ? body.text.trim() : ''
      if (pasted.length < 20) return NextResponse.json({ error: 'ข้อความสั้นเกินไป (อย่างน้อย 20 ตัวอักษร)' }, { status: 400 })
      if (pasted.length > 200_000) return NextResponse.json({ error: 'ข้อความยาวเกินไป (สูงสุด 200,000 ตัวอักษร)' }, { status: 400 })
      title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, 300) || 'ข้อความที่วางเอง'
      text = pasted
    }
    if (text.length > MAX_SNAPSHOT) text = text.slice(0, MAX_SNAPSHOT)

    // ── กฎที่เปิดใช้ ──
    const ruleRows = await prisma.complianceRule.findMany({
      where: { organizationId: ctx.orgId, industry, status: 'ACTIVE' },
      orderBy: { code: 'asc' },
    })
    if (!ruleRows.length) return NextResponse.json({ error: 'ยังไม่มีกฎที่เปิดใช้สำหรับอุตสาหกรรมนี้' }, { status: 400 })
    const rules = ruleRows.map(toRuleLite)

    // ── จับคำ + AI ตรวจบริบท ──
    const hits = findTermHits(text, rules)
    let findings: Finding[] = hits
    let summary = ''
    let aiUsed = false
    let aiModel = ''
    let aiError = ''
    if (useAi) {
      try {
        const ai = await runAiContextCheck({
          text, rules, hits, industryLabel: industryLabel(industry),
          client: ownerLabel ? slugifyClient(ownerLabel) || undefined : undefined,
        })
        aiModel = ai.model
        const merged = mergeAiResult(text, hits, rules, ai.raw)
        findings = merged.findings
        summary = merged.summary
        aiUsed = true
        if (ai.truncated) aiError = 'ส่งให้ AI ตรวจเฉพาะ 24,000 ตัวอักษรแรกของบทความ'
        await logAIJob({
          organizationId: ctx.orgId, projectId, jobType: 'COMPLIANCE_CHECK', modelProvider: 'openrouter', modelName: ai.model,
          status: 'SUCCESS', tokenUsed: ai.usage.totalTokens, estimatedCost: ai.usage.costUsd, createdById: ctx.userId, inputSummary: title,
        })
      } catch (e) {
        aiError = errMsg(e).slice(0, 500)
        aiModel = process.env.OPENROUTER_MODEL_COMPLIANCE || aiModel
        const usage = (e as { usage?: { totalTokens?: number; costUsd?: number } }).usage
        await logAIJob({
          organizationId: ctx.orgId, projectId, jobType: 'COMPLIANCE_CHECK', modelProvider: 'openrouter', modelName: aiModel || 'unknown',
          status: 'FAILED', tokenUsed: usage?.totalTokens, estimatedCost: usage?.costUsd, errorMessage: aiError, createdById: ctx.userId, inputSummary: title,
        })
      }
    }

    const { level, score } = scoreRisk(findings)
    const row = await prisma.complianceCheck.create({
      data: {
        organizationId: ctx.orgId,
        industry,
        articleSource: source,
        articleId,
        ownerLabel,
        title,
        contentHash: contentHash(text),
        contentSnapshot: text,
        riskLevel: level,
        riskScore: score,
        summary,
        findings: JSON.stringify(findings),
        rulesSnapshot: JSON.stringify(rules.map(ruleSnapshot)),
        aiUsed,
        aiModel,
        aiError,
        status: 'PENDING_REVIEW',
        createdById: ctx.userId,
      },
    })
    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, action: 'CHECK_RUN', checkId: row.id,
      detail: { industry, source, riskLevel: level, riskScore: score, findings: findings.length, aiUsed, aiError, rules: rules.length },
    })
    const names = await userNames([row.createdById])
    return NextResponse.json({
      check: {
        ...row,
        findings,
        rulesSnapshot: parseJsonArray(row.rulesSnapshot),
        createdByName: names.get(row.createdById) ?? '',
        reviewedByName: '',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
