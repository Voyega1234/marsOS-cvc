/**
 * Compliance — Brand Rule (pure functions) — Run: npx tsx src/lib/compliance/brand.test.ts
 */
import assert from 'node:assert/strict'
import {
  BRAND_FILE_MAX_CHARS, BRAND_NAME_MAX, BRAND_NOTES_MAX, BRAND_VOICE_MAX,
  brandIndustryKey, buildBrandRuleSet, buildVoiceGuide, sanitizeBrandInput, sanitizeBrandRuleInput, sanitizeFileInput, voiceRule,
  type OwnRuleRow,
} from './brand'
import type { RuleLite } from './types'

let n = 0
function t(name: string, fn: () => void): void {
  fn()
  n++
  console.log(`  ok ${name}`)
}

function own(over: Partial<OwnRuleRow>): OwnRuleRow {
  return {
    id: 'o1', code: 'B-1', title: 'กฎ', description: '', ruleType: 'PROHIBITED_TERM', terms: ['xyz'],
    severity: 'HIGH', guidance: '', sourceName: '', version: 1, status: 'ACTIVE', ...over,
  }
}
function lib(over: Partial<RuleLite>): RuleLite {
  return {
    id: 'L1', version: 2, industry: 'beauty_clinic', code: 'BC-1', title: 'คลัง', description: '', ruleType: 'RISKY_TERM',
    terms: ['yzw'], severity: 'LOW', guidance: '', sourceName: 'src', sourceUrl: '', sourceRef: '', effectiveDate: null, ...over,
  }
}

// sanitizeBrandInput
t('brand: trims name and collapses spaces', () => {
  assert.equal(sanitizeBrandInput({ name: '  Acme    Co   Ltd ' }).name, 'Acme Co Ltd')
})
t('brand: name capped', () => {
  assert.equal(sanitizeBrandInput({ name: 'a'.repeat(BRAND_NAME_MAX + 50) }).name?.length, BRAND_NAME_MAX)
})
t('brand: voice and notes capped', () => {
  const o = sanitizeBrandInput({ voice: 'v'.repeat(BRAND_VOICE_MAX + 5), notes: 'n'.repeat(BRAND_NOTES_MAX + 5) })
  assert.equal(o.voice?.length, BRAND_VOICE_MAX)
  assert.equal(o.notes?.length, BRAND_NOTES_MAX)
})
t('brand: industry forced to [a-z0-9_]', () => {
  assert.equal(sanitizeBrandInput({ industry: ' Beauty-Clinic ก_9 ' }).industry, 'beautyclinic_9')
})
t('brand: unknown status dropped, valid kept', () => {
  assert.equal('status' in sanitizeBrandInput({ status: 'DELETED' }), false)
  assert.equal(sanitizeBrandInput({ status: 'ARCHIVED' }).status, 'ARCHIVED')
})
t('brand: absent keys stay absent', () => {
  assert.deepEqual(sanitizeBrandInput({}), {})
  assert.deepEqual(Object.keys(sanitizeBrandInput({ name: 'A' })), ['name'])
})
t('brand: non-string values ignored', () => {
  assert.deepEqual(sanitizeBrandInput({ name: 5, voice: null }), {})
})

// sanitizeBrandRuleInput
t('rule: title required', () => {
  const r = sanitizeBrandRuleInput({ title: '   ', terms: ['abc'] })
  assert.ok('error' in r)
})
t('rule: term rule needs a term', () => {
  assert.ok('error' in sanitizeBrandRuleInput({ title: 'T', ruleType: 'PROHIBITED_TERM', terms: [] }))
  assert.ok('error' in sanitizeBrandRuleInput({ title: 'T', ruleType: 'RISKY_TERM' }))
})
t('rule: CONTEXT rule needs a description', () => {
  assert.ok('error' in sanitizeBrandRuleInput({ title: 'T', ruleType: 'CONTEXT' }))
  assert.ok('data' in sanitizeBrandRuleInput({ title: 'T', ruleType: 'CONTEXT', description: 'ห้ามพูด' }))
})
t('rule: an over-long term is refused, a 200-character one is kept', () => {
  assert.ok('error' in sanitizeBrandRuleInput({ title: 'T', terms: ['ok', 'ก'.repeat(201)] }))
  const r = sanitizeBrandRuleInput({ title: 'T', terms: ['ก'.repeat(200)] })
  assert.ok('data' in r)
})
t('rule: terms from a string', () => {
  const r = sanitizeBrandRuleInput({ title: 'T', terms: 'alpha\nbeta' })
  assert.ok('data' in r)
  if ('data' in r) assert.deepEqual(r.data.terms, ['alpha', 'beta'])
})
t('rule: terms from an array', () => {
  const r = sanitizeBrandRuleInput({ title: 'T', terms: ['alpha', 7, 'beta'] })
  assert.ok('data' in r)
  if ('data' in r) assert.deepEqual(r.data.terms, ['alpha', 'beta'])
})
t('rule: invalid ruleType / severity fall back', () => {
  const r = sanitizeBrandRuleInput({ title: 'T', terms: ['abc'], ruleType: 'NOPE', severity: 'EXTREME' })
  assert.ok('data' in r)
  if ('data' in r) {
    assert.equal(r.data.ruleType, 'PROHIBITED_TERM')
    assert.equal(r.data.severity, 'MEDIUM')
  }
})
t('rule: length caps', () => {
  const r = sanitizeBrandRuleInput({
    title: 't'.repeat(500), terms: ['abc'], description: 'd'.repeat(5000), guidance: 'g'.repeat(5000),
    code: 'c'.repeat(100), sourceName: 's'.repeat(900),
  })
  assert.ok('data' in r)
  if ('data' in r) {
    assert.equal(r.data.title.length, 300)
    assert.equal(r.data.description.length, 4000)
    assert.equal(r.data.guidance.length, 4000)
    assert.equal(r.data.code.length, 40)
    assert.equal(r.data.sourceName.length, 500)
  }
})

// sanitizeFileInput
t('file: too short rejected', () => {
  assert.ok('error' in sanitizeFileInput({ fileName: 'a.txt', text: 'short' }))
  assert.ok('error' in sanitizeFileInput({ fileName: 'a.txt' }))
})
t('file: truncation flag at max chars', () => {
  const exact = sanitizeFileInput({ text: 'x'.repeat(BRAND_FILE_MAX_CHARS) })
  const over = sanitizeFileInput({ text: 'x'.repeat(BRAND_FILE_MAX_CHARS + 10) })
  assert.ok('truncated' in exact && 'truncated' in over)
  if ('truncated' in exact) assert.equal(exact.truncated, false)
  if ('truncated' in over) {
    assert.equal(over.truncated, true)
    assert.equal(over.text.length, BRAND_FILE_MAX_CHARS)
  }
})
t('file: slashes removed from file name', () => {
  const r = sanitizeFileInput({ fileName: 'a/b\\c.txt', text: 'x'.repeat(30) })
  assert.ok('fileName' in r)
  if ('fileName' in r) assert.equal(r.fileName, 'a-b-c.txt')
})
t('file: default name', () => {
  const r = sanitizeFileInput({ text: 'x'.repeat(30) })
  assert.ok('fileName' in r)
  if ('fileName' in r) assert.equal(r.fileName, 'brand-voice.txt')
})

// buildBrandRuleSet
t('set: inactive own rule skipped', () => {
  const r = buildBrandRuleSet({ brandId: 'b1', brandName: 'Acme', own: [own({ status: 'INACTIVE' })], links: [], library: [] })
  assert.equal(r.rules.length, 0)
})
t('set: inactive link skipped and not counted', () => {
  const r = buildBrandRuleSet({ brandId: 'b1', brandName: 'Acme', own: [], links: [{ id: 'k1', libraryRuleId: 'L1', status: 'INACTIVE' }], library: [lib({})] })
  assert.equal(r.rules.length, 0)
  assert.equal(r.skippedLibrary, 0)
})
t('set: link whose library rule is not ACTIVE counted as skipped', () => {
  const r = buildBrandRuleSet({ brandId: 'b1', brandName: 'Acme', own: [], links: [{ id: 'k1', libraryRuleId: 'GONE', status: 'ACTIVE' }], library: [lib({})] })
  assert.equal(r.rules.length, 0)
  assert.equal(r.skippedLibrary, 1)
})
t('set: duplicate link not doubled', () => {
  const r = buildBrandRuleSet({
    brandId: 'b1', brandName: 'Acme', own: [],
    links: [{ id: 'k1', libraryRuleId: 'L1', status: 'ACTIVE' }, { id: 'k2', libraryRuleId: 'L1', status: 'ACTIVE' }],
    library: [lib({})],
  })
  assert.equal(r.rules.length, 1)
})
t('set: own rule gets brand industry key and default sourceName', () => {
  const r = buildBrandRuleSet({ brandId: 'b1', brandName: 'Acme', own: [own({})], links: [], library: [] })
  assert.equal(r.rules[0].industry, brandIndustryKey('b1'))
  assert.ok(r.rules[0].sourceName.includes('Acme'))
})
t('set: own rule keeps explicit sourceName and default code', () => {
  const r = buildBrandRuleSet({ brandId: 'b1', brandName: 'Acme', own: [own({ sourceName: 'คู่มือ', code: '' })], links: [], library: [] })
  assert.equal(r.rules[0].sourceName, 'คู่มือ')
  assert.equal(r.rules[0].code, 'BRAND')
})
t('set: result sorted by code', () => {
  const r = buildBrandRuleSet({
    brandId: 'b1', brandName: 'Acme',
    own: [own({ id: 'o2', code: 'Z-9' }), own({ id: 'o1', code: 'A-1' })],
    links: [{ id: 'k1', libraryRuleId: 'L1', status: 'ACTIVE' }],
    library: [lib({ code: 'M-5' })],
  })
  assert.deepEqual(r.rules.map((x) => x.code), ['A-1', 'M-5', 'Z-9'])
})

// buildVoiceGuide
t('guide: voice first then files in order', () => {
  const g = buildVoiceGuide('เสียงแบรนด์', [{ fileName: 'a.txt', text: 'AAA' }, { fileName: 'b.txt', text: 'BBB' }])
  const iv = g.guide.indexOf('เสียงแบรนด์')
  const ia = g.guide.indexOf('AAA')
  const ib = g.guide.indexOf('BBB')
  assert.ok(iv >= 0 && iv < ia && ia < ib)
  assert.equal(g.truncated, false)
  assert.equal(g.sources.length, 3)
})
t('guide: budget truncation sets truncated and used', () => {
  const g = buildVoiceGuide('v'.repeat(10), [{ fileName: 'a.txt', text: 'a'.repeat(10) }, { fileName: 'b.txt', text: 'b'.repeat(10) }], 15)
  assert.equal(g.truncated, true)
  assert.deepEqual(g.sources.map((s) => s.used), [10, 5, 0])
  assert.ok(!g.guide.includes('bbbb'))
})
t('guide: empty inputs give empty guide', () => {
  const g = buildVoiceGuide('', [])
  assert.equal(g.guide, '')
  assert.equal(g.truncated, false)
  assert.deepEqual(g.sources, [])
})
t('guide: whitespace-only file ignored', () => {
  const g = buildVoiceGuide('voice', [{ fileName: 'blank.txt', text: '   \n  ' }])
  assert.equal(g.sources.length, 1)
  assert.ok(!g.guide.includes('blank.txt'))
})

// voiceRule / brandIndustryKey
t('voiceRule: id, type and no terms', () => {
  const v = voiceRule('b1', 'Acme')
  assert.equal(v.id, 'brand-voice:b1')
  assert.equal(v.ruleType, 'CONTEXT')
  assert.deepEqual(v.terms, [])
  assert.equal(v.industry, brandIndustryKey('b1'))
  assert.ok(v.title.includes('Acme'))
})
t('brandIndustryKey: unique per brand and contains id', () => {
  assert.notEqual(brandIndustryKey('b1'), brandIndustryKey('b2'))
  assert.ok(brandIndustryKey('b1').endsWith('b1'))
})

console.log(`${n} passed`)
