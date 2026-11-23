// Run: npx tsx src/lib/brand-radar/usage-cost.test.ts
import assert from 'node:assert/strict'
import { costPerCall, dailyUsage, parseUsageRange, USAGE_DAILY_DAYS, USAGE_RANGE_MAX_DAYS } from './types'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
}

test('cost is divided by the calls that got an answer', () => {
  assert.equal(costPerCall(0.4, 100), 0.004)
  assert.equal(costPerCall(0.6, 80, 20), 0.01)
})

test('failed calls are left out of the divisor', () => {
  // 73 calls, 20 failed: the average is over 53, not 73
  assert.equal(costPerCall(0.53, 73, 20), 0.01)
})

test('no answered call gives null, never 0 or Infinity', () => {
  assert.equal(costPerCall(0, 0), null)
  assert.equal(costPerCall(0.5, 10, 10), null)
  assert.equal(costPerCall(0.5, 3, 5), null)
  assert.equal(costPerCall(Number.NaN, 5), null)
})

test('a month with answers and no cost is a real 0', () => {
  assert.equal(costPerCall(0, 12), 0)
})

test('daily usage covers every day of the window, oldest first', () => {
  const out = dailyUsage([], '2026-11-19')
  assert.equal(out.length, USAGE_DAILY_DAYS)
  assert.equal(out[0].day, '2026-10-21')
  assert.equal(out[out.length - 1].day, '2026-11-19')
  assert.ok(out.every((d) => d.costUsd === 0 && d.calls === 0 && d.failed === 0))
})

test('daily usage reads SQL bigint counts and a null cost', () => {
  const out = dailyUsage(
    [
      { day: '2026-11-18', costUsd: 0.25, calls: BigInt(20), failed: BigInt(4) },
      { day: '2026-11-19', costUsd: null, calls: BigInt(3), failed: BigInt(3) },
    ],
    '2026-11-19',
    3,
  )
  assert.deepEqual(out, [
    { day: '2026-11-17', costUsd: 0, calls: 0, failed: 0 },
    { day: '2026-11-18', costUsd: 0.25, calls: 20, failed: 4 },
    { day: '2026-11-19', costUsd: 0, calls: 3, failed: 3 },
  ])
})

test('daily usage crosses a month and a year end, and ignores days outside the window', () => {
  const out = dailyUsage([{ day: '2026-12-25', costUsd: 9, calls: 9, failed: 0 }], '2027-01-01', 3)
  assert.deepEqual(out.map((d) => d.day), ['2026-12-30', '2026-12-31', '2027-01-01'])
  assert.ok(out.every((d) => d.costUsd === 0))
})

test('daily usage with a bad last day or no days is empty', () => {
  assert.deepEqual(dailyUsage([], 'not-a-day'), [])
  assert.deepEqual(dailyUsage([], '2026-11-19', 0), [])
})

test('a usage range counts both ends and keeps valid days as given', () => {
  assert.deepEqual(parseUsageRange('2026-11-01', '2026-11-23', '2026-11-23'), { from: '2026-11-01', to: '2026-11-23', days: 23 })
  assert.deepEqual(parseUsageRange('2026-11-23', '2026-11-23', '2026-11-23'), { from: '2026-11-23', to: '2026-11-23', days: 1 })
  assert.deepEqual(parseUsageRange('2025-12-30', '2026-01-02', '2026-11-23'), { from: '2025-12-30', to: '2026-01-02', days: 4 })
})

test('a usage range ending after today is pulled back to today', () => {
  assert.deepEqual(parseUsageRange('2026-11-20', '2026-12-31', '2026-11-23'), { from: '2026-11-20', to: '2026-11-23', days: 4 })
})

test('a usage range is refused when malformed, reversed, in the future or too long', () => {
  const bad = (f: unknown, t: unknown) => assert.ok('error' in parseUsageRange(f, t, '2026-11-23'), `${String(f)}..${String(t)}`)
  bad(null, '2026-11-23')
  bad('2026-11-01', undefined)
  bad('2026-02-30', '2026-03-01')
  bad('2026-1-01', '2026-11-23')
  bad('2026-11-10', '2026-11-09')
  bad('2026-11-24', '2026-11-30')
  bad("2026-11-01' OR 1=1", '2026-11-23')
  const start = new Date(Date.parse('2026-11-23T00:00:00Z') - (USAGE_RANGE_MAX_DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
  assert.equal((parseUsageRange(start, '2026-11-23', '2026-11-23') as { days: number }).days, USAGE_RANGE_MAX_DAYS)
  const tooEarly = new Date(Date.parse(start) - 86_400_000).toISOString().slice(0, 10)
  bad(tooEarly, '2026-11-23')
})

console.log(`usage-cost.test.ts: ${passed} passed`)
