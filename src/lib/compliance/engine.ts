/**
 * Compliance engine — ล้วน (pure) ไม่มี prisma/next
 * จับคำตามกฎ, รวมผลที่ AI ตัดสินบริบท, ให้คะแนนความเสี่ยง
 */
import type { Finding, RiskLevel, RuleLite, Severity, Verdict } from './types'

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'",
}

export function htmlToText(html: string): string {
  let s = String(html ?? '')
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|table|section|article|blockquote|header|footer|figure|figcaption|details|summary)\s*>/gi, '\n')
  s = s.replace(/<[^>]*>/g, '')
  s = s.replace(/&#(\d+);/g, (_m, n: string) => {
    const code = Number(n)
    try { return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ' } catch { return ' ' }
  })
  s = s.replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => {
    const code = parseInt(n, 16)
    try { return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ' } catch { return ' ' }
  })
  s = s.replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_m, n: string) => NAMED_ENTITIES[n.toLowerCase()] ?? ' ')
  s = s.replace(/[ \t\f\v ]+/g, ' ')
  s = s.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

export function parseTerms(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of String(input ?? '').split(/[\n,]/)) {
    const t = raw.trim()
    if (t.length < 2) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/** NFC + ตัด zero-width */
export function normalizeText(s: string): string {
  return String(s ?? '').normalize('NFC').replace(/[​-‍﻿]/g, '')
}

function lowerSameLength(s: string): string {
  const lowered = s.toLowerCase()
  if (lowered.length === s.length) return lowered
  return Array.from(s).map((c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c }).join('')
}

function collapse(s: string): string {
  return normalizeText(s).replace(/\s+/g, ' ').trim()
}

const ASCII_TERM = /^[A-Za-z0-9 \-%]+$/
const ALNUM = /[A-Za-z0-9]/
const MAX_HITS_PER_TERM = 5
const EXCERPT_RADIUS = 60

export function findTermHits(text: string, rules: RuleLite[]): Finding[] {
  const norm = normalizeText(text)
  const lower = lowerSameLength(norm)
  const out: Finding[] = []
  let n = 0
  for (const rule of rules) {
    for (const term of rule.terms ?? []) {
      const t = normalizeText(term).trim()
      if (!t) continue
      const needle = lowerSameLength(t)
      const bounded = ASCII_TERM.test(t)
      let from = 0
      let count = 0
      while (count < MAX_HITS_PER_TERM) {
        const idx = lower.indexOf(needle, from)
        if (idx < 0) break
        from = idx + needle.length
        if (bounded) {
          const before = idx > 0 ? lower[idx - 1] : ''
          const after = from < lower.length ? lower[from] : ''
          if ((before && ALNUM.test(before)) || (after && ALNUM.test(after))) continue
        }
        count++
        n++
        const start = Math.max(0, idx - EXCERPT_RADIUS)
        const end = Math.min(norm.length, from + EXCERPT_RADIUS)
        const excerpt = `${start > 0 ? '…' : ''}${norm.slice(start, end).replace(/\s+/g, ' ')}${end < norm.length ? '…' : ''}`
        out.push({
          id: `h${n}`,
          ruleId: rule.id,
          ruleVersion: rule.version,
          ruleCode: rule.code,
          ruleTitle: rule.title,
          severity: rule.severity,
          origin: 'rule',
          term,
          quote: norm.slice(idx, from),
          excerpt,
          reason: rule.description,
          suggestion: rule.guidance,
          verdict: rule.ruleType === 'PROHIBITED_TERM' ? 'violation' : 'needs_review',
          sourceName: rule.sourceName,
          sourceRef: rule.sourceRef,
          sourceUrl: rule.sourceUrl,
        })
      }
    }
  }
  return out
}

const VERDICTS: Verdict[] = ['violation', 'needs_review', 'likely_ok']
const MAX_FINDINGS = 40

function str(v: unknown, max = 1000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function mergeAiResult(
  text: string,
  hits: Finding[],
  rules: RuleLite[],
  aiRaw: unknown,
): { findings: Finding[]; summary: string; dropped: number } {
  const raw = aiRaw && typeof aiRaw === 'object' ? (aiRaw as Record<string, unknown>) : {}
  const ruleById = new Map(rules.map((r) => [r.id, r]))
  const findings: Finding[] = hits.map((h) => ({ ...h }))
  const byId = new Map(findings.map((f) => [f.id, f]))

  if (Array.isArray(raw.adjudications)) {
    for (const a of raw.adjudications) {
      if (!a || typeof a !== 'object') continue
      const rec = a as Record<string, unknown>
      const hit = typeof rec.hitId === 'string' ? byId.get(rec.hitId) : undefined
      if (!hit) continue
      const reason = str(rec.reason)
      const suggestion = str(rec.suggestion)
      if (reason) hit.reason = reason
      if (suggestion) hit.suggestion = suggestion
      if (typeof rec.verdict === 'string' && VERDICTS.includes(rec.verdict as Verdict)) {
        let verdict = rec.verdict as Verdict
        const rule = ruleById.get(hit.ruleId)
        if (verdict === 'likely_ok' && rule && rule.ruleType === 'PROHIBITED_TERM' && rule.severity === 'CRITICAL') {
          verdict = 'needs_review'
        }
        hit.verdict = verdict
      }
    }
  }

  const haystack = lowerSameLength(collapse(text))
  let dropped = 0
  let a = 0
  if (Array.isArray(raw.findings)) {
    for (const f of raw.findings) {
      if (!f || typeof f !== 'object') { dropped++; continue }
      const rec = f as Record<string, unknown>
      const rule = typeof rec.ruleId === 'string' ? ruleById.get(rec.ruleId) : undefined
      const quote = typeof rec.quote === 'string' ? collapse(rec.quote) : ''
      if (!rule || quote.length < 4 || !haystack.includes(lowerSameLength(quote))) { dropped++; continue }
      const q = lowerSameLength(quote)
      const covered = findings.some((x) => {
        if (x.ruleId !== rule.id) return false
        const hq = lowerSameLength(collapse(x.quote))
        return hq.length > 0 && (q.includes(hq) || hq.includes(q))
      })
      if (covered) continue
      a++
      const idx = haystack.indexOf(q)
      const start = Math.max(0, idx - EXCERPT_RADIUS)
      const end = Math.min(haystack.length, idx + q.length + EXCERPT_RADIUS)
      const norm = collapse(text)
      findings.push({
        id: `a${a}`,
        ruleId: rule.id,
        ruleVersion: rule.version,
        ruleCode: rule.code,
        ruleTitle: rule.title,
        severity: rule.severity,
        origin: 'ai',
        term: '',
        quote: norm.slice(idx, idx + q.length),
        excerpt: `${start > 0 ? '…' : ''}${norm.slice(start, end)}${end < norm.length ? '…' : ''}`,
        reason: str(rec.reason) || rule.description,
        suggestion: str(rec.suggestion) || rule.guidance,
        verdict: 'needs_review',
        sourceName: rule.sourceName,
        sourceRef: rule.sourceRef,
        sourceUrl: rule.sourceUrl,
      })
    }
  }

  return { findings: findings.slice(0, MAX_FINDINGS), summary: str(raw.summary, 2000), dropped }
}

const WEIGHT: Record<Severity, number> = { CRITICAL: 40, HIGH: 20, MEDIUM: 8, LOW: 3 }
const ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export function scoreRisk(findings: Finding[]): { level: RiskLevel; score: number } {
  let sum = 0
  let top = -1
  for (const f of findings) {
    if (f.verdict === 'likely_ok') continue
    const w = WEIGHT[f.severity] ?? 0
    sum += f.verdict === 'needs_review' ? w / 2 : w
    const i = ORDER.indexOf(f.severity)
    if (i >= 0 && (top < 0 || i < top)) top = i
  }
  return { level: top < 0 ? 'NONE' : ORDER[top], score: Math.min(100, Math.round(sum)) }
}

export function activationProblems(rule: {
  title?: string
  sourceName?: string
  effectiveDate?: string | Date | null
  ruleType?: string
  terms?: string[]
}): string[] {
  const out: string[] = []
  if (!String(rule.title ?? '').trim()) out.push('ต้องระบุชื่อกฎ')
  const src = String(rule.sourceName ?? '').trim()
  if (!src) out.push('ต้องระบุแหล่งอ้างอิง (ชื่อประกาศ/กฎหมาย)')
  else if (src.startsWith('(ต้องยืนยัน)')) out.push('แหล่งอ้างอิงยังขึ้นต้นด้วย "(ต้องยืนยัน)" — ตรวจสอบกับเอกสารจริงแล้วลบคำนี้ออกก่อนเปิดใช้')
  if (!rule.effectiveDate) out.push('ต้องระบุวันที่มีผลบังคับใช้')
  if ((rule.ruleType === 'PROHIBITED_TERM' || rule.ruleType === 'RISKY_TERM') && !(rule.terms ?? []).length) {
    out.push('กฎประเภทคำต้องห้าม/คำเสี่ยงต้องมีอย่างน้อย 1 คำ')
  }
  return out
}

export function ruleSnapshot(rule: RuleLite): Record<string, unknown> {
  return {
    id: rule.id,
    version: rule.version,
    industry: rule.industry,
    code: rule.code,
    title: rule.title,
    description: rule.description,
    ruleType: rule.ruleType,
    terms: rule.terms,
    severity: rule.severity,
    guidance: rule.guidance,
    sourceName: rule.sourceName,
    sourceUrl: rule.sourceUrl,
    sourceRef: rule.sourceRef,
    effectiveDate: rule.effectiveDate,
  }
}

export function contentHash(text: string): string {
  let h = 0x811c9dc5
  const s = String(text ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
