/**
 * Compliance engine — ล้วน (pure) ไม่มี prisma/next
 * จับคำตามกฎ, รวมผลที่ AI ตัดสินบริบท, ให้คะแนนความเสี่ยง
 */
import type { Finding, RiskLevel, RuleLite, Severity, Verdict } from './types'

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'",
}

/**
 * Replace every `<tag ...>...</tag>` block with one space.
 * Same result as `/<tag[\s\S]*?<\/tag\s*>/gi`, but one pass: that regex rescans the rest of the
 * document from every opening tag that has no closing tag, which is quadratic on hostile HTML.
 */
function stripBlocks(s: string, tag: 'script' | 'style'): string {
  const open = new RegExp(`<${tag}`, 'gi')
  const close = new RegExp(`</${tag}\\s*>`, 'gi')
  let out = ''
  let pos = 0
  for (;;) {
    open.lastIndex = pos
    const start = open.exec(s)
    if (!start) break
    close.lastIndex = start.index + tag.length + 1
    const end = close.exec(s)
    // No closing tag after this opening tag means none after any later one either
    if (!end) break
    out += s.slice(pos, start.index) + ' '
    pos = close.lastIndex
  }
  return pos === 0 ? s : out + s.slice(pos)
}

/** Remove every `<...>` tag. Same result as `/<[^>]*>/g`, in one pass (see stripBlocks). */
function stripTags(s: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const start = s.indexOf('<', pos)
    if (start < 0) break
    const end = s.indexOf('>', start + 1)
    if (end < 0) break
    out += s.slice(pos, start)
    pos = end + 1
  }
  return pos === 0 ? s : out + s.slice(pos)
}

export function htmlToText(html: string): string {
  let s = String(html ?? '')
  s = stripBlocks(stripBlocks(s, 'script'), 'style')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|table|section|article|blockquote|header|footer|figure|figcaption|details|summary)\s*>/gi, '\n')
  s = stripTags(s)
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

const FIX_TARGET_MAX = 600
const FIX_REPLACEMENT_MAX = 1000
// ตัวอักษรควบคุมที่ไม่ใช่ช่องว่าง — ถ้าหลุดไปถึงไฟล์ Word จะทำให้ XML เสีย
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F]/g

/** ข้อเสนอแก้ของ AI (target → replacement) สำหรับทำ Suggesting ตอน export Word
 *  target ต้องเป็นข้อความที่มีอยู่จริงในบทความ (เทียบแบบเดียวกับ quote) — หาไม่เจอ = ไม่มีข้อเสนอแก้ ไม่เดาเอง
 *  mustContain: target ของคำที่จับได้ต้องครอบคำนั้น · fallback: ใช้แทนเมื่อ target ของ AI ใช้ไม่ได้ */
function pickFix(
  rec: Record<string, unknown>,
  norm: string,
  haystack: string,
  opts: { mustContain?: string; fallback?: string },
): { fixTarget: string; replacement: string } | null {
  const replacement = collapse(str(rec.replacement, FIX_REPLACEMENT_MAX).replace(CONTROL_CHARS, ' '))
  if (!replacement) return null
  const must = opts.mustContain ? lowerSameLength(collapse(opts.mustContain)) : ''
  const candidates = [typeof rec.target === 'string' ? collapse(rec.target) : '', opts.fallback ? collapse(opts.fallback) : '']
  for (const c of candidates) {
    if (c.length < 2 || c.length > FIX_TARGET_MAX) continue
    const t = lowerSameLength(c)
    if (must && !t.includes(must)) continue
    const idx = haystack.indexOf(t)
    if (idx < 0) continue
    const fixTarget = norm.slice(idx, idx + t.length)
    if (fixTarget === replacement) return null
    return { fixTarget, replacement }
  }
  return null
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
  const norm = collapse(text)
  const haystack = lowerSameLength(norm)

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
      const fix = hit.verdict === 'likely_ok' ? null : pickFix(rec, norm, haystack, { mustContain: hit.quote })
      if (fix) { hit.fixTarget = fix.fixTarget; hit.replacement = fix.replacement }
    }
  }

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
      const fix = pickFix(rec, norm, haystack, { fallback: quote })
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
        ...(fix ? { fixTarget: fix.fixTarget, replacement: fix.replacement } : {}),
      })
    }
  }

  // คำสะกด: ต่อท้ายหลังผลตามกฎที่ตัดเพดานแล้ว — ไม่เบียดที่ของรายการตามกฎ
  const spelling = parseSpelling(raw.spelling, norm, haystack)
  dropped += spelling.dropped
  return { findings: [...findings.slice(0, MAX_FINDINGS), ...spelling.findings], summary: str(raw.summary, 2000), dropped }
}

/** กฎเทียมของการตรวจคำสะกด — ไม่อยู่ในตารางกฎ ไม่นับคะแนนความเสี่ยง */
export const SPELLING_RULE = {
  id: '__spelling__',
  code: 'SPELLING',
  title: 'คำสะกดผิด / ไม่ตรงราชบัณฑิต',
  sourceName: 'พจนานุกรมฉบับราชบัณฑิตยสถาน (ตรวจโดย AI)',
  sourceUrl: 'https://dictionary.orst.go.th/',
} as const
const MAX_SPELLING = 20

function parseSpelling(list: unknown, norm: string, haystack: string): { findings: Finding[]; dropped: number } {
  const out: Finding[] = []
  let dropped = 0
  if (!Array.isArray(list)) return { findings: out, dropped }
  const seen = new Set<string>()
  for (const s of list) {
    if (out.length >= MAX_SPELLING) break
    if (!s || typeof s !== 'object') { dropped++; continue }
    const rec = s as Record<string, unknown>
    const quote = typeof rec.quote === 'string' ? collapse(rec.quote) : ''
    const correct = collapse(str(rec.correct, 200).replace(CONTROL_CHARS, ' '))
    const q = lowerSameLength(quote)
    if (quote.length < 2 || quote.length > 80 || !correct || lowerSameLength(correct) === q || !haystack.includes(q)) { dropped++; continue }
    // ข้อเสนอแก้ต้องครอบคำที่ผิด และต้องมีคำที่ถูกอยู่ในข้อความใหม่ — ไม่งั้นไม่ทำ tracked change
    let fix = pickFix(rec, norm, haystack, { mustContain: quote })
    if (fix && !lowerSameLength(fix.replacement).includes(lowerSameLength(correct))) fix = null
    if (!fix) fix = pickFix({ replacement: correct }, norm, haystack, { fallback: quote })
    const anchor = lowerSameLength(fix?.fixTarget ?? quote)
    const key = `${anchor}\u0000${lowerSameLength(correct)}`
    if (seen.has(key)) continue
    seen.add(key)
    const idx = Math.max(0, haystack.indexOf(anchor))
    const qi = haystack.indexOf(q, idx)
    const at = qi >= 0 ? qi : haystack.indexOf(q)
    const start = Math.max(0, at - EXCERPT_RADIUS)
    const end = Math.min(haystack.length, at + q.length + EXCERPT_RADIUS)
    out.push({
      id: `s${out.length + 1}`,
      ruleId: SPELLING_RULE.id,
      ruleVersion: 1,
      ruleCode: SPELLING_RULE.code,
      ruleTitle: SPELLING_RULE.title,
      severity: 'LOW',
      origin: 'spelling',
      term: '',
      quote: norm.slice(at, at + q.length),
      excerpt: `${start > 0 ? '…' : ''}${norm.slice(start, end)}${end < norm.length ? '…' : ''}`,
      reason: str(rec.reason) || `ควรสะกดว่า "${correct}"`,
      suggestion: `ควรสะกดว่า "${correct}"`,
      verdict: 'needs_review',
      sourceName: SPELLING_RULE.sourceName,
      sourceRef: '',
      sourceUrl: SPELLING_RULE.sourceUrl,
      ...(fix ? { fixTarget: fix.fixTarget, replacement: fix.replacement } : {}),
    })
  }
  return { findings: out, dropped }
}

const WEIGHT: Record<Severity, number> = { CRITICAL: 40, HIGH: 20, MEDIUM: 8, LOW: 3 }
const ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export function scoreRisk(findings: Finding[]): { level: RiskLevel; score: number } {
  let sum = 0
  let top = -1
  for (const f of findings) {
    // คำสะกดผิดไม่ใช่ความเสี่ยงทางกฎหมาย
    if (f.verdict === 'likely_ok' || f.origin === 'spelling') continue
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
