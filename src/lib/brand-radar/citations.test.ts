/**
 * Run: npx tsx src/lib/brand-radar/citations.test.ts
 */
import assert from 'node:assert/strict'
import { extractCitations } from './citations'
import { LIMITS } from './types'

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
  } catch (e) {
    console.error(`FAIL: ${name}`)
    throw e
  }
}

const OWN = ['mine.co.th']
const COMPS = [{ id: 'c1', domains: ['rival.com'] }]

test('explicit citations list keeps order and titles', () => {
  const r = extractCitations(
    { text: '', citations: [{ url: 'https://a.com/x', title: 'A' }, { url: 'https://b.com/y' }] },
    OWN, COMPS,
  )
  assert.equal(r.length, 2)
  assert.equal(r[0].title, 'A')
  assert.equal(r[0].position, 0)
  assert.equal(r[1].position, 1)
  assert.equal(r[1].title, '')
  assert.equal(r[0].domain, 'a.com')
  assert.equal(r[0].normalizedUrl, 'a.com/x')
})

test('markdown links are extracted with label as title', () => {
  const r = extractCitations({ text: 'See [Mars guide](https://blog.mine.co.th/guide) now.', citations: [] }, OWN, COMPS)
  assert.equal(r.length, 1)
  assert.equal(r[0].title, 'Mars guide')
  assert.equal(r[0].host, 'blog.mine.co.th')
  assert.equal(r[0].domain, 'mine.co.th')
  assert.equal(r[0].ownerType, 'own')
})

test('bare URLs are extracted with trailing punctuation stripped', () => {
  const r = extractCitations(
    { text: 'Go to https://a.com/x, or (https://b.com/y). Also https://c.com/z; end https://d.com/w]', citations: [] },
    OWN, COMPS,
  )
  assert.deepEqual(r.map((c) => c.normalizedUrl), ['a.com/x', 'b.com/y', 'c.com/z', 'd.com/w'])
})

test('a markdown link is not counted twice as a bare URL', () => {
  const r = extractCitations({ text: '[x](https://a.com/p) and https://a.com/p', citations: [] }, OWN, COMPS)
  assert.equal(r.length, 1)
})

test('dedupe across http/https/www/utm; first occurrence keeps title', () => {
  const r = extractCitations(
    {
      text: 'also http://www.a.com/p/?utm_source=x and [t](https://a.com/p#frag)',
      citations: [{ url: 'https://a.com/p', title: 'First' }],
    },
    OWN, COMPS,
  )
  assert.equal(r.length, 1)
  assert.equal(r[0].title, 'First')
  assert.equal(r[0].url, 'https://a.com/p')
})

test('source order: explicit, then markdown, then bare', () => {
  const r = extractCitations(
    { text: 'https://bare.com/1 and [m](https://md.com/1)', citations: [{ url: 'https://explicit.com/1' }] },
    OWN, COMPS,
  )
  assert.deepEqual(r.map((c) => c.host), ['explicit.com', 'md.com', 'bare.com'])
  assert.deepEqual(r.map((c) => c.position), [0, 1, 2])
})

test('unlinked brand name or bare domain is not a citation', () => {
  assert.equal(extractCitations({ text: 'visit example.com', citations: [] }, ['example.com'], []).length, 0)
  assert.equal(extractCitations({ text: 'Mars is mentioned by www.mine.co.th only', citations: [] }, OWN, COMPS).length, 0)
})

test('own vs competitor vs external classification', () => {
  const r = extractCitations(
    { text: '', citations: [{ url: 'https://www.mine.co.th/a' }, { url: 'https://shop.rival.com/b' }, { url: 'https://wiki.org/c' }] },
    OWN, COMPS,
  )
  assert.deepEqual(r.map((c) => [c.ownerType, c.competitorId]), [['own', null], ['competitor', 'c1'], ['external', null]])
})

test('own wins over competitor', () => {
  const r = extractCitations(
    { text: '', citations: [{ url: 'https://rival.com/a' }] },
    ['rival.com'], COMPS,
  )
  assert.equal(r[0].ownerType, 'own')
  assert.equal(r[0].competitorId, null)
})

test('non-http and invalid urls are skipped', () => {
  const r = extractCitations(
    { text: '[m](mailto:a@b.com)', citations: [{ url: 'javascript:alert(1)' }, { url: 'data:text/html,x' }, { url: '' }, { url: 'https://ok.com/' }] },
    OWN, COMPS,
  )
  assert.equal(r.length, 1)
  assert.equal(r[0].normalizedUrl, 'ok.com')
})

test('url and title are truncated', () => {
  const r = extractCitations(
    { text: '', citations: [{ url: 'https://a.com/' + 'x'.repeat(3000), title: 't'.repeat(900) }] },
    OWN, COMPS,
  )
  assert.equal(r[0].url.length, LIMITS.urlMax)
  assert.equal(r[0].title.length, 300)
})

test('facebook shim citation is recorded on the target and de-duplicated', () => {
  const r = extractCitations(
    {
      text: 'see https://example.com/x',
      citations: [{ url: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fx&h=1', title: 'T' }],
    },
    OWN, COMPS,
  )
  assert.equal(r.length, 1)
  assert.equal(r[0].url, 'https://example.com/x')
  assert.equal(r[0].host, 'example.com')
  assert.equal(r[0].domain, 'example.com')
})

test('facebook shim to an own domain is classified own', () => {
  const r = extractCitations(
    { text: '', citations: [{ url: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fmine.co.th%2Fa' }] },
    OWN, COMPS,
  )
  assert.equal(r[0].ownerType, 'own')
  assert.equal(r[0].domain, 'mine.co.th')
})

test('plain facebook page citation is kept', () => {
  const r = extractCitations({ text: '', citations: [{ url: 'https://www.facebook.com/somepage' }] }, OWN, COMPS)
  assert.equal(r.length, 1)
  assert.equal(r[0].domain, 'facebook.com')
})

console.log(`citations: ${passed} tests passed`)
