/**
 * Run: npx tsx src/lib/url-state.test.ts
 */
import assert from 'node:assert/strict'
import { buildUrlWithParams, readAllowedParam, replaceUrlParams } from './url-state'

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

const TABS = ['overview', 'report', 'review'] as const

test('reads an allowed value', () => {
  assert.equal(readAllowedParam('?tab=report', 'tab', TABS), 'report')
})

test('rejects a value outside the allowed list', () => {
  assert.equal(readAllowedParam('?tab=admin', 'tab', TABS), null)
})

test('missing or empty param gives null', () => {
  assert.equal(readAllowedParam('', 'tab', TABS), null)
  assert.equal(readAllowedParam('?tab=', 'tab', TABS), null)
  assert.equal(readAllowedParam('?other=report', 'tab', TABS), null)
})

test('without a list any short value is accepted, long values are refused', () => {
  assert.equal(readAllowedParam('?article=abc123', 'article'), 'abc123')
  assert.equal(readAllowedParam(`?article=${'x'.repeat(201)}`, 'article'), null)
})

test('value is matched exactly, not by prefix or case', () => {
  assert.equal(readAllowedParam('?tab=Report', 'tab', TABS), null)
  assert.equal(readAllowedParam('?tab=report2', 'tab', TABS), null)
})

test('sets a param and keeps the others', () => {
  assert.equal(
    buildUrlWithParams('/projects/1', '?setup=1', '', { tab: 'report' }),
    '/projects/1?setup=1&tab=report',
  )
})

test('replaces an existing param in place', () => {
  assert.equal(
    buildUrlWithParams('/projects/1', '?tab=overview&x=1', '', { tab: 'report' }),
    '/projects/1?tab=report&x=1',
  )
})

test('null, undefined and empty string remove the param', () => {
  assert.equal(buildUrlWithParams('/p', '?tab=report&x=1', '', { tab: null }), '/p?x=1')
  assert.equal(buildUrlWithParams('/p', '?tab=report', '', { tab: undefined }), '/p')
  assert.equal(buildUrlWithParams('/p', '?tab=report', '', { tab: '' }), '/p')
})

test('several changes at once', () => {
  assert.equal(
    buildUrlWithParams('/u/9', '?tab=settings&section=style', '', { tab: 'review', section: null, article: 'a1' }),
    '/u/9?tab=review&article=a1',
  )
})

test('hash is kept', () => {
  assert.equal(buildUrlWithParams('/p', '', '#top', { tab: 'report' }), '/p?tab=report#top')
})

test('values are encoded', () => {
  assert.equal(buildUrlWithParams('/p', '', '', { q: 'a b&c' }), '/p?q=a+b%26c')
  assert.equal(readAllowedParam('?q=a+b%26c', 'q'), 'a b&c')
})

test('replaceUrlParams does nothing outside a browser', () => {
  assert.doesNotThrow(() => replaceUrlParams({ tab: 'report' }))
})

console.log(`url-state: ${passed} tests passed`)
