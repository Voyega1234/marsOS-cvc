/**
 * Compliance engine — Run: npx tsx src/lib/compliance/engine.test.ts
 */
import { activationProblems, contentHash, findTermHits, htmlToText, mergeAiResult, parseTerms, scoreRisk } from './engine'
import type { Finding, RuleLite } from './types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

function rule(over: Partial<RuleLite>): RuleLite {
  return {
    id: 'r1', version: 1, industry: 'beauty_clinic', code: 'BC-002', title: 'การันตี', description: 'ห้ามรับประกัน',
    ruleType: 'PROHIBITED_TERM', terms: ['การันตี'], severity: 'CRITICAL', guidance: 'ใช้ถ้อยคำเป็นกลาง',
    sourceName: 'แหล่ง', sourceUrl: '', sourceRef: 'ข้อ 1', effectiveDate: '2025-01-01', ...over,
  }
}
function finding(over: Partial<Finding>): Finding {
  return {
    id: 'h1', ruleId: 'r1', ruleVersion: 1, ruleCode: 'X', ruleTitle: 'X', severity: 'HIGH', origin: 'rule', term: 't',
    quote: 'q', excerpt: 'e', reason: '', suggestion: '', verdict: 'violation', sourceName: '', sourceRef: '', sourceUrl: '', ...over,
  }
}

// htmlToText
{
  const t = htmlToText('<style>a{}</style><p>สวัสดี&nbsp;&amp;&lt;ครับ</p><script>x()</script><p>บรรทัด2<br>ต่อ &#65;&#39;</p>')
  assert(!t.includes('a{}') && !t.includes('x()'), 'htmlToText drops script/style')
  assert(t.includes('สวัสดี &<ครับ'), 'htmlToText decodes entities')
  assert(t.includes('\n') && t.includes("A'"), 'htmlToText block newlines + numeric entities')
}

// parseTerms
{
  const t = parseTerms('ดีที่สุด, ดีที่สุด\nBest,best\nx\n  \nอันดับ 1')
  assert(t.length === 3 && t[0] === 'ดีที่สุด' && t[1] === 'Best' && t[2] === 'อันดับ 1', 'parseTerms splits, drops short, dedupes case-insensitively')
}

// term hits
{
  const hits = findTermHits('คลินิกเรา การันตี ผลลัพธ์', [rule({})])
  assert(hits.length === 1 && hits[0].quote === 'การันตี' && hits[0].verdict === 'violation', 'Thai substring hit -> violation')
  assert(hits[0].id === 'h1' && hits[0].origin === 'rule' && hits[0].reason === 'ห้ามรับประกัน', 'hit fields')
  const r2 = rule({ id: 'r2', ruleType: 'RISKY_TERM', terms: ['best'] })
  assert(findTermHits('we bestow gifts', [r2]).length === 0, 'ASCII boundary: best does not hit bestow')
  assert(findTermHits('This is the Best, really', [r2]).length === 1, 'ASCII term hits with boundaries, case-insensitive')
  assert(findTermHits('การั​นตี', [rule({})]).length === 1, 'zero-width chars removed')
  const many = findTermHits('การันตี '.repeat(9), [rule({})])
  assert(many.length === 5, 'cap of 5 hits per (rule, term)')
  const long = 'ก'.repeat(100) + 'การันตี' + 'ข'.repeat(100)
  const ex = findTermHits(long, [rule({})])[0].excerpt
  assert(ex.startsWith('…') && ex.endsWith('…') && ex.includes('การันตี'), 'excerpt has ellipsis when cut')
  assert(findTermHits('x การันตี y', [rule({})])[0].excerpt === 'x การันตี y', 'excerpt not cut for short text')
  assert(findTermHits('ลองดู', [rule({ ruleType: 'CONTEXT', terms: ['ลอง'] })])[0].verdict === 'needs_review', 'CONTEXT -> needs_review')
}

// scoreRisk
{
  assert(scoreRisk([]).level === 'NONE', 'scoreRisk empty = NONE')
  assert(scoreRisk([finding({ severity: 'CRITICAL', verdict: 'violation' })]).score === 40, 'CRITICAL = 40')
  const half = scoreRisk([finding({ severity: 'HIGH', verdict: 'needs_review' })])
  assert(half.score === 10 && half.level === 'HIGH', 'needs_review counts half')
  assert(scoreRisk([finding({ severity: 'CRITICAL', verdict: 'likely_ok' })]).level === 'NONE', 'likely_ok ignored')
  const mix = scoreRisk([finding({ severity: 'LOW' }), finding({ severity: 'MEDIUM' })])
  assert(mix.level === 'MEDIUM' && mix.score === 11, 'level = highest severity, sums weights')
  const cap = scoreRisk(Array.from({ length: 5 }, () => finding({ severity: 'CRITICAL' })))
  assert(cap.score === 100, 'score capped at 100')
}

// mergeAiResult
{
  const text = 'เราการันตีผลลัพธ์ 100% และมีโปรโมชันพิเศษสำหรับทุกคน'
  const rules = [rule({}), rule({ id: 'r3', ruleType: 'CONTEXT', severity: 'HIGH', terms: [], code: 'BC-007' })]
  const hits = findTermHits(text, rules)
  const m = mergeAiResult(text, hits, rules, {
    adjudications: [{ hitId: 'h1', verdict: 'likely_ok', reason: 'ปฏิเสธ', suggestion: 'เขียนใหม่' }],
    findings: [
      { ruleId: 'nope', quote: 'โปรโมชันพิเศษ', reason: 'x', suggestion: 'y' },
      { ruleId: 'r3', quote: 'ข้อความที่ไม่มีในบทความ', reason: 'x', suggestion: 'y' },
      { ruleId: 'r3', quote: 'ผล', reason: 'x', suggestion: 'y' },
      { ruleId: 'r3', quote: 'โปรโมชันพิเศษ', reason: 'เสี่ยง', suggestion: 'ปรับ' },
    ],
    summary: 'สรุป',
  })
  assert(m.dropped === 3, 'hallucinated rule, missing quote and short quote dropped')
  assert(m.findings[0].verdict === 'needs_review', 'CRITICAL prohibited cannot become likely_ok')
  assert(m.findings[0].reason === 'ปฏิเสธ' && m.findings[0].suggestion === 'เขียนใหม่', 'adjudication reason/suggestion applied')
  const ai = m.findings.filter((f) => f.origin === 'ai')
  assert(ai.length === 1 && ai[0].id === 'a1' && ai[0].severity === 'HIGH' && ai[0].verdict === 'needs_review', 'valid AI finding accepted')
  assert(m.summary === 'สรุป', 'summary passed through')
  const ok = mergeAiResult(text, [finding({ id: 'h1', ruleId: 'r9' })], [rule({ id: 'r9', severity: 'HIGH', ruleType: 'RISKY_TERM' })], {
    adjudications: [{ hitId: 'h1', verdict: 'likely_ok', reason: 'ok', suggestion: '' }],
  })
  assert(ok.findings[0].verdict === 'likely_ok', 'non-critical hit can become likely_ok')
  const bad = mergeAiResult(text, hits, rules, 'garbage')
  assert(bad.findings.length === hits.length && bad.dropped === 0, 'unknown AI shape ignored')
}

// activationProblems
{
  assert(activationProblems(rule({})).length === 0, 'complete rule has no problems')
  const p = activationProblems(rule({ sourceName: '(ต้องยืนยัน) ประกาศ', effectiveDate: null, terms: [] }))
  assert(p.length === 3, 'unverified source + no date + no terms = 3 problems')
  assert(activationProblems(rule({ ruleType: 'CONTEXT', terms: [] })).length === 0, 'CONTEXT rule does not need terms')
  assert(activationProblems(rule({ title: ' ' })).length === 1, 'missing title')
}

assert(contentHash('abc') === contentHash('abc') && contentHash('abc') !== contentHash('abd'), 'contentHash stable')

console.log(`\n${passed} passed`)
