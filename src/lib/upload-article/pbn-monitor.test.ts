/**
 * PBN Backlinks > Monitor: เลือกบทความที่ push ขึ้นเว็บ PBN เว็บเดียวเพื่อดูผลใน GSC
 * Run: npx tsx src/lib/upload-article/pbn-monitor.test.ts
 */
import assert from 'node:assert/strict'
import { pbnMonitorArticleIds, pbnMonitorArticles } from './pbn-monitor'
import type { PbnPushes } from './pbn'

let n = 0
function t(name: string, fn: () => void) {
  fn()
  n++
  console.log(`ok ${n} - ${name}`)
}

const articles = [
  { id: 'a1', title: 'หนึ่ง', slug: 'one' },
  { id: 'a2', title: 'สอง', slug: 'two' },
  { id: 'a3', title: '', slug: 'three' },
]
const pushes: PbnPushes = {
  a1: { s1: { url: 'https://s1.com/blog/one', at: '2026-11-01T00:00:00.000Z' } },
  a2: { s2: { url: 'https://s2.com/blog/two', at: '2026-11-02T00:00:00.000Z' } },
  a3: { s1: { at: '2026-11-03T00:00:00.000Z' } },
}

t('only the chosen site articles', () => {
  const r = pbnMonitorArticles(pushes, 's1', articles, (s) => `https://s1.com/blog/${s}`)
  assert.deepEqual(r.map((x) => x.id), ['a1', 'a3'])
  assert.deepEqual(pbnMonitorArticleIds(pushes, 's2'), ['a2'])
})

t('url comes from the record', () => {
  const r = pbnMonitorArticles(pushes, 's1', articles, () => 'https://fallback.com/x')
  assert.equal(r[0].wordpressUrl, 'https://s1.com/blog/one')
})

t('fallback used when the record has no url', () => {
  const r = pbnMonitorArticles(pushes, 's1', articles, (s) => `https://s1.com/blog/${s}`)
  assert.equal(r[1].wordpressUrl, 'https://s1.com/blog/three')
  assert.equal(r[1].title, 'three')
})

t('skipped when neither url nor fallback', () => {
  assert.deepEqual(pbnMonitorArticles(pushes, 's1', articles).map((x) => x.id), ['a1'])
  assert.deepEqual(pbnMonitorArticles(pushes, 's1', articles, () => '').map((x) => x.id), ['a1'])
})

t('pushedAt equals the record at', () => {
  const r = pbnMonitorArticles(pushes, 's1', articles)
  assert.equal(r[0].pushedAt, '2026-11-01T00:00:00.000Z')
})

t('article pushed to two sites shows each site url', () => {
  const both: PbnPushes = {
    a1: {
      s1: { url: 'https://s1.com/blog/one', at: '2026-11-01T00:00:00.000Z' },
      s2: { url: 'https://s2.com/blog/one', at: '2026-11-05T00:00:00.000Z' },
    },
  }
  assert.equal(pbnMonitorArticles(both, 's1', articles)[0].wordpressUrl, 'https://s1.com/blog/one')
  assert.equal(pbnMonitorArticles(both, 's2', articles)[0].wordpressUrl, 'https://s2.com/blog/one')
  assert.equal(pbnMonitorArticles(both, 's2', articles)[0].pushedAt, '2026-11-05T00:00:00.000Z')
})

t('empty pushes give nothing', () => {
  assert.deepEqual(pbnMonitorArticles({}, 's1', articles), [])
  assert.deepEqual(pbnMonitorArticleIds({}, 's1'), [])
})
