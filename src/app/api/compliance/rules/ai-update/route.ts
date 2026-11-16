import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { orChat, OR_MODELS } from '@/lib/openrouter'
import { extractJson } from '@/lib/compliance/ai'
import { audit, errMsg, requireStaff, toRuleLite } from '@/lib/compliance/server'
import { logAIJob } from '@/lib/logAIJob'
import {
  UPDATE_SYSTEM_PROMPT, buildUpdateUserPrompt, groupRulesBySource, mapLimit, validateProposals,
  type RuleForUpdate,
} from '@/lib/compliance/rule-update'
import {
  RULE_EDITOR_ROLES, industryLabel,
  type RuleStatus, type RuleUpdateProposal, type RuleUpdateResult,
} from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * แหล่งกฎหมายที่ตรวจต่อ 1 ครั้ง: 6 แหล่ง ทีละ 3 แหล่ง
 * แต่ละแหล่งลองค้นด้วย Exa ก่อน (คืนรายการหน้าเว็บที่อ่านจริง — ใช้ยืนยัน "แหล่งน่าเชื่อถือ")
 * ถ้าล้มจึงค้นด้วยตัวค้นของโมเดลเอง ซึ่งไม่คืนรายการหน้าเว็บ ข้อเสนอรอบนั้นจึงต้องให้คนตรวจแหล่งเองทุกข้อ
 * เวลาแย่สุด = 2 ชุด × (80 + 60) วินาที = 280 วินาที — อยู่ใน maxDuration
 */
const MAX_SOURCES = 6
const CONCURRENCY = 3
const TIMEOUT_MS = 80_000
const FALLBACK_TIMEOUT_MS = 60_000

/**
 * ให้ AI อ่านแหล่งกฎหมายล่าสุด (web search) ของอุตสาหกรรมหนึ่ง แล้วเสนอสิ่งที่ควรอัปเดต
 * route นี้ไม่แก้กฎ — คืนเฉพาะข้อเสนอ คนต้องกดยืนยันทีละข้อผ่าน PATCH/POST ของกฎตามปกติ
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!RULE_EDITOR_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = (await req.json().catch(() => ({}))) as { industry?: unknown }
    const industry = typeof body.industry === 'string' ? body.industry.trim().slice(0, 60) : ''
    if (!industry) return NextResponse.json({ error: 'ต้องระบุอุตสาหกรรม' }, { status: 400 })

    const rows = await prisma.complianceRule.findMany({
      where: { organizationId: ctx.orgId, industry, status: { in: ['ACTIVE', 'DRAFT'] } },
      orderBy: { code: 'asc' },
    })
    if (!rows.length) return NextResponse.json({ error: 'อุตสาหกรรมนี้ยังไม่มีกฎให้ตรวจ' }, { status: 400 })

    const rules: RuleForUpdate[] = rows.map((r) => ({ ...toRuleLite(r), status: r.status as RuleStatus }))
    const { groups, skipped } = groupRulesBySource(rules, MAX_SOURCES)
    const model = process.env.OPENROUTER_MODEL_COMPLIANCE || OR_MODELS.default()
    const today = new Date().toISOString().slice(0, 10)
    const label = industryLabel(industry)
    const allCodes = await prisma.complianceRule.findMany({
      where: { organizationId: ctx.orgId, industry },
      select: { code: true },
    })
    const takenCodes = new Set(allCodes.map((r) => r.code.toLowerCase()))

    const results = await mapLimit(groups, CONCURRENCY, async (group) => {
      const ask = async (exa: boolean) => {
        const res = await orChat({
          trace: 'compliance_rule_update',
          model,
          webSearch: true,
          webSearchOptions: exa ? { engine: 'exa', maxResults: 8 } : { maxResults: 8 },
          temperature: 0.1,
          maxTokens: 6000,
          timeoutMs: exa ? TIMEOUT_MS : FALLBACK_TIMEOUT_MS,
          messages: [
            { role: 'system', content: UPDATE_SYSTEM_PROMPT },
            { role: 'user', content: buildUpdateUserPrompt({ industryLabel: label, group, today }) },
          ],
        })
        return { raw: extractJson(res.text), citations: res.citations ?? [], usage: res.usage }
      }
      try {
        return { ok: true as const, group, fallback: false, ...(await ask(true)) }
      } catch {
        try {
          return { ok: true as const, group, fallback: true, ...(await ask(false)) }
        } catch (e) {
          return { ok: false as const, group, error: errMsg(e).slice(0, 300) }
        }
      }
    })

    const failed = results.filter((r) => !r.ok)
    if (failed.length === results.length) {
      const first = failed[0]
      // บันทึกลง AI Cost แม้ล้มทั้งรอบ — OpenRouter ไม่คืนยอดใช้ของคำขอที่ล้ม จึงไม่มีตัวเลขต้นทุน
      await logAIJob({
        organizationId: ctx.orgId, jobType: 'COMPLIANCE_RULE_UPDATE', modelProvider: 'openrouter', modelName: model,
        status: 'FAILED', errorMessage: first && !first.ok ? first.error : 'unknown', createdById: ctx.userId,
        inputSummary: `อัปเดตกฎ: ${label}`,
      })
      return NextResponse.json({ error: `AI ตรวจไม่สำเร็จ: ${first && !first.ok ? first.error : 'unknown'}` }, { status: 502 })
    }

    const proposals: RuleUpdateProposal[] = []
    const summaries: string[] = []
    const errors: string[] = []
    let dropped = 0
    let costUsd = 0
    let tokens = 0
    let citations = 0
    let fallbacks = 0
    // ตรวจทีละแหล่งตามลำดับ เพื่อให้รหัสกฎใหม่ไม่ชนกันข้ามแหล่ง
    results.forEach((r, i) => {
      if (!r.ok) { errors.push(`ตรวจไม่สำเร็จ: ${r.group.sourceName} — ${r.error}`); return }
      const v = validateProposals({
        raw: r.raw, group: r.group, citations: r.citations, takenCodes, today, idPrefix: `s${i + 1}p`,
      })
      proposals.push(...v.proposals)
      dropped += v.dropped
      costUsd += r.usage?.costUsd ?? 0
      tokens += r.usage?.totalTokens ?? 0
      citations += r.citations.length
      if (r.fallback) fallbacks++
      if (v.summary) summaries.push(groups.length > 1 ? `• ${r.group.sourceName}: ${v.summary}` : v.summary)
    })
    if (skipped.length) errors.push(`ยังไม่ได้ตรวจ ${skipped.length} ข้อ เพราะเกิน ${MAX_SOURCES} แหล่งต่อรอบ — เลือกกรองแล้วตรวจอีกครั้ง`)

    const result: RuleUpdateResult = {
      industry,
      model,
      checkedRules: rules.length - skipped.length,
      sources: groups.length,
      summary: summaries.join('\n') || 'ไม่มีสรุปจาก AI',
      proposals,
      dropped,
      errors,
    }
    // 1 รอบ = 1 แถวใน AI Cost (รวมทุกแหล่งที่ตรวจสำเร็จ) — logAIJob ไม่ throw จึงไม่ทำให้ผลตรวจหาย
    await logAIJob({
      organizationId: ctx.orgId, jobType: 'COMPLIANCE_RULE_UPDATE', modelProvider: 'openrouter', modelName: model,
      status: 'SUCCESS', tokenUsed: tokens, estimatedCost: costUsd, externalCalls: results.length - failed.length,
      errorMessage: failed.length ? `ตรวจไม่สำเร็จ ${failed.length} จาก ${results.length} แหล่ง` : undefined,
      createdById: ctx.userId, inputSummary: `อัปเดตกฎ: ${label}`,
    })
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'AI_UPDATE_RUN',
      detail: {
        industry, model, checkedRules: result.checkedRules, sources: result.sources,
        proposals: proposals.length, trusted: proposals.filter((p) => p.trusted).length,
        dropped, failedSources: failed.length, citations, fallbacks, costUsd: Math.round(costUsd * 10000) / 10000,
      },
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
