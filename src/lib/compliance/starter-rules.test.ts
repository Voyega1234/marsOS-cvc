/**
 * Compliance starter rules — Run: npx tsx src/lib/compliance/starter-rules.test.ts
 */
import { STARTER_RULES, starterEffectiveDate, type StarterRule } from './starter-rules'
import { activationProblems, parseTerms } from './engine'
import { BUILTIN_INDUSTRIES } from './types'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

const UNVERIFIED = '(ต้องยืนยัน)'
const industries = Object.keys(STARTER_RULES)
const builtinKeys: string[] = BUILTIN_INDUSTRIES.map((i) => i.key)
const all: Array<{ industry: string; rule: StarterRule }> = []
for (const industry of industries) for (const rule of STARTER_RULES[industry]) all.push({ industry, rule })

function probs(rule: StarterRule): string[] {
  return activationProblems({
    title: rule.title, sourceName: rule.sourceName, effectiveDate: starterEffectiveDate(rule), ruleType: rule.ruleType, terms: rule.terms,
  })
}
// collect failures so one assertion reports every offender
function check(label: string, bad: string[]): void {
  if (bad.length) bad.forEach((b) => console.log(`    ✗ ${b}`))
  assert(bad.length === 0, label)
}

// 1. industries
{
  check('every STARTER_RULES key is a builtin industry', industries.filter((k) => !builtinKeys.includes(k)).map((k) => `unknown industry ${k}`))
  check('every builtin industry has a starter set', builtinKeys.filter((k) => !(STARTER_RULES[k]?.length > 0)).map((k) => `missing ${k}`))
}

// 2. codes
{
  const bad: string[] = []
  for (const industry of industries) {
    const seen = new Set<string>()
    for (const r of STARTER_RULES[industry]) {
      if (!r.code || r.code.length > 40) bad.push(`${industry}: bad code "${r.code}"`)
      if (seen.has(r.code)) bad.push(`${industry}: duplicate code ${r.code}`)
      seen.add(r.code)
    }
  }
  check('codes non-empty, <= 40 chars, unique per industry', bad)
}

// 3. lengths
{
  const bad: string[] = []
  for (const { industry, rule: r } of all) {
    const id = `${industry}/${r.code}`
    if (r.title.length < 1 || r.title.length > 300) bad.push(`${id}: title length`)
    if (r.description.length > 4000) bad.push(`${id}: description length`)
    if (r.guidance.length > 4000) bad.push(`${id}: guidance length`)
    if (r.sourceName.length < 1 || r.sourceName.length > 500) bad.push(`${id}: sourceName length`)
    if ((r.sourceRef ?? '').length > 300) bad.push(`${id}: sourceRef length`)
    if (r.sourceUrl !== undefined && r.sourceUrl !== '' && (r.sourceUrl.length > 1000 || !r.sourceUrl.startsWith('https://'))) bad.push(`${id}: sourceUrl "${r.sourceUrl}"`)
  }
  check('field length limits and https sourceUrl', bad)
}

// 4. enums
{
  const bad: string[] = []
  for (const { industry, rule: r } of all) {
    if (!['PROHIBITED_TERM', 'RISKY_TERM', 'CONTEXT'].includes(r.ruleType)) bad.push(`${industry}/${r.code}: ruleType ${r.ruleType}`)
    if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(r.severity)) bad.push(`${industry}/${r.code}: severity ${r.severity}`)
  }
  check('ruleType and severity are valid enums', bad)
}

// 5. terms
{
  const bad: string[] = []
  for (const { industry, rule: r } of all) {
    const id = `${industry}/${r.code}`
    if ((r.ruleType === 'PROHIBITED_TERM' || r.ruleType === 'RISKY_TERM') && r.terms.length < 1) bad.push(`${id}: needs >= 1 term`)
    const round = parseTerms(r.terms.join('\n'))
    if (JSON.stringify(round) !== JSON.stringify(r.terms)) {
      bad.push(`${id}: terms change under parseTerms (lost: ${r.terms.filter((t) => !round.includes(t)).map((t) => JSON.stringify(t)).join(', ')})`)
    }
  }
  check('term rules have terms and every term survives parseTerms unchanged', bad)
}

// 6. overlaps within an industry
{
  const violations: string[] = []
  for (const industry of industries) {
    const entries: Array<{ term: string; code: string; ruleIdx: number; termIdx: number }> = []
    STARTER_RULES[industry].forEach((r, ruleIdx) => r.terms.forEach((t, termIdx) => {
      entries.push({ term: t.normalize('NFC').toLowerCase(), code: r.code, ruleIdx, termIdx })
    }))
    for (let i = 0; i < entries.length; i++) {
      for (let j = 0; j < entries.length; j++) {
        if (i === j) continue
        const a = entries[i]
        const b = entries[j]
        if (a.term === b.term) {
          if (i < j && a.ruleIdx !== b.ruleIdx) violations.push(`${industry}: "${a.term}" (${a.code}) is duplicated in ${b.code}`)
        } else if (b.term.includes(a.term)) {
          violations.push(`${industry}: "${a.term}" (${a.code}) is inside "${b.term}" (${b.code})`)
        }
      }
    }
  }
  console.log(`  overlap violations: ${violations.length}`)
  violations.forEach((v) => console.log(`    ✗ ${v}`))
  assert(violations.length === 0, 'no duplicate or nested terms within an industry')
}

// 7. dates
{
  const bad: string[] = []
  for (const { industry, rule: r } of all) {
    const id = `${industry}/${r.code}`
    const d = starterEffectiveDate(r)
    if (r.effectiveDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effectiveDate)) bad.push(`${id}: date format ${r.effectiveDate}`)
      else if (!d || d.toISOString().slice(0, 10) !== r.effectiveDate) bad.push(`${id}: date does not round-trip ${r.effectiveDate}`)
    } else if (d !== null) bad.push(`${id}: expected null date`)
  }
  check('effectiveDate format and starterEffectiveDate round-trip', bad)
  const base = all[0].rule
  assert(starterEffectiveDate({ ...base, effectiveDate: '2026-13-40' }) === null, 'starterEffectiveDate rejects 2026-13-40')
  assert(starterEffectiveDate({ ...base, effectiveDate: '16/01/2026' }) === null, 'starterEffectiveDate rejects 16/01/2026')
  assert(starterEffectiveDate({ ...base, effectiveDate: undefined }) === null, 'starterEffectiveDate null when absent')
}

// 8. unverified sources
{
  const bad: string[] = []
  for (const { industry, rule: r } of all) {
    if (!r.sourceName.startsWith(UNVERIFIED)) continue
    if (r.effectiveDate) bad.push(`${industry}/${r.code}: unverified source but has effectiveDate`)
    if (probs(r).length === 0) bad.push(`${industry}/${r.code}: unverified source but activatable`)
  }
  check('(ต้องยืนยัน) rules have no date and are drafts', bad)
}

// 9. verified + dated
{
  const bad: string[] = []
  for (const { industry, rule: r } of all) {
    if (r.effectiveDate && !r.sourceName.startsWith(UNVERIFIED) && probs(r).length > 0) bad.push(`${industry}/${r.code}: ${probs(r).join(' | ')}`)
  }
  check('dated verified rules have zero activationProblems', bad)
}

// 10. per-industry activatable
{
  const bad: string[] = []
  for (const industry of industries) {
    const n = STARTER_RULES[industry].filter((r) => probs(r).length === 0).length
    if (industry === 'gambling') { if (n !== 0) bad.push(`gambling has ${n} activatable rules, expected 0`) }
    else if (n < 1) bad.push(`${industry}: no activatable rule`)
  }
  check('each industry except gambling has >= 1 activatable rule; gambling has 0', bad)
}

// table
{
  let tt = 0
  let ta = 0
  console.log('\nindustry: total / activatable / draft')
  for (const industry of industries) {
    const total = STARTER_RULES[industry].length
    const act = STARTER_RULES[industry].filter((r) => probs(r).length === 0).length
    tt += total
    ta += act
    console.log(`${industry}: ${total} / ${act} / ${total - act}`)
  }
  console.log(`TOTAL: ${tt} / ${ta} / ${tt - ta}`)
}

console.log(`\n${passed} passed`)
