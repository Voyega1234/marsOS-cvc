// Brand Radar untracked brands: npx tsx src/lib/brand-radar/untracked-brands.test.ts
import { computeUntrackedBrands, normalizeBrandKey } from './untracked-brands'
import type { OtherEntity, ProviderKey } from './types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

const tag = (name: string, category = '', domain = ''): OtherEntity => ({ name, category, domain })
const R = (id: string, promptId = 'p1', provider: ProviderKey = 'openai') => ({ id, promptId, provider })
const prompts = [{ id: 'p1', text: 'Q1' }, { id: 'p2', text: 'Q2' }, { id: 'p3', text: 'Q3' }, { id: 'p4', text: 'Q4' }]
const run = (extras: Record<string, OtherEntity[]>, responses: ReturnType<typeof R>[], trackedNames: string[] = [], extra: { trackedDomains?: string[]; limit?: number } = {}) =>
  computeUntrackedBrands({ extras: new Map(Object.entries(extras)), responses, prompts, trackedNames, ...extra })

// empty
eq(run({}, []), { taggedAnswers: 0, rows: [] }, 'empty input')

// distinct answers, duplicates in one answer
{
  const r = run({ a1: [tag('Acme'), tag('Acme')], a2: [tag('Acme')], a3: [] }, [R('a1'), R('a2', 'p2'), R('a3')])
  eq(r.taggedAnswers, 2, 'taggedAnswers')
  eq(r.rows.length, 1, 'one row')
  eq(r.rows[0].answers, 2, 'distinct answers')
  eq(r.rows[0].prompts, 2, 'distinct prompts')
}

// answers outside responses ignored
{
  const r = run({ a1: [tag('Acme')], zz: [tag('Acme'), tag('Other')] }, [R('a1')])
  eq(r.taggedAnswers, 1, 'outside ignored (tagged)')
  eq(r.rows.map((x) => x.name), ['Acme'], 'outside ignored (rows)')
}

// exclusions
{
  const r = run(
    { a1: [tag('Shopee Thailand'), tag('Airline'), tag('LINE'), tag('Foo', '', 'www.shop.example.com'), tag('Bar', '', 'other.com'), tag('  '), tag('ไลน์แมน')] },
    [R('a1')],
    ['Shopee', 'Line', 'ไลน์'],
    { trackedDomains: ['example.com'] },
  )
  eq(r.rows.map((x) => x.name).sort(), ['Airline', 'Bar', 'ไลน์แมน'], 'exclusion rules')
  const r2 = run({ a1: [tag('Shopee')] }, [R('a1')], ['Shopee Thailand'])
  eq(r2.rows, [], 'tracked tokens inside tag, reversed')
  const r3 = run({ a1: [tag('Notexample', '', 'notexample.com')] }, [R('a1')], [], { trackedDomains: ['example.com'] })
  eq(r3.rows.length, 1, 'similar-looking domain is not a subdomain')
}

// normalisation
eq(normalizeBrandKey('  ＡＢＣ   Shop! '), 'abc shop', 'width / case / punctuation')
{
  const r = run({ a1: [tag('ACME')], a2: [tag('acme')], a3: [tag('Acme')], a4: [tag('ＡＣＭＥ')] }, [R('a1'), R('a2'), R('a3'), R('a4')])
  eq(r.rows.length, 1, 'grouped')
  eq(r.rows[0].name, 'ACME', 'most common spelling, ties first seen')
  eq(r.rows[0].answers, 4, 'grouped answers')
}
{
  const r = run({ a1: [tag('Acme', 'Retail', 'acme.com')], a2: [tag('Acme', '', 'acme.com')], a3: [tag('Acme', 'Shop', '')] }, [R('a1'), R('a2'), R('a3')])
  eq([r.rows[0].category, r.rows[0].domain], ['Retail', 'acme.com'], 'category / domain')
  const r2 = run({ a1: [tag('Acme')] }, [R('a1')])
  eq([r2.rows[0].category, r2.rows[0].domain], ['', ''], 'empty when none')
}

// providers, samples
{
  const r = run(
    { a1: [tag('Acme')], a2: [tag('Acme')], a3: [tag('Acme')], a4: [tag('Acme')], a5: [tag('Acme')] },
    [R('a1', 'p1', 'gemini'), R('a2', 'p2'), R('a3', 'p2'), R('a4', 'p3'), R('a5', 'ghost')],
  )
  eq(r.rows[0].providers, ['openai', 'gemini'], 'providers stable order')
  eq(r.rows[0].samplePrompts.map((s) => s.promptId), ['p2', 'p1', 'p3'], 'samples by answers, unknown skipped')
}

// sort and cap
{
  const extras: Record<string, OtherEntity[]> = {
    a1: [tag('B'), tag('A'), tag('C')], a2: [tag('B'), tag('A')], a3: [tag('C')], a4: [tag('D')],
  }
  const rs = [R('a1', 'p1'), R('a2', 'p1'), R('a3', 'p2'), R('a4', 'p1')]
  const r = run(extras, rs)
  eq(r.rows.map((x) => x.name), ['C', 'A', 'B', 'D'], 'answers desc, prompts desc, name asc')
  eq(run(extras, rs, [], { limit: 2 }).rows.map((x) => x.name), ['C', 'A'], 'limit')
  const many: Record<string, OtherEntity[]> = { m1: Array.from({ length: 30 }, (_, i) => tag(`Brand${i}`)) }
  eq(run(many, [R('m1')]).rows.length, 20, 'default cap 20')
}

console.log(`untracked-brands: ${passed} checks passed`)
