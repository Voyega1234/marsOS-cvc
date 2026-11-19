// Run: npx tsx src/lib/brand-radar/language.test.ts
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { LANGUAGE_BOTH, PROFILE_LANGUAGES, detectPromptLanguage, isConcreteLanguage, isProfileLanguage, resolveLanguage } from './language'

// profile-input.ts pulls in auth.ts, which uses react.cache (only exists inside Next): add a no-op stand-in.
const react = createRequire(`${process.cwd()}/`)('react') as { cache?: unknown }
if (typeof react.cache !== 'function') react.cache = <T,>(fn: T): T => fn

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
const { cleanProfileInput } = await import('./profile-input')
const { cleanPromptInput } = await import('./prompt-input')

test('detects Thai from any Thai character', () => {
  assert.equal(detectPromptLanguage('คลินิกเสริมความงามที่ไหนดี'), 'th')
  assert.equal(detectPromptLanguage('eSpring เครื่องกรองน้ำ ดีไหม'), 'th')
  assert.equal(detectPromptLanguage('best water purifier in Thailand'), 'en')
  assert.equal(detectPromptLanguage('   '), 'en')
  assert.equal(detectPromptLanguage('2026 ราคา'), 'th')
})

test('profile language choices: th, en and both', () => {
  assert.deepEqual(PROFILE_LANGUAGES.map((l) => l.code), ['th', 'en', 'both'])
  assert.ok(isProfileLanguage('both'))
  assert.ok(isProfileLanguage('th'))
  assert.ok(!isProfileLanguage('jp'))
  assert.ok(!isProfileLanguage(undefined))
})

test('"both" is never a concrete language', () => {
  assert.ok(isConcreteLanguage('th'))
  assert.ok(isConcreteLanguage('en'))
  assert.ok(!isConcreteLanguage(LANGUAGE_BOTH))
  assert.ok(!isConcreteLanguage(''))
  assert.ok(!isConcreteLanguage(null))
})

test('profile "both": language comes from the text, stored value is ignored', () => {
  assert.equal(resolveLanguage('both', 'best clinic in Bangkok', 'th'), 'en')
  assert.equal(resolveLanguage('both', 'คลินิกไหนดี', 'en'), 'th')
  assert.equal(resolveLanguage('both', 'best clinic in Bangkok'), 'en')
})

test('single-language profile: stored prompt language first, then the profile', () => {
  assert.equal(resolveLanguage('th', 'best clinic in Bangkok', 'en'), 'en')
  assert.equal(resolveLanguage('th', 'best clinic in Bangkok', ''), 'th')
  assert.equal(resolveLanguage('en', 'คลินิกไหนดี', null), 'en')
  assert.equal(resolveLanguage('en', 'คลินิกไหนดี', 'th'), 'th')
})

test('never returns "both" or an empty value', () => {
  assert.equal(resolveLanguage('th', 'hello', 'both'), 'en')
  assert.equal(resolveLanguage('', 'สวัสดี', ''), 'th')
  assert.equal(resolveLanguage(null, 'hello', null), 'en')
  assert.equal(resolveLanguage(undefined, 'สวัสดี'), 'th')
  // values the database could hold from older data never reach a provider as they are
  assert.equal(resolveLanguage('th', 'hello', 'zh'), 'en')
  assert.equal(resolveLanguage('BOTH', 'hello', 'zh'), 'en')
  assert.equal(resolveLanguage('zh', 'สวัสดี', null), 'th')
  for (const profile of ['th', 'en', 'both', '', null, undefined]) {
    for (const stored of ['th', 'en', 'both', '', null, undefined]) {
      for (const text of ['hello', 'สวัสดี', '']) {
        const got = resolveLanguage(profile, text, stored)
        assert.ok(isConcreteLanguage(got), `profile=${profile} stored=${stored} text=${text} gave ${got}`)
      }
    }
  }
})

test('profile input accepts both, rejects unknown codes', () => {
  const ok = cleanProfileInput({ language: 'both' })
  assert.ok(ok.ok && ok.data.language === 'both')
  const upper = cleanProfileInput({ language: 'BOTH' })
  assert.ok(upper.ok && upper.data.language === 'both')
  const en = cleanProfileInput({ language: 'en' })
  assert.ok(en.ok && en.data.language === 'en')
  const bad = cleanProfileInput({ language: 'jp' })
  assert.ok(!bad.ok)
})

test('profile input: autoScan must be a real boolean', () => {
  const on = cleanProfileInput({ autoScan: true })
  assert.ok(on.ok && on.data.autoScan === true)
  const off = cleanProfileInput({ autoScan: false })
  assert.ok(off.ok && off.data.autoScan === false)
  const absent = cleanProfileInput({})
  assert.ok(absent.ok && !('autoScan' in absent.data))
  for (const v of ['true', 1, null, 'on', {}]) {
    const bad = cleanProfileInput({ autoScan: v })
    assert.ok(!bad.ok, `autoScan=${JSON.stringify(v)} must be rejected`)
  }
})

test('new prompt under a "both" profile gets its language from its text', () => {
  const th = cleanPromptInput({ text: 'เครื่องกรองน้ำยี่ห้อไหนดี' }, { country: 'TH', language: 'both' })
  assert.ok(th.ok && th.value.language === 'th')
  const en = cleanPromptInput({ text: 'which water purifier is best' }, { country: 'TH', language: 'both' })
  assert.ok(en.ok && en.value.language === 'en')
})

test('new prompt: an explicit language still wins, "both" is not a prompt language', () => {
  const explicit = cleanPromptInput({ text: 'which water purifier is best', language: 'th' }, { country: 'TH', language: 'both' })
  assert.ok(explicit.ok && explicit.value.language === 'th')
  const bad = cleanPromptInput({ text: 'which water purifier is best', language: 'both' }, { country: 'TH', language: 'th' })
  assert.ok(!bad.ok && bad.reason === 'Invalid language')
})

test('new prompt under a single-language profile keeps the profile language', () => {
  const p = cleanPromptInput({ text: 'which water purifier is best' }, { country: 'TH', language: 'th' })
  assert.ok(p.ok && p.value.language === 'th')
})

console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
