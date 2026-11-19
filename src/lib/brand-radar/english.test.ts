/**
 * English / multi-country support. Run: npx tsx src/lib/brand-radar/english.test.ts
 */
import assert from 'node:assert/strict'
import { detectEntities, type BrandSpec, type CompetitorSpec } from './detect'
import { cleanPromptInput, cleanPromptPatch } from './prompt-input'
import { buildSentimentPrompt, parseSentiment } from './sentiment'
import { COUNTRIES, LANGUAGES } from './types'

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
const occ = (text: string, name: string) => detectEntities(text, mk(name), []).brand?.occurrences ?? 0

test('Latin boundaries: Apple not in pineapple, Ace not in replace', () => {
  assert.equal(occ('I love pineapple juice', 'Apple'), 0)
  assert.equal(occ('Please replace the filter', 'Ace'), 0)
  assert.equal(occ('Apple makes phones. APPLE too.', 'Apple'), 2)
  assert.equal(occ('Ace Hardware is nearby', 'Ace'), 1)
})

test('possessive matches, plural does not (documented)', () => {
  assert.equal(occ("Philips's purifier is loud", "Philips"), 1)
  assert.equal(occ("Xiaomi’s phones are cheap", 'Xiaomi'), 1)
  assert.equal(occ('Levoits are popular', 'Levoit'), 0)
  assert.equal(detectEntities('Levoits are popular', mk('Levoit', { aliases: ['Levoits'] }), []).brand?.occurrences, 1)
})

test('names with punctuation and spaces', () => {
  assert.equal(occ("I bought L'Oréal shampoo", "L'Oréal"), 1)
  assert.equal(occ('I bought L’Oréal shampoo', "L'Oréal"), 1)
  assert.equal(occ('Try Dr. Martens boots', 'Dr. Martens'), 1)
  assert.equal(occ('AT&T has coverage', 'AT&T'), 1)
  assert.equal(occ('Go to 7-Eleven now', '7-Eleven'), 1)
  assert.equal(occ('Go to 7–Eleven now', '7-Eleven'), 1)
  assert.equal(occ('call 17-Eleven', '7-Eleven'), 0)
})

test('regex-special characters in names are safe', () => {
  assert.equal(occ('C++ is a language', 'C++'), 1)
  assert.equal(occ('(.*) is not a brand', '(.*)'), 1)
})

test('accents via NFKC still work', () => {
  assert.equal(occ('Café Nero opens', 'Café Nero'), 1)
  assert.equal(occ('Ａｐｐｌｅ is here', 'Apple'), 1)
})

test('mixed Thai / English; Thai names match inside running text', () => {
  const r = detectEntities('แนะนำApple และ iPhoneดีที่สุด ส่วนซัมซุงก็ดี', mk('Apple'), [comp('c1', 'ซัมซุง')])
  assert.equal(r.brand?.occurrences, 1)
  assert.equal(r.brand?.recommended, true)
  assert.equal(r.competitors[0].occurrences, 1)
  assert.equal(detectEntities('ร้านซัมซุงสาขาแรก', mk('ซัมซุง'), []).brand?.occurrences, 1)
})

test('English recommended / negated / compared cues', () => {
  assert.equal(detectEntities('Mars is the best option for most people.', mk('Mars'), []).brand?.recommended, true)
  assert.equal(detectEntities('Experts recommends Mars for beginners.', mk('Mars'), []).brand?.recommended, true)
  assert.equal(detectEntities('Mars is not recommended for large homes.', mk('Mars'), []).brand?.recommended, false)
  assert.equal(detectEntities("Mars isn’t recommended here, avoid it.", mk('Mars'), []).brand?.recommended, false)
  assert.equal(detectEntities('Mars is better than the others.', mk('Mars'), []).brand?.compared, true)
  assert.equal(detectEntities('Mars is a company.', mk('Mars'), []).brand?.compared, false)
})

test('competitor order and position on English text', () => {
  const r = detectEntities('Rival is cheap, but Mars is best.', mk('Mars'), [comp('c1', 'Rival')])
  assert.equal(r.competitors[0].position, 1)
  assert.equal(r.brand?.position, 2)
})

test('prompt input accepts en and every country, rejects others', () => {
  const d = { country: 'TH', language: 'th' }
  for (const c of COUNTRIES) {
    for (const l of LANGUAGES) {
      const r = cleanPromptInput({ text: 'best vacuum cleaner?', country: c.code.toLowerCase(), language: l.code.toUpperCase() }, d)
      assert.ok(r.ok)
      if (r.ok) { assert.equal(r.value.country, c.code); assert.equal(r.value.language, l.code) }
    }
  }
  const bad = cleanPromptInput({ text: 'best vacuum cleaner?', country: 'ZZ', language: 'xx' }, { country: 'US', language: 'en' })
  assert.ok(!bad.ok && bad.reason === 'Invalid country')
  const badLang = cleanPromptInput({ text: 'best vacuum cleaner?', language: 'xx' }, { country: 'US', language: 'en' })
  assert.ok(!badLang.ok && badLang.reason === 'Invalid language')
  const blank = cleanPromptInput({ text: 'best vacuum cleaner?', country: '', language: '  ' }, { country: 'US', language: 'en' })
  assert.ok(blank.ok && blank.value.country === 'US' && blank.value.language === 'en')
  assert.ok(cleanPromptPatch({ language: 'en', country: 'GB' }).ok)
  assert.ok(!cleanPromptPatch({ language: 'xx' }).ok)
  assert.ok(!cleanPromptPatch({ country: 'ZZ' }).ok)
})

test('sentiment prompt and parser work on English answers', () => {
  const targets = [{ key: 'brand', entityType: 'brand' as const, name: 'Mars', competitorId: null }]
  const p = buildSentimentPrompt({ prompt: 'Which vacuum is best?', answer: 'Mars is a reliable, affordable vacuum that most reviewers like a lot.', targets })
  assert.ok(p.includes('Mars is a reliable'))
  assert.ok(p.includes('language of the answer'))
  const raw = '{"factors":["price"],"entities":[{"key":"e0","tone":"positive","summary":"Reliable and affordable","descriptors":["reliable"]}]}'
  const s = parseSentiment(raw, targets)
  assert.ok(s)
})

test('cue windows stop at sentence and entity boundaries', () => {
  const r = detectEntities('Mars is the best. Rival is not recommended.', mk('Mars'), [comp('r1', 'Rival')])
  assert.equal(r.brand?.recommended, true)
  assert.equal(r.competitors[0].recommended, false)
  const r2 = detectEntities('Mars is the best choice but Rival is not recommended', mk('Mars'), [comp('r1', 'Rival')])
  assert.equal(r2.brand?.recommended, true)
})

test('best-selling is not a recommendation cue', () => {
  assert.equal(detectEntities('Mars is a best-selling vacuum', mk('Mars'), []).brand?.recommended, false)
  assert.equal(detectEntities('Mars is a best-in-class vacuum', mk('Mars'), []).brand?.recommended, false)
  assert.equal(detectEntities('Mars is the best vacuum', mk('Mars'), []).brand?.recommended, true)
})

test('dotted İ does not make matching case-sensitive', () => {
  assert.equal(occ('İstanbul guide. MARS vacuum review', 'mars'), 1)
})

test('Thai cue next to the brand in one line is still detected', () => {
  const r = detectEntities('แนะนำ Mars สำหรับบ้านที่มีสัตว์เลี้ยง', mk('Mars'), [])
  assert.equal(r.brand?.recommended, true)
})

console.log(`english: ${passed} tests passed`)
