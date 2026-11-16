import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'
import { prisma } from '@/lib/prisma'
import { orChat, OR_MODELS, type ORUsage } from '@/lib/openrouter'
import { extractJson } from '@/lib/compliance/ai'
import { htmlToText } from '@/lib/compliance/engine'
import { audit, errMsg, requireStaff } from '@/lib/compliance/server'
import { logAIJob } from '@/lib/logAIJob'
import { safeFetchDocument } from '@/lib/upload-article/safe-fetch'
import {
  FILL_JOB_TYPE, FILL_MIN_SOURCE_CHARS, FILL_SYSTEM_PROMPT, buildFillUserPrompt, capSourceText,
  decodeHtmlBytes, isPdfBytes, linkLabel, nextRuleCode, sanitizeFill,
} from '@/lib/compliance/rule-fill'
import { BUILTIN_INDUSTRIES, RULE_EDITOR_ROLES, industryLabel } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const MAX_LINK_BYTES = 8_000_000
const MAX_TEXT_CHARS = 400_000
const TOO_LITTLE_FILE_TEXT = 'อ่านข้อความจากไฟล์ได้น้อยเกินไป — ถ้าเป็นไฟล์สแกน ให้กดอ่านด้วย AI ตอนแนบไฟล์'

/** ข้อความที่แสดงให้ผู้ใช้ได้ตรง ๆ — ตอบกลับโดยไม่เรียก AI และไม่ลง AI Cost */
class SourceError extends Error {
  status: number
  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
}

/** อ่านเอกสารจากลิงก์ → ข้อความล้วน (ผ่าน SSRF guard ทุก hop) */
async function readLink(rawUrl: string): Promise<{ text: string; finalUrl: string }> {
  let url = rawUrl.trim().slice(0, 2000)
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SourceError('ลิงก์ไม่ถูกต้อง', 400)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new SourceError('ลิงก์ไม่ถูกต้อง', 400)

  const r = await safeFetchDocument(parsed.toString(), MAX_LINK_BYTES)
  if (!r.ok) {
    const err = r.error ?? ''
    if (r.blocked && err.startsWith('HTTP ')) {
      throw new SourceError(`เว็บนี้ไม่ให้ระบบเข้าอ่าน (${err}) — เปิดหน้าเว็บเอง บันทึกเป็น PDF แล้วแนบไฟล์แทน`)
    }
    // ไม่ส่งเหตุผลของ guard กลับไป
    if (r.blocked) throw new SourceError('ลิงก์นี้ระบบเปิดอ่านไม่ได้ (ที่อยู่นี้ไม่อนุญาต)')
    if (err === 'too large') throw new SourceError('ไฟล์จากลิงก์ใหญ่เกิน 8 MB — ดาวน์โหลดแล้วแนบไฟล์แทน')
    if (err === 'timeout') throw new SourceError('เว็บตอบช้าเกินไป — ลองใหม่ หรือดาวน์โหลดแล้วแนบไฟล์แทน')
    throw new SourceError(`เปิดลิงก์ไม่สำเร็จ (${err})`)
  }

  const ctype = r.contentType.toLowerCase()
  if (isPdfBytes(r.bytes) || ctype.includes('pdf')) {
    let text = ''
    try {
      const data = await pdfParse(Buffer.from(r.bytes), { max: 80 })
      text = data.text ?? ''
    } catch {
      throw new SourceError('อ่าน PDF จากลิงก์ไม่สำเร็จ — ดาวน์โหลดแล้วแนบไฟล์แทน')
    }
    if (text.trim().length < FILL_MIN_SOURCE_CHARS) {
      throw new SourceError('PDF นี้เป็นภาพสแกน ไม่มีข้อความให้อ่าน — ดาวน์โหลดแล้วแนบไฟล์แทน ระบบจะให้ AI อ่านทีละหน้า')
    }
    return { text, finalUrl: r.finalUrl }
  }
  if (!ctype || /text\/|application\/(?:xhtml|xml|json)|\+xml|\+json/i.test(ctype)) {
    const decoded = decodeHtmlBytes(r.bytes, r.contentType)
    const text = ctype.startsWith('text/plain') || ctype.startsWith('text/csv') ? decoded : htmlToText(decoded)
    if (text.trim().length < FILL_MIN_SOURCE_CHARS) {
      throw new SourceError('อ่านเนื้อหาจากหน้านี้ได้น้อยเกินไป (หน้าอาจโหลดด้วย JavaScript) — บันทึกหน้าเป็น PDF แล้วแนบไฟล์แทน')
    }
    return { text, finalUrl: r.finalUrl }
  }
  throw new SourceError(`ลิงก์นี้เป็นไฟล์ชนิด ${r.contentType.split(';')[0]} — ดาวน์โหลดแล้วแนบไฟล์แทน`)
}

/**
 * ให้ AI อ่านลิงก์หรือไฟล์ที่แนบ แล้วเสนอค่าที่จะกรองในฟอร์มกฎ
 * route นี้ไม่บันทึกอะไรลงตารางกฎ — คืนเฉพาะข้อเสนอ คนต้องตรวจและกดบันทึกเอง
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    if (!RULE_EDITOR_ROLES.includes(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = (await req.json().catch(() => ({}))) as { url?: unknown; text?: unknown; fileName?: unknown; industry?: unknown }
    const preferredIndustry = typeof body.industry === 'string' ? body.industry.trim().slice(0, 60) : ''
    const today = new Date().toISOString().slice(0, 10)

    let kind: 'file' | 'link'
    let label: string
    let url = ''
    let text: string
    let cap: ReturnType<typeof capSourceText>
    try {
      if (typeof body.text === 'string' && body.text.trim()) {
        const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'ไฟล์แนบ'
        text = body.text.slice(0, MAX_TEXT_CHARS)
        kind = 'file'
        label = fileName
      } else if (typeof body.url === 'string' && body.url.trim()) {
        const r = await readLink(body.url)
        text = r.text
        kind = 'link'
        url = r.finalUrl
        label = linkLabel(r.finalUrl)
      } else {
        throw new SourceError('ต้องวางลิงก์หรือแนบไฟล์', 400)
      }
      cap = capSourceText(text)
      if (cap.text.trim().length < (kind === 'file' ? 30 : FILL_MIN_SOURCE_CHARS)) {
        throw new SourceError(kind === 'file' ? TOO_LITTLE_FILE_TEXT : 'อ่านเนื้อหาจากลิงก์ได้น้อยเกินไป — ดาวน์โหลดแล้วแนบไฟล์แทน')
      }
    } catch (e) {
      if (e instanceof SourceError) return NextResponse.json({ error: e.message }, { status: e.status })
      throw e
    }

    // อุตสาหกรรมที่เลือกได้ = ของระบบ + ที่องค์กรมีกฎ ACTIVE/DRAFT · รหัสกฎดูจากทุกสถานะ กันชนกับกฎที่เก็บแล้ว
    const ruleRows = await prisma.complianceRule.findMany({
      where: { organizationId: ctx.orgId },
      select: { industry: true, code: true, status: true },
    })
    const keys = BUILTIN_INDUSTRIES.map((i) => i.key)
    for (const r of ruleRows) {
      if ((r.status === 'ACTIVE' || r.status === 'DRAFT') && !keys.includes(r.industry)) keys.push(r.industry)
    }
    const industries = keys.map((key) => ({ key, label: industryLabel(key) }))
    const codesByIndustry = new Map<string, string[]>()
    for (const r of ruleRows) {
      const list = codesByIndustry.get(r.industry) ?? []
      list.push(r.code)
      codesByIndustry.set(r.industry, list)
    }

    const model = OR_MODELS.default()
    const inputSummary = `${kind === 'link' ? 'กรอกกฎจากลิงก์' : 'กรอกกฎจากไฟล์'}: ${label}`.slice(0, 200)
    const jobBase = {
      organizationId: ctx.orgId, jobType: FILL_JOB_TYPE, modelProvider: 'openrouter', modelName: model,
      createdById: ctx.userId, inputSummary,
    }

    let res: Awaited<ReturnType<typeof orChat>>
    try {
      res = await orChat({
        trace: 'compliance_rule_fill',
        model,
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 12000,
        timeoutMs: 120_000,
        messages: [
          { role: 'system', content: FILL_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildFillUserPrompt({
              today, industries, preferredIndustry, sourceLabel: label, text: cap.text, truncated: cap.truncated,
            }),
          },
        ],
      })
    } catch (e) {
      const usage = (e as Error & { usage?: ORUsage }).usage
      await logAIJob({
        ...jobBase, status: 'FAILED', errorMessage: errMsg(e).slice(0, 500),
        ...(usage ? { tokenUsed: usage.totalTokens, estimatedCost: usage.costUsd, externalCalls: 1 } : {}),
      })
      return NextResponse.json({ error: `AI อ่านไม่สำเร็จ: ${errMsg(e)}` }, { status: 502 })
    }

    let raw: unknown
    try {
      raw = extractJson(res.text)
    } catch (e) {
      // คำขอนี้ถูกเรียกเก็บเงินแล้ว จึงบันทึกต้นทุนแม้อ่านคำตอบไม่ได้
      await logAIJob({
        ...jobBase, status: 'FAILED', errorMessage: errMsg(e).slice(0, 500),
        tokenUsed: res.usage.totalTokens, estimatedCost: res.usage.costUsd, externalCalls: 1,
      })
      return NextResponse.json({ error: 'AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้ ลองกดอีกครั้ง' }, { status: 502 })
    }

    const { rules, note } = sanitizeFill({
      raw, today, sourceText: cap.text, industries: industries.map((i) => i.key),
      forcedSourceUrl: kind === 'link' ? url : undefined,
    })

    // ออกรหัสกฎ: ชุดรหัสที่ใช้แล้วของแต่ละอุตสาหกรรมใช้ร่วมกันทั้งคำตอบ ข้อเสนอสองข้อจึงไม่ได้รหัสซ้ำ
    const takenByIndustry = new Map<string, Set<string>>()
    for (const rule of rules) {
      const target = rule.industry || preferredIndustry
      if (!target) continue
      const existing = codesByIndustry.get(target) ?? []
      let taken = takenByIndustry.get(target)
      if (!taken) {
        taken = new Set(existing.map((c) => c.toLowerCase()))
        takenByIndustry.set(target, taken)
      }
      rule.code = nextRuleCode(existing, taken)
    }

    await logAIJob({
      ...jobBase, status: 'SUCCESS',
      tokenUsed: res.usage.totalTokens, estimatedCost: res.usage.costUsd, externalCalls: 1,
    })
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: 'AI_FILL_RUN',
      detail: { source: kind, label, model, rules: rules.length, costUsd: Math.round(res.usage.costUsd * 10000) / 10000 },
    })
    return NextResponse.json({
      rules, note, truncated: cap.truncated, sourceChars: cap.chars,
      source: { kind, label, url }, model, costUsd: res.usage.costUsd,
    })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
