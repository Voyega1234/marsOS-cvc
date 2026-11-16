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

  // Malformed HTML keeps the behaviour of the regexes the one-pass version replaced
  assert(htmlToText('a<SCRIPT type="x">1</ScRiPt >b<style>2</STYLE\n>c') === 'a b c', 'htmlToText script/style blocks are case-insensitive')
  assert(htmlToText('a<script>1</script>b<script>2') === 'a b2', 'htmlToText unclosed script: only the tag is dropped')
  assert(htmlToText('a<b>c</b> d < e') === 'ac d < e', 'htmlToText lone "<" is kept')
  assert(htmlToText('x<a href="1>2">y') === 'x2">y', 'htmlToText tag ends at the first ">"')

  // Hostile pages (unclosed tags repeated) must not take quadratic time
  const started = Date.now()
  htmlToText('<script'.repeat(300_000))
  htmlToText('<style '.repeat(300_000))
  htmlToText('<'.repeat(2_000_000))
  assert(Date.now() - started < 5000, 'htmlToText stays linear on repeated unclosed tags')
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

// mergeAiResult — ข้อเสนอแก้ (fixTarget / replacement) สำหรับ Suggesting
{
  const text = 'สินค้านี้ดีมาก  เราการันตีผลลัพธ์ 100% ทุกกรณี\nและมีโปรโมชันพิเศษสำหรับทุกคน ไม่การันตีผลในบางราย'
  const rules = [
    rule({ severity: 'HIGH', ruleType: 'RISKY_TERM' }),
    rule({ id: 'r3', ruleType: 'CONTEXT', severity: 'HIGH', terms: [], code: 'BC-007' }),
  ]
  const hits = findTermHits(text, rules)
  assert(hits.length >= 2, 'two hits for the fix test')
  const m = mergeAiResult(text, hits, rules, {
    adjudications: [
      { hitId: hits[0].id, verdict: 'violation', reason: 'r', suggestion: 's', target: 'เราการันตีผลลัพธ์  100% ทุกกรณี', replacement: ' ผลลัพธ์ขึ้นอยู่กับ\nแต่ละบุคคล ' },
      { hitId: hits[1].id, verdict: 'likely_ok', reason: 'ปฏิเสธ', suggestion: '', target: 'ไม่การันตีผลในบางราย', replacement: 'x' },
    ],
    findings: [
      { ruleId: 'r3', quote: 'โปรโมชันพิเศษ', reason: 'x', suggestion: 'y', target: 'มีโปรโมชันพิเศษสำหรับทุกคน', replacement: 'มีข้อเสนอสำหรับลูกค้า' },
      { ruleId: 'r3', quote: 'สินค้านี้ดีมาก', reason: 'x', suggestion: 'y', target: 'ข้อความที่ไม่มีในบทความ', replacement: 'สินค้านี้มีคุณภาพ' },
      { ruleId: 'r3', quote: 'ทุกกรณี', reason: 'x', suggestion: 'y', replacement: 'ทุกกรณี' },
    ],
  })
  const h0 = m.findings[0]
  assert(h0.fixTarget === 'เราการันตีผลลัพธ์ 100% ทุกกรณี', 'hit target stored as the article text (whitespace collapsed)')
  assert(h0.replacement === 'ผลลัพธ์ขึ้นอยู่กับ แต่ละบุคคล', 'replacement trimmed and kept on one line')
  assert(m.findings[1].fixTarget === undefined && m.findings[1].replacement === undefined, 'likely_ok hit gets no fix')
  const ai = m.findings.filter((f) => f.origin === 'ai')
  assert(ai[0].fixTarget === 'มีโปรโมชันพิเศษสำหรับทุกคน' && ai[0].replacement === 'มีข้อเสนอสำหรับลูกค้า', 'AI finding keeps a valid target')
  assert(ai[1].fixTarget === 'สินค้านี้ดีมาก' && ai[1].replacement === 'สินค้านี้มีคุณภาพ', 'unknown target falls back to the quote')
  assert(ai[2].fixTarget === undefined && ai[2].replacement === undefined, 'replacement equal to the target is not a fix')

  const loose = mergeAiResult(text, hits, rules, {
    adjudications: [
      { hitId: hits[0].id, verdict: 'violation', reason: 'r', suggestion: 's', target: 'มีโปรโมชันพิเศษสำหรับทุกคน', replacement: 'y' },
    ],
  })
  assert(loose.findings[0].fixTarget === undefined, 'hit target that does not contain the hit is rejected')

  const ctl = mergeAiResult(text, hits, rules, {
    findings: [{ ruleId: 'r3', quote: 'โปรโมชันพิเศษ', reason: 'x', suggestion: 'y', target: 'มีโปรโมชันพิเศษสำหรับทุกคน', replacement: 'มีข้อเสนอ\u0001สำหรับ\u001Fลูกค้า\u0000' }],
  })
  const cf = ctl.findings.filter((f) => f.origin === 'ai')[0]
  assert(cf.replacement === 'มีข้อเสนอ สำหรับ ลูกค้า', 'control characters in a replacement become spaces')
  const noRep = mergeAiResult(text, hits, rules, {
    adjudications: [{ hitId: hits[0].id, verdict: 'violation', reason: 'r', suggestion: 's', target: 'เราการันตีผลลัพธ์ 100% ทุกกรณี' }],
  })
  assert(noRep.findings[0].fixTarget === undefined, 'target without replacement is not a fix')
}

// mergeAiResult — คำสะกด (spelling)
{
  const text = 'ดาวน์โหลดแอพของเราได้ฟรี ส่งอีเมล์มาหาเรา แอพนี้ใช้ง่าย'
  const rules = [rule({ id: 'r1' })]
  const m = mergeAiResult(text, [], rules, {
    findings: [],
    spelling: [
      { quote: 'แอพ', correct: 'แอป', reason: 'ราชบัณฑิตกำหนดให้เขียน แอป', target: 'ดาวน์โหลดแอพของเรา', replacement: 'ดาวน์โหลดแอปของเรา' },
      { quote: 'อีเมล์', correct: 'อีเมล', target: 'ส่งอีเมล์มาหา', replacement: 'ส่งอีเมลมาหาเธอ' },
      { quote: 'แอพ', correct: 'แอป', target: 'แอพนี้ใช้ง่าย', replacement: 'แอปนี้ใช้ง่าย' },
      { quote: 'แอพ', correct: 'แอป', target: 'ดาวน์โหลดแอพของเรา', replacement: 'ดาวน์โหลดแอปของเรา' },
      { quote: 'ไม่มีในบทความ', correct: 'x' },
      { quote: 'ฟรี', correct: 'ฟรี' },
      { quote: 'แอพ', target: 'แอพนี้', replacement: 'แอปนี้' },
    ],
  })
  const sp = m.findings.filter((f) => f.origin === 'spelling')
  assert(sp.length === 3, 'spelling: 3 valid entries kept, duplicate place skipped')
  assert(sp[0].ruleCode === 'SPELLING' && sp[0].severity === 'LOW' && sp[0].verdict === 'needs_review', 'spelling: pseudo rule fields')
  assert(sp[0].fixTarget === 'ดาวน์โหลดแอพของเรา' && sp[0].replacement === 'ดาวน์โหลดแอปของเรา', 'spelling: phrase-level tracked change')
  assert(sp[0].suggestion.includes('แอป') && sp[0].reason.includes('ราชบัณฑิต'), 'spelling: suggestion names correct form')
  assert(sp[1].fixTarget!.includes('อีเมล์'), 'spelling: fixTarget contains the misspelling')
  assert(sp[2].excerpt.includes('แอพนี้'), 'spelling: excerpt points at the reported place')
  assert(m.dropped === 3, 'spelling: missing/unchanged/no-correct entries dropped')

  const noFix = mergeAiResult(text, [], rules, { spelling: [{ quote: 'อีเมล์', correct: 'อีเมล', target: 'ไม่มีจริง', replacement: 'x' }] })
  const nf = noFix.findings[0]
  assert(nf.fixTarget === 'อีเมล์' && nf.replacement === 'อีเมล', 'spelling: falls back to word-level fix when target invalid')
  const wrongRep = mergeAiResult(text, [], rules, { spelling: [{ quote: 'อีเมล์', correct: 'อีเมล', target: 'ส่งอีเมล์มาหา', replacement: 'ส่งจดหมายมาหา' }] })
  assert(wrongRep.findings[0].fixTarget === 'อีเมล์', 'spelling: replacement without the correct word is not trusted')

  // ผลตามกฎ 40 รายการไม่ถูกเบียด + คำสะกดไม่นับคะแนน
  const manyHits = Array.from({ length: 45 }, (_, i) => finding({ id: `h${i}`, quote: 'การันตี' }))
  const many = mergeAiResult('การันตี '.repeat(50), manyHits, rules, {
    spelling: [{ quote: 'การันตี', correct: 'การันตี้' }],
  })
  assert(many.findings.filter((f) => f.origin !== 'spelling').length === 40 && many.findings.some((f) => f.origin === 'spelling'), 'spelling: appended after 40 rule findings')
  assert(scoreRisk(sp).level === 'NONE' && scoreRisk(sp).score === 0, 'spelling: not counted in risk score')
  const notSp = mergeAiResult(text, [], rules, { spelling: 'garbage' })
  assert(notSp.findings.length === 0, 'spelling: non-array ignored')
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
