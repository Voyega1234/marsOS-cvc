// Run: npx tsx src/lib/brand-radar/usage-cost.test.ts
import assert from 'node:assert/strict'
import { costPerCall } from './types'

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

console.log(`usage-cost.test.ts: ${passed} passed`)
