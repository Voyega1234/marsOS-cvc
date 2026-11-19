// Sample-size test (pure parts): npx tsx src/lib/brand-radar/sample-test.test.ts
import { compare, planBatches, summarize, type AskResult } from './sample-test'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}
function truthy(v: unknown, msg: string) {
  if (!v) throw new Error(`FAIL: ${msg}`)
  passed++
}

function ask(mentioned: boolean, extra: Partial<Extract<AskResult, { ok: true }>> = {}): AskResult {
  return { ok: true, brandMentioned: mentioned, brandRecommended: false, positionPct: null, competitors: [], domains: [], ownCited: false, costUsd: 0.004, answer: 'x', ...extra }
}
function set(total: number, mentioned: number): AskResult[] {
  return Array.from({ length: total }, (_, i) => ask(i < mentioned))
}

// failed asks count toward cost but not toward rates
const s = summarize([
  ask(true, { positionPct: 0.2, competitors: ['B'], domains: ['a.com'], ownCited: true, brandRecommended: true }),
  ask(false, { positionPct: null, competitors: ['B', 'C'], domains: ['a.com', 'z.com'] }),
  ask(true, { positionPct: 0.4 }),
  { ok: false, error: 'boom', costUsd: 0.004 },
])
eq([s.asked, s.answered, s.failed], [4, 3, 1], 'counts')
truthy(Math.abs((s.mentionRate as number) - 2 / 3) < 1e-9, 'mention rate over answered only')
truthy(Math.abs((s.recommendRate as number) - 1 / 3) < 1e-9, 'recommend rate')
truthy(Math.abs((s.avgPositionPct as number) - 0.3) < 1e-9, 'avg position ignores nulls')
eq(s.competitors.map((c) => [c.name, c.count]), [['B', 2], ['C', 1]], 'competitors sorted')
eq(s.domains.map((d) => [d.domain, d.count]), [['a.com', 2], ['z.com', 1]], 'domains sorted')
truthy(Math.abs(s.costUsd - 0.016) < 1e-9, 'cost includes failed asks')

// empty set
const empty = summarize([])
eq([empty.asked, empty.mentionRate, empty.marginPp, empty.avgPositionPct], [0, null, null, null], 'empty set')
eq(summarize([{ ok: false, error: 'e', costUsd: 0 }]).mentionRate, null, 'all failed gives null rate')

// Wilson margin
const m10 = summarize(set(10, 5)).marginPp as number
const m30 = summarize(set(30, 15)).marginPp as number
truthy(m10 > 26 && m10 < 31, `n=10 margin ${m10}`)
truthy(m30 < m10, 'larger n gives smaller margin')

// compare
eq(compare(summarize(set(10, 5)), summarize(set(10, 5))).verdict, 'no_clear_difference', 'identical sets')
const diff = compare(summarize(set(20, 2)), summarize(set(20, 18)))
eq(diff.verdict, 'different', 'clearly different sets')
eq(diff.rows[0].likelyNoise, false, 'mention row is a real gap')
eq(compare(summarize([]), summarize(set(5, 2))).verdict, 'not_enough_data', 'empty side')
const ent = compare(summarize([ask(true, { competitors: ['Only A'] })]), summarize([ask(true, { competitors: ['Only B'] })]))
eq([ent.onlyInA, ent.onlyInB], [['Only A'], ['Only B']], 'only-in lists')

// planBatches
const plan = planBatches(10, 20)
eq(plan.reduce((t, b) => t + (b.set === 'A' ? b.asks : 0), 0), 10, 'A total')
eq(plan.reduce((t, b) => t + (b.set === 'B' ? b.asks : 0), 0), 20, 'B total')
eq(plan.map((b) => b.set).join(''), 'AABBBB', 'A before B')
eq(planBatches(3, 7).map((b) => b.asks), [3, 5, 2], 'remainder batch')

console.log(`sample-test: ${passed} assertions passed`)
