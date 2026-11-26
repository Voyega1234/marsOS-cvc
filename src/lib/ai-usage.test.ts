import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyUsage, usageOfError, sumUsage, attachUsage } from './ai-usage'

const u = (t: number, c: number) => ({ inputTokens: t, outputTokens: 0, totalTokens: t, costUsd: c })

test('usageOfError reads usage off an error and returns null otherwise', () => {
  const e = Object.assign(new Error('x'), { usage: u(10, 0.5) })
  assert.equal(usageOfError(e)?.costUsd, 0.5)
  assert.equal(usageOfError(new Error('x')), null)
  assert.equal(usageOfError(null), null)
  assert.equal(usageOfError('str'), null)
  assert.equal(usageOfError({ usage: emptyUsage() }), null)
})

test('sumUsage skips nullish and rounds cost', () => {
  const s = sumUsage(u(10, 0.1), null, undefined, u(5, 0.2))
  assert.equal(s.totalTokens, 15)
  assert.equal(s.costUsd, 0.3)
})

test('attachUsage keeps the same error object and message, and merges', () => {
  const e = new Error('boom')
  const same = attachUsage(e, u(3, 0.1))
  assert.equal(same, e)
  assert.equal(e.message, 'boom')
  attachUsage(e, u(2, 0.2))
  assert.equal(usageOfError(e)?.totalTokens, 5)
  assert.equal(usageOfError(e)?.costUsd, 0.3)
})
