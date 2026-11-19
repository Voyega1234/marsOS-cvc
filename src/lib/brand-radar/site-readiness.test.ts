// Brand Radar site readiness (pure part): npx tsx src/lib/brand-radar/site-readiness.test.ts
import {
  AI_BOTS, analyseHomepage, botVerdict, cleanCheckDomain, collectIssues, isCheckStale, llmsFromResponse, parseRobots, robotsFromResponse, visibleTextLength,
} from './site-readiness'
import type { SiteReadinessDTO } from './site-readiness-types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}
const v = (txt: string, bot: string) => botVerdict(parseRobots(txt), bot)

// user-agent matching, fallback to *, no rules
eq(v('User-agent: GPTBot\nDisallow: /', 'GPTBot'), { verdict: 'blocked', matchedGroup: 'GPTBot' }, 'own group blocks')
eq(v('User-agent: gptbot\nDisallow: /', 'GPTBot'), { verdict: 'blocked', matchedGroup: 'GPTBot' }, 'case-insensitive agent')
eq(v('USER-AGENT: GPTBot\nDISALLOW: /', 'GPTBot').verdict, 'blocked', 'case-insensitive field names')
eq(v('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /', 'ClaudeBot'), { verdict: 'allowed', matchedGroup: '*' }, 'falls back to *')
eq(v('User-agent: *\nDisallow: /', 'ClaudeBot'), { verdict: 'blocked', matchedGroup: '*' }, '* blocks all')
eq(v('User-agent: *\nDisallow: /\n\nUser-agent: ClaudeBot\nAllow: /', 'ClaudeBot'), { verdict: 'allowed', matchedGroup: 'ClaudeBot' }, 'own group beats *')
eq(v('User-agent: Foo', 'GPTBot'), { verdict: 'allowed', matchedGroup: '' }, 'no rules at all')
eq(v('User-agent: A\nUser-agent: GPTBot\nDisallow: /', 'GPTBot').verdict, 'blocked', 'consecutive agents share a group')
eq(v('User-agent: A\nDisallow: /x\nUser-agent: GPTBot\nDisallow: /', 'A').verdict, 'partial', 'new group after rules')

// empty Disallow, partial, longest match, Allow tie, wildcards
eq(v('User-agent: *\nDisallow:', 'GPTBot').verdict, 'allowed', 'empty Disallow allows')
eq(v('User-agent: *\nDisallow: /private', 'GPTBot').verdict, 'partial', 'partial')
eq(v('User-agent: *\nDisallow: /\nAllow: /', 'GPTBot').verdict, 'partial', 'Allow wins a tie (root open, rule remains)')
eq(v('User-agent: *\nAllow: /\nDisallow: /', 'GPTBot').verdict, 'partial', 'Allow wins a tie (other order)')
eq(v('User-agent: *\nDisallow: /\nAllow: /$', 'GPTBot').verdict, 'partial', 'longer Allow /$ opens the root')
eq(v('User-agent: *\nDisallow: /*', 'GPTBot').verdict, 'blocked', 'wildcard blocks root')
eq(v('User-agent: *\nDisallow: /*.pdf$', 'GPTBot').verdict, 'partial', 'wildcard + end anchor is partial')
eq(v('User-agent: *\nDisallow: /$', 'GPTBot').verdict, 'blocked', 'end anchor on root')
eq(v('User-agent: *\nDisallow: /a*b$', 'GPTBot').verdict, 'partial', 'mid wildcard')
eq(v('User-agent: * # all\nDisallow: / # everything\n', 'GPTBot').verdict, 'blocked', 'comments stripped')
eq(v('\n\n# only comment\nUser-agent: *\n\nDisallow: /\n', 'GPTBot').verdict, 'blocked', 'blank lines inside group')

// sitemaps
const sm = parseRobots('Sitemap: https://a.com/s.xml\nsitemap: http://a.com/t.xml\nSitemap: ftp://a.com/x\nSitemap: /rel.xml\nSitemap: https://a.com/3\nSitemap: https://a.com/4\nSitemap: https://a.com/5\nSitemap: https://a.com/6')
eq(sm.sitemaps.length, 5, 'sitemaps capped at 5')
eq(sm.sitemaps[0], 'https://a.com/s.xml', 'first sitemap')
eq(sm.sitemaps.some((s) => s.startsWith('ftp') || s.startsWith('/')), false, 'only http(s) sitemaps')
eq(parseRobots('Sitemap: https://a.com/' + 'x'.repeat(500)).sitemaps[0].length, 300, 'sitemap clipped')

// HTTP handling
const ok = robotsFromResponse({ status: 200, body: 'User-agent: GPTBot\nDisallow: /' })
eq([ok.state, ok.bots.find((b) => b.bot === 'GPTBot')?.verdict, ok.bots.find((b) => b.bot === 'ClaudeBot')?.verdict], ['found', 'blocked', 'allowed'], '200 parses')
eq(ok.bots.length, AI_BOTS.length, 'all bots listed')
for (const st of [404, 410]) {
  const r = robotsFromResponse({ status: st, body: 'x' })
  eq([r.state, r.bots.every((b) => b.verdict === 'allowed')], ['missing', true], `${st} is missing`)
}
for (const st of [401, 403, 500, 503]) {
  const r = robotsFromResponse({ status: st, body: 'User-agent: *\nDisallow: /' })
  eq([r.state, r.bots.every((b) => b.verdict === 'unknown')], ['unreadable', true], `${st} unreadable`)
}
eq(robotsFromResponse(null).state, 'unreadable', 'fetch failure unreadable')
eq(robotsFromResponse(null).bots.every((b) => b.verdict === 'unknown'), true, 'fetch failure unknown')

// homepage
const html = `<!doctype html><html><head><title> Acme &amp; Co
 Home </title>
<meta name="description" content="We sell &quot;stuff&quot;">
<META NAME="Robots" CONTENT="NoIndex, follow">
<link rel="canonical" href="https://acme.com/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]}]}</script>
<script type="application/ld+json">{ broken json </script>
<style>body{color:red}</style></head>
<body><script>var x = "<p>fake text fake text</p>"</script><noscript>enable js</noscript><h1>Hello   world</h1><p>Some &nbsp; text</p></body></html>`
const h = analyseHomepage(html, '')
eq(h.noindex, true, 'meta noindex')
eq(h.nosnippet, false, 'no nosnippet')
eq(h.title, 'Acme & Co Home', 'title decoded and squashed')
eq(h.description, 'We sell "stuff"', 'description decoded')
eq(h.canonical, 'https://acme.com/', 'canonical')
eq(h.schemaTypes, ['Organization', 'WebSite', 'Thing'], 'JSON-LD @graph and arrays, broken JSON skipped')
eq(h.hasJsonLd, true, 'hasJsonLd even with a broken block')
eq(h.textLength, 'Hello world Some text'.length, 'text length ignores scripts, styles, noscript')
eq(analyseHomepage('<html></html>', 'noindex, nosnippet').noindex, true, 'header noindex')
eq(analyseHomepage('<html></html>', 'noindex, nosnippet').nosnippet, true, 'header nosnippet')
eq(analyseHomepage('<meta name="robots" content="max-snippet:0">', '').nosnippet, true, 'max-snippet:0')
eq(analyseHomepage('<meta name="robots" content="max-snippet:50">', '').nosnippet, false, 'max-snippet:50 is fine')
eq(analyseHomepage('<meta name="robots" content="index, follow">', '').noindex, false, 'index is fine')
eq(analyseHomepage('<meta name="robots" content="none">', '').noindex, true, 'none means noindex')
eq(analyseHomepage('<title>' + 'a'.repeat(500) + '</title>', '').title.length, 200, 'title clipped')
eq(analyseHomepage('<meta name="description" content="' + 'a'.repeat(500) + '">', '').description.length, 300, 'description clipped')
eq(analyseHomepage('<script type="application/ld+json">{"@type":"' + 'T'.repeat(200) + '"}</script>', '').schemaTypes[0].length, 60, 'type clipped')
const many = '<script type="application/ld+json">' + JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ '@type': 'T' + i }))) + '</script>'
eq(analyseHomepage(many, '').schemaTypes.length, 20, 'schema types capped at 20')
eq(visibleTextLength('<p>a</p><script>unterminated'), 1, 'unterminated script does not hang')
eq(visibleTextLength('a < b and c'), 'a < b and c'.length, 'lone < kept as text')
{
  const hostile = '<script>'.repeat(5000) + '<'.repeat(100000) + '<a '.repeat(50000)
  const t0 = Date.now()
  analyseHomepage(hostile, '')
  eq(Date.now() - t0 < 3000, true, 'hostile input finishes quickly')
}

// llms.txt
eq(llmsFromResponse({ status: 200, contentType: 'text/plain; charset=utf-8', body: '# Acme\n' }).state, 'found', 'llms found')
eq(llmsFromResponse({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html>' }).state, 'missing', 'html 404 page with 200')
eq(llmsFromResponse({ status: 200, contentType: 'text/plain', body: '<html><body>Not found' }).state, 'missing', 'html body with text type')
eq(llmsFromResponse({ status: 200, contentType: 'text/plain', body: '  \n' }).state, 'missing', 'empty body')
eq(llmsFromResponse({ status: 200, contentType: 'application/pdf', body: 'x' }).state, 'missing', 'non-text type')
eq(llmsFromResponse({ status: 404, contentType: '', body: '' }).state, 'missing', '404 missing')
eq(llmsFromResponse({ status: 500, contentType: '', body: '' }).state, 'unreadable', '500 unreadable')
eq(llmsFromResponse(null).state, 'unreadable', 'fetch failure')

// issues
function dto(over: Partial<SiteReadinessDTO> = {}): Pick<SiteReadinessDTO, 'robots' | 'llmsTxt' | 'homepage'> {
  return {
    robots: robotsFromResponse({ status: 200, body: 'Sitemap: https://a.com/s.xml' }),
    llmsTxt: { state: 'found', httpStatus: 200 },
    homepage: { state: 'ok', httpStatus: 200, finalUrl: 'https://a.com/', noindex: false, nosnippet: false, title: 't', description: 'd', canonical: 'c', schemaTypes: ['Organization'], hasJsonLd: true, textLength: 900 },
    ...over,
  }
}
eq(collectIssues(dto()), [], 'clean site has no issues')
eq(collectIssues(dto({ robots: robotsFromResponse({ status: 200, body: 'User-agent: OAI-SearchBot\nDisallow: /\nSitemap: https://a.com/s' }) })), ['robots_blocks_ai_search'], 'search bot blocked')
eq(collectIssues(dto({ robots: robotsFromResponse({ status: 200, body: 'User-agent: ChatGPT-User\nDisallow: /\nSitemap: https://a.com/s' }) })), ['robots_blocks_ai_search'], 'user bot blocked')
eq(collectIssues(dto({ robots: robotsFromResponse({ status: 200, body: 'User-agent: GPTBot\nDisallow: /\nSitemap: https://a.com/s' }) })), ['robots_blocks_ai_training'], 'training bot blocked')
eq(collectIssues(dto({ robots: robotsFromResponse({ status: 200, body: 'User-agent: Googlebot\nDisallow: /\nSitemap: https://a.com/s' }) })), ['robots_blocks_index'], 'index bot blocked')
eq(collectIssues(dto({ robots: robotsFromResponse({ status: 403, body: '' }) })), ['no_sitemap'], 'unreadable robots is not reported as blocked')
eq(collectIssues(dto({ llmsTxt: { state: 'missing', httpStatus: 404 } })), ['no_llms_txt'], 'no llms.txt')
{
  const base = dto().homepage!
  eq(collectIssues(dto({ homepage: { ...base, noindex: true, nosnippet: true } })), ['homepage_noindex', 'homepage_nosnippet'], 'noindex and nosnippet')
  eq(collectIssues(dto({ homepage: { ...base, schemaTypes: [], hasJsonLd: false } })), ['no_schema'], 'no schema')
  eq(collectIssues(dto({ homepage: { ...base, schemaTypes: ['Product'] } })), ['no_org_schema'], 'no org schema')
  eq(collectIssues(dto({ homepage: { ...base, schemaTypes: ['LocalBusiness'] } })), [], 'LocalBusiness counts')
  eq(collectIssues(dto({ homepage: { ...base, textLength: 499 } })), ['thin_without_js'], 'thin below 500')
  eq(collectIssues(dto({ homepage: { ...base, textLength: 500 } })), [], '500 is enough')
  eq(collectIssues(dto({ homepage: { ...base, description: '', canonical: '' } })), ['no_meta_description', 'no_canonical'], 'missing description and canonical')
}

// staleness
const now = new Date('2026-11-19T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const H = 3600 * 1000
eq(isCheckStale(null, 'a.com', now), true, 'nothing cached')
eq(isCheckStale({ domain: 'b.com', checkedAt: ago(H), status: 'ok' }, 'a.com', now), true, 'different domain')
eq(isCheckStale({ domain: 'a.com', checkedAt: ago(7 * 24 * H), status: 'ok' }, 'a.com', now), false, 'exactly 7 days is fresh')
eq(isCheckStale({ domain: 'a.com', checkedAt: ago(7 * 24 * H + 1), status: 'ok' }, 'a.com', now), true, 'over 7 days is stale')
eq(isCheckStale({ domain: 'a.com', checkedAt: ago(H), status: 'unreachable' }, 'a.com', now), false, 'unreachable exactly 1 hour is fresh')
eq(isCheckStale({ domain: 'a.com', checkedAt: ago(H + 1), status: 'unreachable' }, 'a.com', now), true, 'unreachable over 1 hour is stale')
eq(isCheckStale({ domain: 'a.com', checkedAt: null, status: 'ok' }, 'a.com', now), true, 'no date is stale')

// domain cleaning
eq(cleanCheckDomain('Acme.COM'), 'acme.com', 'lower-case')
eq(cleanCheckDomain('https://www.Acme.com/path?x=1'), 'www.acme.com', 'scheme and path')
eq(cleanCheckDomain('acme.com:8080'), 'acme.com', 'port stripped')
eq(cleanCheckDomain('acme.com.'), 'acme.com', 'trailing dot')
for (const bad of ['', 'localhost', '127.0.0.1', '10.0.0.1', '[::1]', 'user@acme.com', 'https://user:pw@acme.com', 'acme', 'a b.com', 'acme.com@evil.com', '0x7f.1', 'http://localhost:3000', 'x.localhost', '-a.com', null, undefined]) {
  eq(cleanCheckDomain(bad as string), '', `rejects ${String(bad)}`)
}

console.log(`site-readiness: ${passed} checks passed`)
