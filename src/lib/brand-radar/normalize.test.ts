/**
 * Run: npx tsx src/lib/brand-radar/normalize.test.ts
 */
import assert from 'node:assert/strict'
import { classifyHost, domainMatches, hostOf, nameKey, normalizeDomain, normalizeUrl, stripInvisible, unwrapFacebookRedirect } from './normalize'
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

test('stripInvisible removes zero-width and applies NFKC', () => {
  assert.equal(stripInvisible('a​b‌‍﻿c'), 'abc')
  assert.equal(stripInvisible('ＡＢＣ'), 'ABC')
})

test('nameKey lowercases, trims and collapses whitespace', () => {
  assert.equal(nameKey('  Mars   OS \n'), 'mars os')
  assert.equal(nameKey('ＭＡＲＳ'), 'mars')
})

test('normalizeDomain strips protocol, www, port, path, query, credentials', () => {
  assert.equal(normalizeDomain('https://WWW.Example.com:443/a?b'), 'example.com')
  assert.equal(normalizeDomain('http://user:pw@Example.com/x'), 'example.com')
  assert.equal(normalizeDomain('EXAMPLE.com'), 'example.com')
  assert.equal(normalizeDomain('www.example.com'), 'example.com')
  assert.equal(normalizeDomain('example.com:8080'), 'example.com')
})

test('normalizeDomain strips subdomains', () => {
  assert.equal(normalizeDomain('a.b.example.com'), 'example.com')
})

test('normalizeDomain handles multi-part suffixes', () => {
  assert.equal(normalizeDomain('blog.shop.example.co.th'), 'example.co.th')
  assert.equal(normalizeDomain('www.example.co.uk'), 'example.co.uk')
  assert.equal(normalizeDomain('example.com.au'), 'example.com.au')
  assert.equal(normalizeDomain('x.example.go.th'), 'example.go.th')
})

test('normalizeDomain does not treat hosting platforms specially', () => {
  assert.equal(normalizeDomain('mysite.github.io'), 'github.io')
})

test('normalizeDomain returns empty for invalid input', () => {
  assert.equal(normalizeDomain(''), '')
  assert.equal(normalizeDomain('localhost'), '')
  assert.equal(normalizeDomain('has space.com'), '')
  assert.equal(normalizeDomain('   '), '')
  assert.equal(normalizeDomain('a..com'), '')
})

test('hostOf', () => {
  assert.equal(hostOf('https://www.Shop.Example.com:8443/x'), 'shop.example.com')
  assert.equal(hostOf('example.com/path'), 'example.com')
  assert.equal(hostOf('nonsense'), '')
  assert.equal(hostOf(''), '')
})

test('normalizeUrl: http/https/www/port/fragment/tracking are equivalent', () => {
  const want = 'example.com/path?a=1'
  assert.equal(normalizeUrl('https://example.com/path?a=1'), want)
  assert.equal(normalizeUrl('http://www.example.com/path?a=1'), want)
  assert.equal(normalizeUrl('HTTPS://WWW.EXAMPLE.COM:443/path/?a=1#frag'), want)
  assert.equal(normalizeUrl('http://example.com:80/path?utm_source=x&a=1&gclid=z&fbclid=1&msclkid=2&srsltid=3&ref=4&ref_src=5'), want)
  assert.equal(normalizeUrl('example.com/path?a=1'), want)
})

test('normalizeUrl: sorts params, root becomes host, preserves path case', () => {
  assert.equal(normalizeUrl('https://example.com/?b=2&a=1'), 'example.com?a=1&b=2')
  assert.equal(normalizeUrl('https://example.com/'), 'example.com')
  assert.equal(normalizeUrl('https://example.com'), 'example.com')
  assert.equal(normalizeUrl('https://example.com/Path/To'), 'example.com/Path/To')
})

test('normalizeUrl: rejects non-http and invalid', () => {
  assert.equal(normalizeUrl('mailto:a@b.com'), null)
  assert.equal(normalizeUrl('javascript:alert(1)'), null)
  assert.equal(normalizeUrl('data:text/html,hi'), null)
  assert.equal(normalizeUrl('ftp://example.com/a'), null)
  assert.equal(normalizeUrl(''), null)
  assert.equal(normalizeUrl('not a url'), null)
})

test('normalizeUrl truncates to LIMITS.urlMax', () => {
  const r = normalizeUrl('https://example.com/' + 'a'.repeat(3000))
  assert.ok(r !== null && r.length === LIMITS.urlMax)
})

test('domainMatches subdomain rules', () => {
  assert.equal(domainMatches('example.com', 'example.com'), true)
  assert.equal(domainMatches('www.example.com', 'example.com'), true)
  assert.equal(domainMatches('blog.example.com', 'example.com'), true)
  assert.equal(domainMatches('notexample.com', 'example.com'), false)
  assert.equal(domainMatches('EXAMPLE.com', 'Example.COM'), true)
})

test('domainMatches with an owned subdomain', () => {
  assert.equal(domainMatches('shop.example.com', 'shop.example.com'), true)
  assert.equal(domainMatches('a.shop.example.com', 'shop.example.com'), true)
  assert.equal(domainMatches('example.com', 'shop.example.com'), false)
  assert.equal(domainMatches('other.example.com', 'shop.example.com'), false)
})

test('classifyHost: own, competitor, external, own wins', () => {
  const comps = [{ id: 'c1', domains: ['rival.com'] }, { id: 'c2', domains: ['shared.com'] }]
  assert.deepEqual(classifyHost('www.mine.com', ['mine.com'], comps), { ownerType: 'own', competitorId: null })
  assert.deepEqual(classifyHost('blog.rival.com', ['mine.com'], comps), { ownerType: 'competitor', competitorId: 'c1' })
  assert.deepEqual(classifyHost('other.org', ['mine.com'], comps), { ownerType: 'external', competitorId: null })
  assert.deepEqual(classifyHost('shared.com', ['shared.com'], comps), { ownerType: 'own', competitorId: null })
})

test('unwrapFacebookRedirect', () => {
  assert.equal(unwrapFacebookRedirect('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fx%3Fa%3D1&h=AT0'), 'https://example.com/x?a=1')
  assert.equal(unwrapFacebookRedirect('https://lm.facebook.com/l.php?u=http%3A%2F%2Fexample.com%2Fy'), 'http://example.com/y')
  const js = 'https://l.facebook.com/l.php?u=javascript%3Aalert(1)'
  assert.equal(unwrapFacebookRedirect(js), js)
  const fb = 'https://www.facebook.com/page/posts/1?u=https%3A%2F%2Fexample.com'
  assert.equal(unwrapFacebookRedirect(fb), fb)
  assert.equal(unwrapFacebookRedirect('not a url'), 'not a url')
  assert.equal(unwrapFacebookRedirect(''), '')
})

test('normalizeUrl: facebook host variants collapse, other subdomains do not', () => {
  const canon = normalizeUrl('https://www.facebook.com/page/posts/1')
  assert.equal(normalizeUrl('https://m.facebook.com/page/posts/1?fbclid=x'), canon)
  assert.equal(normalizeUrl('https://th-th.facebook.com/page/posts/1'), canon)
  assert.equal(normalizeUrl('https://web.facebook.com/page/posts/1'), canon)
  assert.equal(normalizeUrl('https://business.facebook.com/page/posts/1'), 'business.facebook.com/page/posts/1')
  assert.equal(normalizeUrl('https://m.example.com/a'), 'm.example.com/a')
  assert.equal(normalizeUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.example.com%2Fx'), 'example.com/x')
})

console.log(`normalize: ${passed} tests passed`)
