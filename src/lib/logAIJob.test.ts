// Ordered update queue for AIJob rows: npx tsx --test src/lib/logAIJob.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAIJobUpdateQueue, type AIJobPatch } from './logAIJob'

test('patches are written in order and never concurrently', async () => {
  const seen: number[] = []
  let running = 0
  let maxRunning = 0
  const q = createAIJobUpdateQueue(async (p: AIJobPatch) => {
    running++
    maxRunning = Math.max(maxRunning, running)
    // earlier patches take longer: an unordered writer would finish them last
    await new Promise((r) => setTimeout(r, 20 - (p.tokenUsed ?? 0)))
    seen.push(p.tokenUsed ?? -1)
    running--
  })
  for (let i = 1; i <= 5; i++) q.push({ tokenUsed: i })
  await q.flush()
  assert.deepEqual(seen, [1, 2, 3, 4, 5])
  assert.equal(maxRunning, 1)
})

test('a failing write does not break the queue or reject flush', async () => {
  const seen: number[] = []
  const q = createAIJobUpdateQueue(async (p) => {
    if (p.tokenUsed === 2) throw new Error('db down')
    seen.push(p.tokenUsed ?? -1)
  })
  q.push({ tokenUsed: 1 })
  q.push({ tokenUsed: 2 })
  q.push({ tokenUsed: 3 })
  await q.flush()
  assert.deepEqual(seen, [1, 3])
})

test('push does not wait for the writer', async () => {
  let wrote = false
  const q = createAIJobUpdateQueue(async () => {
    await new Promise((r) => setTimeout(r, 10))
    wrote = true
  })
  q.push({ tokenUsed: 1 })
  assert.equal(wrote, false)
  await q.flush()
  assert.equal(wrote, true)
})
