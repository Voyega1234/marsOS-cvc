/**
 * Run: npx tsx src/lib/brand-radar/citation-analysis.test.ts
 */
import assert from 'node:assert/strict'
import {
  assembleCitationAnalysis, applyDomainFlags, computeSignals, inferPageType, inferSiteType, sharesTerm,
  type AnalysisInput, type PreviousData,
} from './citation-analysis'
import type { CitationRow, MentionRow, RespRow } from './metrics'
import { PROVIDERS, type ProviderKey } from './types'

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

const T0 = Date.UTC(2026, 10, 1, 5, 0, 0)
const DAY = 24 * 3600_000
const at = (days: number) => new Date(T0 + days * DAY)

function resp(id: string, runId: string, promptId: string, provider: ProviderKey, day: number, o: Partial<RespRow> = {}): RespRow {
  return { id, runId, promptId, provider, collectedAt: at(day), brandMentioned: false, brandOccurrences: 0, brandRecommended: false, ownedCited: false, citationCount: 0, ...o }
}
function cite(responseId: string, runId: string, promptId: string, provider: ProviderKey, url: string, o: Partial<CitationRow> = {}): CitationRow {
  const u = new URL(url)
  return {
    responseId, runId, promptId, provider, url, normalizedUrl: u.hostname + u.pathname, domain: u.hostname.replace(/^www\./, ''),
    title: '', ownerType: 'external', competitorId: null, createdAt: at(0), ...o,
  }
}
function mention(responseId: string, runId: string, promptId: string, provider: ProviderKey, competitorId: string, name: string): MentionRow {
  return { responseId, runId, promptId, provider, entityType: 'competitor', entityKey: competitorId, competitorId, entityName: name, occurrences: 1, recommended: false, compared: false, position: 1 }
}

const prompts = [
  { id: 'p1', text: 'best crm software for small business', topic: '', intent: 'informational' as const, searchVolume: null, priority: 'medium' as const },
  { id: 'p2', text: 'ราคาบริการทำความสะอาดคอนโด', topic: '', intent: 'informational' as const, searchVolume: null, priority: 'medium' as const },
]

// Run r1 (day 0): 3 answers. Run r2 (day 3): 3 answers.
const responses: RespRow[] = [
  resp('a1', 'r1', 'p1', 'openai', 0, { brandMentioned: true, brandRecommended: true }),
  resp('a2', 'r1', 'p1', 'openai', 0, { brandMentioned: true }),
  resp('a3', 'r1', 'p2', 'gemini', 0),
  resp('b1', 'r2', 'p1', 'openai', 3, { brandMentioned: true }),
  resp('b2', 'r2', 'p1', 'openai', 3),
  resp('b3', 'r2', 'p2', 'gemini', 3, { brandMentioned: true }),
]
const citations: CitationRow[] = [
  cite('a1', 'r1', 'p1', 'openai', 'https://www.mine.com/crm-guide', { ownerType: 'own', title: 'CRM guide' }),
  cite('a1', 'r1', 'p1', 'openai', 'https://other.com/best-crm-software', { title: 'Best CRM software' }),
  cite('a2', 'r1', 'p1', 'openai', 'https://other.com/best-crm-software', { title: 'Best CRM software' }),
  cite('a2', 'r1', 'p1', 'openai', 'https://rival.com/', { ownerType: 'competitor', competitorId: 'c1' }),
  cite('a3', 'r1', 'p2', 'gemini', 'https://other.com/review/condo', { title: 'x' }),
  cite('b1', 'r2', 'p1', 'openai', 'https://other.com/best-crm-software'),
  cite('b1', 'r2', 'p1', 'openai', 'https://rival.com/', { ownerType: 'competitor', competitorId: 'c1' }),
  cite('b2', 'r2', 'p1', 'openai', 'https://rival.com/pricing', { ownerType: 'competitor', competitorId: 'c2' }),
  cite('b3', 'r2', 'p2', 'gemini', 'https://newsite.com/x'),
]
const mentions: MentionRow[] = [
  mention('b1', 'r2', 'p1', 'openai', 'c1', 'Rival One'),
  mention('b2', 'r2', 'p1', 'openai', 'c2', 'Rival Two'),
  mention('b2', 'r2', 'p1', 'openai', 'c1', 'Rival One'),
]
const runs = [
  { id: 'r1', startedAt: at(0), promptSetHash: 'h', providers: '' },
  { id: 'r2', startedAt: at(3), promptSetHash: 'h', providers: '' },
]
const positions = new Map<string, number>([
  ['a1|other.com/best-crm-software', 1], ['a2|other.com/best-crm-software', 0], ['b1|other.com/best-crm-software', 0],
])
const prev: PreviousData = {
  range: { from: '2026-10-25', to: '2026-10-31' },
  responses: [
    { id: 'x1', brandMentioned: true, brandRecommended: false },
    { id: 'x2', brandMentioned: false, brandRecommended: false },
  ],
  citations: [
    { responseId: 'x1', domain: 'other.com', ownerType: 'external' },
    { responseId: 'x2', domain: 'mine.com', ownerType: 'own' },
  ],
}

function input(o: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    ds: { brandName: 'Mine', responses, mentions, citations, prompts, competitors: [{ id: 'c1', name: 'Rival One' }] },
    runs,
    positions,
    tones: new Map([['a1', 'positive'], ['a2', 'neutral'], ['b1', 'negative']]),
    prev,
    competitorNames: new Map([['c1', 'Rival One'], ['c2', 'Rival Two']]),
    activeCompetitorIds: new Set(['c1']),
    clientView: false,
    range: { from: '2026-11-01', to: '2026-11-07' },
    ...o,
  }
}

const dto = assembleCitationAnalysis(input())
const dom = (d: string) => dto.domains.find((x) => x.domain === d)!

test('totals', () => {
  const t = dto.totals
  assert.equal(t.answers, 6)
  assert.equal(t.answersWithCitations, 6)
  assert.equal(t.citations, 9)
  assert.equal(t.domains, 4)
  assert.equal(t.ownCitedAnswers, 1)
  assert.equal(t.ownCitations, 1)
  assert.equal(t.ownCitationShare, 1 / 9)
  assert.equal(t.citationRate, 1 / 6)
  assert.equal(t.brandMentions, 4)
  assert.equal(t.brandRecommended, 1)
  assert.equal(t.mentionedNotCited, 3)
  assert.equal(t.competitorCitedNotUs, 3)
  assert.equal(t.runs, 2)
  assert.equal(t.prompts, 2)
})

test('previous period', () => {
  assert.equal(dto.previous?.answers, 2)
  assert.equal(dto.previous?.mentionRate, 0.5)
  assert.equal(dto.previous?.citationRate, 0.5)
  assert.equal(dto.previous?.domains, 2)
  assert.equal(assembleCitationAnalysis(input({ prev: null })).previous, null)
  assert.equal(assembleCitationAnalysis(input({ prev: { ...prev, responses: [], citations: [] } })).previous, null)
})

test('runs oldest first', () => {
  assert.deepEqual(dto.runs.map((r) => [r.runId, r.answers]), [['r1', 3], ['r2', 3]])
})

test('trend by day and by run', () => {
  assert.deepEqual(dto.trend.byDay.map((p) => p.key), ['2026-11-01', '2026-11-04'])
  const d1 = dto.trend.byDay[0]
  assert.equal(d1.answers, 3)
  assert.equal(d1.mentionRate, 2 / 3)
  assert.equal(d1.citationRate, 1 / 3)
  assert.equal(d1.recommendedRate, 1 / 3)
  assert.equal(d1.competitorCitationRate, 1 / 3)
  assert.deepEqual(d1.sentiment, { positive: 1, neutral: 1, mixed: 0, negative: 0 })
  const r2 = dto.trend.byRun[1]
  assert.equal(r2.key, 'r2')
  assert.equal(r2.competitorCitationRate, 2 / 3)
  assert.deepEqual(r2.sentiment, { positive: 0, neutral: 0, mixed: 0, negative: 1 })
  const none = assembleCitationAnalysis(input({ tones: new Map() }))
  assert.equal(none.trend.byRun[0].sentiment, null)
})

test('domain grouping, series, position, change, sample', () => {
  assert.equal(dto.domains[0].domain, 'other.com')
  const o = dom('other.com')
  assert.equal(o.answers, 4)
  assert.equal(o.citations, 4)
  assert.equal(o.answerShare, 4 / 6)
  assert.deepEqual(o.series, [1, r4(1 / 3)])
  assert.equal(o.runsPresent, 2)
  assert.equal(o.runsTotal, 2)
  assert.equal(o.avgPosition, 1.33)
  assert.equal(o.previousAnswers, 1)
  assert.equal(o.change, 'up')
  assert.equal(o.sample?.runId, 'r2')
  assert.equal(o.pages[0].url, 'https://other.com/best-crm-software')
  assert.equal(o.pages[0].title, 'Best CRM software')
  assert.equal(o.pages[0].pageType, 'list')
  assert.equal(o.promptsList[0].promptId, 'p1')
  assert.equal(o.promptsList[0].asked, 4)
  assert.equal(dom('newsite.com').change, 'new')
  assert.equal(dom('newsite.com').previousAnswers, 0)
  assert.equal(dom('mine.com').ownerType, 'own')
  assert.equal(dom('mine.com').siteType, 'official')
  assert.equal(dom('rival.com').competitorName, 'Rival One')
  assert.equal(assembleCitationAnalysis(input({ prev: null })).domains[0].change, null)
  assert.equal(assembleCitationAnalysis(input({ prev: null })).domains[0].previousAnswers, null)
})

function r4(n: number) { return Math.round(n * 10000) / 10000 }

test('inferSiteType', () => {
  assert.equal(inferSiteType('x.com', [], 'own'), 'official')
  assert.equal(inferSiteType('pantip.com', [], 'external'), 'forum')
  assert.equal(inferSiteType('foo.com', ['https://forum.foo.com/t/1'], 'external'), 'forum')
  assert.equal(inferSiteType('facebook.com', [], 'external'), 'social')
  assert.equal(inferSiteType('youtube.com', [], 'external'), 'video')
  assert.equal(inferSiteType('wikipedia.org', [], 'external'), 'reference')
  assert.equal(inferSiteType('shopee.co.th', [], 'external'), 'marketplace')
  assert.equal(inferSiteType('moe.go.th', [], 'external'), 'government')
  assert.equal(inferSiteType('chula.ac.th', [], 'external'), 'government')
  assert.equal(inferSiteType('thairath.co.th', [], 'external'), 'news')
  assert.equal(inferSiteType('foo.com', ['https://foo.com/news/a', 'https://foo.com/news/b'], 'external'), 'news')
  assert.equal(inferSiteType('wongnai.com', [], 'external'), 'review')
  assert.equal(inferSiteType('foo.com', ['https://foo.com/รีวิว-คอนโด', 'https://foo.com/x-vs-y'], 'external'), 'review')
  assert.equal(inferSiteType('clutch.co', [], 'external'), 'directory')
  assert.equal(inferSiteType('foo.com', ['https://foo.com/blog/a', 'https://foo.com/blog/b', 'https://foo.com/c'], 'external'), 'blog')
  assert.equal(inferSiteType('foo.com', ['https://foo.com/about'], 'external'), 'other')
})

test('inferPageType', () => {
  assert.equal(inferPageType('https://a.com/'), 'home')
  assert.equal(inferPageType('https://a.com'), 'home')
  assert.equal(inferPageType('https://a.com/crm-vs-erp'), 'comparison')
  assert.equal(inferPageType('https://a.com/%E0%B9%80%E0%B8%9B%E0%B8%A3%E0%B8%B5%E0%B8%A2%E0%B8%9A%E0%B9%80%E0%B8%97%E0%B8%B5%E0%B8%A2%E0%B8%9A-crm'), 'comparison')
  assert.equal(inferPageType('https://a.com/best-crm'), 'list')
  assert.equal(inferPageType('https://a.com/10-tips'), 'list')
  assert.equal(inferPageType('https://a.com/แนะนำคอนโด'), 'list')
  assert.equal(inferPageType('https://a.com/review/foo'), 'review')
  assert.equal(inferPageType('https://a.com/รีวิว-คอนโด'), 'review')
  assert.equal(inferPageType('https://a.com/pricing'), 'product')
  assert.equal(inferPageType('https://a.com/blog/hello'), 'article')
  assert.equal(inferPageType('https://a.com/บทความ/x'), 'article')
  assert.equal(inferPageType('https://pantip.com/topic/123'), 'forum thread')
  assert.equal(inferPageType('https://www.youtube.com/watch?v=1'), 'video')
  assert.equal(inferPageType('https://a.com/about'), 'other')
  assert.equal(inferPageType('https://a.com/%E0%B8'), 'other')
})

test('sharesTerm', () => {
  assert.equal(sharesTerm('best crm software for small business', 'Top CRM Software list'), true)
  assert.equal(sharesTerm('best crm software', 'about us'), false)
  assert.equal(sharesTerm('ราคาบริการทำความสะอาดคอนโด', 'บริการทำความสะอาด ราคาถูก'), true)
  assert.equal(sharesTerm('ราคาบริการทำความสะอาดคอนโด', 'something else'), false)
})

test('signal thresholds', () => {
  const base = {
    providersCiting: 1, providersTotal: 3, pageCount: 2, runsPresent: 1, runsTotal: 2, promptCount: 2, promptsAsked: 5,
    avgPosition: 4, titleMatch: { matched: 0, considered: 2 }, pageTypes: new Map<string, number>([['other', 5]]),
  }
  assert.deepEqual(computeSignals(base), [])
  const codes = (o: Partial<typeof base>) => computeSignals({ ...base, ...o }).map((s) => s.code)
  assert.deepEqual(codes({ providersCiting: 2 }), ['multi_platform'])
  assert.deepEqual(codes({ pageCount: 3 }), ['many_pages'])
  assert.deepEqual(codes({ runsPresent: 2 }), ['consistent'])
  assert.deepEqual(codes({ runsTotal: 1, runsPresent: 1 }), [])
  assert.deepEqual(codes({ promptCount: 3 }), ['many_prompts'])
  assert.deepEqual(codes({ avgPosition: 3 }), ['top_position'])
  assert.deepEqual(codes({ titleMatch: { matched: 1, considered: 2 } }), ['title_match'])
  const pt = computeSignals({ ...base, pageTypes: new Map([['list', 3], ['other', 2]]) })
  assert.deepEqual(pt, [{ code: 'page_type', value: 60, detail: 'list' }])
  assert.deepEqual(codes({ pageTypes: new Map([['list', 1], ['article', 1]]) }), [])
})

test('domain signals from data', () => {
  const o = dom('other.com')
  const codes = o.signals.map((s) => s.code)
  assert.ok(codes.includes('consistent'))
  assert.ok(codes.includes('top_position'))
  assert.ok(codes.includes('title_match'))
  assert.ok(codes.includes('multi_platform'))
})

test('variation', () => {
  const p1 = dto.variation.find((v) => v.promptId === 'p1' && v.provider === 'openai')!
  assert.equal(p1.runId, 'r2')
  assert.equal(p1.asks, 2)
  assert.equal(p1.previousRunId, 'r1')
  // b1: {other.com, rival.com}, b2: {rival.com}
  assert.equal(p1.stability, 0.5)
  assert.deepEqual(p1.alwaysCited, ['rival.com'])
  assert.deepEqual(p1.sometimesCited, ['other.com'])
  assert.deepEqual(p1.lostDomains, ['mine.com'])
  assert.deepEqual(p1.newDomains, [])
  // now 1/2 mentioned, before 2/2
  assert.equal(p1.mentionChange, -0.5)
  assert.deepEqual(p1.competitorsMentioned, [{ name: 'Rival One', answers: 2 }, { name: 'Rival Two', answers: 1 }])
  const p2 = dto.variation.find((v) => v.promptId === 'p2')!
  assert.equal(p2.asks, 1)
  assert.equal(p2.stability, null)
  assert.deepEqual(p2.alwaysCited, ['newsite.com'])
  assert.deepEqual(p2.newDomains, ['newsite.com'])
  assert.deepEqual(p2.lostDomains, ['other.com'])
  assert.equal(dto.variation[0].promptId, 'p1') // lowest stability first, nulls last
  assert.equal(p1.providerLabel, PROVIDERS.openai.label)
})

test('stability extremes', () => {
  const rs = [resp('s1', 'r1', 'p1', 'openai', 0), resp('s2', 'r1', 'p1', 'openai', 0)]
  const same = assembleCitationAnalysis(input({
    ds: { brandName: 'Mine', responses: rs, mentions: [], prompts, competitors: [], citations: [cite('s1', 'r1', 'p1', 'openai', 'https://a.com/x'), cite('s2', 'r1', 'p1', 'openai', 'https://a.com/y')] },
    prev: null,
  }))
  assert.equal(same.variation[0].stability, 1)
  const diff = assembleCitationAnalysis(input({
    ds: { brandName: 'Mine', responses: rs, mentions: [], prompts, competitors: [], citations: [cite('s1', 'r1', 'p1', 'openai', 'https://a.com/x'), cite('s2', 'r1', 'p1', 'openai', 'https://b.com/y')] },
    prev: null,
  }))
  assert.equal(diff.variation[0].stability, 0)
  assert.deepEqual(diff.variation[0].alwaysCited, [])
  const empty = assembleCitationAnalysis(input({
    ds: { brandName: 'Mine', responses: rs, mentions: [], prompts, competitors: [], citations: [] },
    prev: null,
  }))
  assert.equal(empty.variation[0].stability, 1)
})

test('own pages and gaps', () => {
  assert.equal(dto.ownPages.length, 1)
  assert.equal(dto.ownPages[0].url, 'https://www.mine.com/crm-guide')
  assert.equal(dto.ownPages[0].answers, 1)
  assert.deepEqual(dto.ownPages[0].prompts, [{ promptId: 'p1', text: prompts[0].text }])
  // mentioned, not cited: a2 (p1), b1 (p1), b3 (p2)
  const m = dto.gaps.mentionedNotCited
  assert.equal(m[0].promptId, 'p1')
  assert.equal(m[0].answers, 2)
  assert.equal(m[0].asked, 4)
  assert.equal(m[0].citedInstead[0], 'other.com')
  assert.equal(m[1].promptId, 'p2')
  // competitor cited, not us: a2, b1, b2 (all p1)
  const c = dto.gaps.competitorCitedNotUs
  assert.equal(c.length, 1)
  assert.equal(c[0].answers, 3)
  assert.deepEqual(c[0].competitors[0], { name: 'Rival One', domain: 'rival.com', answers: 2 })
})

test('client view strips vendor, pbn and inactive competitors', () => {
  const flagged = applyDomainFlags(
    dto.domains.map((d) => ({ ...d, vendor: { price: 1, currency: 'THB', domainRating: 1, traffic: 1, linkType: '', category: '' }, isOwnPbn: true })),
    null, true,
  )
  assert.ok(flagged.every((d) => d.vendor === null && d.isOwnPbn === false))
  const cv = assembleCitationAnalysis(input({ clientView: true, competitorNames: new Map([['c1', 'Rival One']]) }))
  const rival = cv.domains.find((d) => d.domain === 'rival.com')!
  // rival.com has a c1 (active) citation, so it stays a competitor; the c2 page is shown as external
  assert.equal(rival.ownerType, 'competitor')
  assert.equal(rival.competitorName, 'Rival One')
  const onlyInactive = assembleCitationAnalysis(input({
    clientView: true,
    competitorNames: new Map([['c1', 'Rival One']]),
    activeCompetitorIds: new Set(),
  }))
  const r2 = onlyInactive.domains.find((d) => d.domain === 'rival.com')!
  assert.equal(r2.ownerType, 'external')
  assert.equal(r2.competitorName, '')
  assert.equal(onlyInactive.gaps.competitorCitedNotUs.length, 0)
  assert.equal(onlyInactive.totals.competitorCitedNotUs, 0)
  assert.ok(onlyInactive.variation.every((v) => v.competitorsMentioned.length === 0))
  const p1 = cv.variation.find((v) => v.promptId === 'p1')!
  assert.deepEqual(p1.competitorsMentioned.map((c) => c.name), ['Rival One'])
})

test('empty dataset', () => {
  const e = assembleCitationAnalysis(input({ ds: { brandName: 'Mine', responses: [], mentions: [], citations: [], prompts, competitors: [] } }))
  assert.equal(e.hasData, false)
  assert.equal(e.totals.answers, 0)
  assert.equal(e.totals.mentionRate, null)
  assert.deepEqual(e.domains, [])
})

console.log(`citation-analysis: ${passed} tests passed`)
