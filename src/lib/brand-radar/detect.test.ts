/**
 * Run: npx tsx src/lib/brand-radar/detect.test.ts
 */
import assert from 'node:assert/strict'
import { detectEntities, type BrandSpec, type CompetitorSpec } from './detect'

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

const mk = (name: string, extra: Partial<BrandSpec> = {}): BrandSpec => ({
  name, aliases: [], ambiguousAliases: [], contextTerms: [], ...extra,
})
const comp = (id: string, name: string, aliases: string[] = []): CompetitorSpec => ({ id, name, aliases })

test('case-insensitive match with occurrences', () => {
  const r = detectEntities('MARS is great. mars again. Mars!', mk('Mars'), [])
  assert.equal(r.brand?.occurrences, 3)
  assert.equal(r.brand?.entityType, 'brand')
  assert.equal(r.brand?.key, 'brand')
})

test('word boundary: Marshall / Marsx do not match', () => {
  assert.equal(detectEntities('Marshall and Marsx', mk('Mars'), []).brand, null)
})

test('word boundary: punctuation neighbours match', () => {
  const r = detectEntities('Mars, (Mars) and Mars\'s plan', mk('Mars'), [])
  assert.equal(r.brand?.occurrences, 3)
})

test('digits adjacent block a Latin match', () => {
  assert.equal(detectEntities('Mars2 and 3Mars', mk('Mars'), []).brand, null)
})

test('Thai term matches as plain substring', () => {
  const r = detectEntities('ร้านมาร์สครีมดีมาก', mk('มาร์ส'), [])
  assert.equal(r.brand?.occurrences, 1)
})

test('Latin term adjacent to Thai counts as bounded', () => {
  const r = detectEntities('ใช้Marsได้เลย', mk('Mars'), [])
  assert.equal(r.brand?.occurrences, 1)
})

test('terms shorter than 2 chars, empty and duplicate aliases ignored', () => {
  assert.equal(detectEntities('a b c', mk('a', { aliases: ['', 'b', ' '] }), []).brand, null)
  const r = detectEntities('Mars', mk('Mars', { aliases: ['mars', 'MARS'] }), [])
  assert.deepEqual(r.brand?.matchedAliases, ['mars'])
})

test('zero-width chars and fullwidth forms are normalised', () => {
  const r = detectEntities('Ma​rs and ＭＡＲＳ', mk('Mars'), [])
  assert.equal(r.brand?.occurrences, 2)
})

test('longest match wins across entities', () => {
  const r = detectEntities('Mars OS is good', mk('Mars OS'), [comp('c1', 'Mars')])
  assert.equal(r.brand?.occurrences, 1)
  assert.equal(r.competitors.length, 0)
})

test('Mars OS and Mars: brand 1, competitor 1', () => {
  const r = detectEntities('Mars OS and Mars', mk('Mars OS'), [comp('c1', 'Mars')])
  assert.equal(r.brand?.occurrences, 1)
  assert.equal(r.competitors[0].occurrences, 1)
  assert.equal(r.competitors[0].competitorId, 'c1')
})

test('ambiguous alias dropped without context', () => {
  const b = mk('Apex Clinic', { aliases: ['Apex'], ambiguousAliases: ['apex'], contextTerms: ['clinic', 'skin'] })
  assert.equal(detectEntities('The apex of the mountain', b, []).brand, null)
})

test('ambiguous alias counts with a context term', () => {
  const b = mk('Apex Clinic', { aliases: ['Apex'], ambiguousAliases: ['APEX'], contextTerms: ['skin'] })
  const r = detectEntities('Apex is good for skin care', b, [])
  assert.equal(r.brand?.occurrences, 1)
})

test('ambiguous alias counts when a non-ambiguous term matched', () => {
  const b = mk('Apex Clinic', { aliases: ['Apex'], ambiguousAliases: ['apex'], contextTerms: [] })
  const r = detectEntities('Apex Clinic opened. Apex is near.', b, [])
  assert.equal(r.brand?.occurrences, 2)
})

test('cue between two entities belongs to the nearer one', () => {
  const both = (t: string) => detectEntities(t, mk('Mars'), [comp('c1', 'Rival')])
  const a = both('Mars is recommended over Rival.')
  assert.equal(a.brand?.recommended, true)
  assert.equal(a.competitors[0].recommended, false)
  const b = both('Mars is fine, but Rival is the best choice.')
  assert.equal(b.brand?.recommended, false)
  assert.equal(b.competitors[0].recommended, true)
  assert.equal(detectEntities('We recommend Mars for beginners.', mk('Mars'), [comp('c1', 'Rival')]).brand?.recommended, true)
  const th = both('แนะนำ Mars มากกว่า Rival')
  assert.equal(th.brand?.recommended, true)
  assert.equal(th.competitors[0].recommended, false)
})

test('recommended + negation', () => {
  assert.equal(detectEntities('We recommend Mars for beginners.', mk('Mars'), []).brand?.recommended, true)
  assert.equal(detectEntities('Mars is the best tool.', mk('Mars'), []).brand?.recommended, true)
  assert.equal(detectEntities('We do not recommend Mars.', mk('Mars'), []).brand?.recommended, false)
  assert.equal(detectEntities('Mars is fine.', mk('Mars'), []).brand?.recommended, false)
  assert.equal(detectEntities('แนะนำ Mars ครับ', mk('Mars'), []).brand?.recommended, true)
  assert.equal(detectEntities('ไม่แนะนำ Mars ครับ', mk('Mars'), []).brand?.recommended, false)
})

test('recommend cue outside window is ignored', () => {
  const t = 'We recommend it. ' + 'x '.repeat(100) + 'Mars exists.'
  assert.equal(detectEntities(t, mk('Mars'), []).brand?.recommended, false)
})

test('compared: cue and nearby entity', () => {
  assert.equal(detectEntities('Mars vs the rest of the market', mk('Mars'), []).brand?.compared, true)
  assert.equal(detectEntities('Mars is fine.', mk('Mars'), []).brand?.compared, false)
  const r = detectEntities('Mars and Venus are both options.', mk('Mars'), [comp('v', 'Venus')])
  assert.equal(r.brand?.compared, true)
  assert.equal(r.competitors[0].compared, true)
})

test('far apart entities are not compared', () => {
  const t = 'Mars. ' + 'x '.repeat(200) + 'Venus.'
  const r = detectEntities(t, mk('Mars'), [comp('v', 'Venus')])
  assert.equal(r.brand?.compared, false)
})

test('position ordering is shared by brand and competitors', () => {
  const r = detectEntities('Venus first, then Mars, then Jupiter', mk('Mars'), [comp('j', 'Jupiter'), comp('v', 'Venus')])
  assert.equal(r.competitors.find((c) => c.key === 'v')?.position, 1)
  assert.equal(r.brand?.position, 2)
  assert.equal(r.competitors.find((c) => c.key === 'j')?.position, 3)
})

test('empty text or no matches', () => {
  assert.deepEqual(detectEntities('', mk('Mars'), []), { brand: null, competitors: [] })
  assert.deepEqual(detectEntities('nothing here', mk('Mars'), [comp('v', 'Venus')]), { brand: null, competitors: [] })
})

test('mixed Thai/English aliases', () => {
  const b = mk('Mars OS', { aliases: ['มาร์ส', 'MarsOS'] })
  const r = detectEntities('ใช้มาร์สหรือ MarsOS ดี', b, [])
  assert.equal(r.brand?.occurrences, 2)
  assert.deepEqual(new Set(r.brand?.matchedAliases), new Set(['มาร์ส', 'marsos']))
})

test('snippet is whitespace-collapsed and contains the match', () => {
  const r = detectEntities('line one\n\n   Mars   here\tnow', mk('Mars'), [])
  assert.ok(r.brand?.snippet.includes('Mars here now'))
  assert.equal(r.brand?.firstIndex, 'line one Mars here now'.indexOf('Mars'))
})

test('positionPct: 0 at the very start, near 1 at the end, 4 decimals', () => {
  const start = detectEntities('Mars is first here', mk('Mars'), [])
  assert.equal(start.brand?.positionPct, 0)
  const text = 'x'.repeat(96) + ' Mars'
  const end = detectEntities(text, mk('Mars'), [])
  assert.equal(end.brand?.positionPct, Math.round((97 / text.length) * 10000) / 10000)
  assert.ok((end.brand?.positionPct ?? 0) > 0.9)
  const third = detectEntities('aaa Mars bbb ccc ddd eee fff', mk('Mars'), [])
  assert.equal(third.brand?.positionPct, Math.round((4 / 28) * 10000) / 10000)
})

test('positionPct does not change the order-based position', () => {
  const r = detectEntities('Rival is cheap, but Mars is better', mk('Mars'), [comp('c1', 'Rival')])
  assert.equal(r.competitors[0].position, 1)
  assert.equal(r.brand?.position, 2)
  assert.equal(r.competitors[0].positionPct, 0)
  assert.ok((r.brand?.positionPct ?? 0) > 0.4)
})

console.log(`detect: ${passed} tests passed`)
