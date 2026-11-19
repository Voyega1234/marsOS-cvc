// Brand Radar insight (pure helpers): npx tsx src/lib/brand-radar/insight.test.ts
import {
  INSIGHT_LIMITS, aggregateInsight, bangkokDay, cleanFoundSources, cleanQueries, dailyTrend, emptyInsight, mentionStyleOf, normalizeQueryKey,
  parseStoredFoundSources, parseStoredQueries, parseStoredSentiment, sanitizeSentiment, type InsightRow, type SentimentEntityRef,
} from './insight'
import type { Dataset } from './metrics'
import { answerZone, type AnswerSentiment, type EntityShare } from './types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

// normalizeQueryKey
eq(normalizeQueryKey('  Best   CRM  '), 'best crm', 'key: case + whitespace')
eq(normalizeQueryKey(''), '', 'key: empty')
eq(normalizeQueryKey('   \n\t '), '', 'key: whitespace only')
eq(normalizeQueryKey('ＡＢＣ'), 'abc', 'key: NFKC full-width')
eq(normalizeQueryKey('a'.repeat(400)).length, INSIGHT_LIMITS.queryMaxLen, 'key: capped')

// cleanQueries
eq(cleanQueries(null), [], 'clean: null')
eq(cleanQueries('abc'), [], 'clean: string')
eq(cleanQueries({ a: 1 }), [], 'clean: object')
eq(cleanQueries(['a', 1, null, {}, 'b']), ['a', 'b'], 'clean: non-string items skipped')
eq(cleanQueries(['Best CRM', 'best   crm', ' BEST CRM ', 'other']), ['Best CRM', 'other'], 'clean: dupes keep first spelling')
eq(cleanQueries(['', '   ']), [], 'clean: blanks dropped')
eq(cleanQueries(['x'.repeat(500)])[0].length, INSIGHT_LIMITS.queryMaxLen, 'clean: long capped')
eq(cleanQueries(['a  b\n c']), ['a b c'], 'clean: inner whitespace collapsed')
eq(cleanQueries(Array.from({ length: 50 }, (_, i) => `q${i}`)).length, INSIGHT_LIMITS.queriesPerAnswer, 'clean: count capped')
eq(cleanQueries(Array.from({ length: 50 }, (_, i) => `q${i}`))[19], 'q19', 'clean: first 20 kept')

// parseStoredQueries
eq(parseStoredQueries('not json'), [], 'stored queries: bad json')
eq(parseStoredQueries('{"a":1}'), [], 'stored queries: non-array json')
eq(parseStoredQueries(null), [], 'stored queries: null')
eq(parseStoredQueries(undefined), [], 'stored queries: undefined')
eq(parseStoredQueries(''), [], 'stored queries: empty')
eq(parseStoredQueries('["a","B","a"]'), ['a', 'B'], 'stored queries: valid')

// sanitizeSentiment
const resolve = (key: string): SentimentEntityRef | null =>
  key === 'brand' ? { entityType: 'brand', key: 'brand', name: 'Acme' }
  : key === 'c1' ? { entityType: 'competitor', key: 'c1', name: 'Rival' }
  : null
eq(sanitizeSentiment(null, resolve), null, 'sanitize: null')
eq(sanitizeSentiment('x', resolve), null, 'sanitize: string')
eq(sanitizeSentiment([], resolve), null, 'sanitize: array')
eq(sanitizeSentiment(5, resolve), null, 'sanitize: number')
eq(sanitizeSentiment({}, resolve), null, 'sanitize: nothing usable')
eq(sanitizeSentiment({ entities: [{ key: 'zzz', tone: 'positive' }] }, resolve), null, 'sanitize: unknown entity dropped')
eq(sanitizeSentiment({ entities: [{ key: 'brand', tone: 'ecstatic' }] }, resolve), null, 'sanitize: unknown tone dropped')
eq(sanitizeSentiment({ factors: ['price', 'bogus', 'price', 'quality'] }, resolve), { factors: ['price', 'quality'], entities: [] }, 'sanitize: unknown/dupe factors')
eq(sanitizeSentiment({ factors: ['price', 'quality', 'service', 'trust', 'expertise', 'reviews', 'convenience'] }, resolve)!.factors.length, INSIGHT_LIMITS.factorsPerAnswer, 'sanitize: answer factors capped')
const full = sanitizeSentiment({
  factors: ['price'],
  entities: [
    { key: 'brand', tone: 'positive', positioning: ['leader', 'bogus', 'premium', 'value', 'trusted'], summary: ` ${'s'.repeat(400)} `,
      factors: [{ code: 'price', polarity: 'negative' }, { code: 'price', polarity: 'positive' }, { code: 'nope', polarity: 'positive' }, { code: 'quality', polarity: 'weird' }, 'x', null],
      descriptors: ['Reliable', 'reliable', 'one two three four five', '', 'cheap  deal', 'fast', 'extra', 7] },
    { key: 'c1', tone: 'mixed' },
    { key: 'brand', tone: 'negative' },
    { key: 'ghost', tone: 'neutral' },
    'junk',
  ],
}, resolve)!
eq(full.entities.map((e) => e.key), ['brand', 'c1'], 'sanitize: unknown + duplicate entity dropped')
eq(full.entities[0].name, 'Acme', 'sanitize: name from resolve')
eq(full.entities[0].entityType, 'brand', 'sanitize: type from resolve')
eq(full.entities[0].positioning, ['leader', 'premium', 'value'], 'sanitize: positioning filtered + capped at 3')
eq(full.entities[0].summary.length, INSIGHT_LIMITS.summaryMax, 'sanitize: summary capped')
eq(full.entities[0].descriptors, ['reliable', 'cheap deal', 'fast'], 'sanitize: descriptors lowercased, <=4 words, deduped, capped at 3')
eq(full.entities[0].factors, [{ code: 'price', polarity: 'negative' }, { code: 'quality', polarity: 'neutral' }], 'sanitize: entity factors deduped, bad polarity = neutral')
eq(full.entities[1].tone, 'mixed', 'sanitize: tone kept')
eq(full.entities[1].summary, '', 'sanitize: missing summary empty')
const manyFactors = sanitizeSentiment({
  entities: [{ key: 'brand', tone: 'neutral', factors: ['price', 'quality', 'service', 'trust', 'expertise', 'reviews', 'convenience', 'variety'].map((code) => ({ code, polarity: 'positive' })) }],
}, resolve)!
eq(manyFactors.entities[0].factors.length, INSIGHT_LIMITS.factorsPerEntity, 'sanitize: entity factors capped at 6')
eq(sanitizeSentiment({ entities: [{ key: 'brand', tone: 'neutral', descriptors: ['a'.repeat(100)] }] }, resolve)!.entities[0].descriptors, [('a'.repeat(40))], 'sanitize: descriptor length capped')
eq(sanitizeSentiment({ entities: [{ key: 5, tone: 'neutral' }] }, resolve), null, 'sanitize: non-string key dropped')

// parseStoredSentiment
eq(parseStoredSentiment('nope'), null, 'stored sentiment: bad json')
eq(parseStoredSentiment(null), null, 'stored sentiment: null')
eq(parseStoredSentiment('[]'), null, 'stored sentiment: array')
const stored: AnswerSentiment = {
  factors: ['price'],
  entities: [
    { entityType: 'brand', key: 'brand', name: 'Acme', tone: 'positive', positioning: ['leader'], factors: [{ code: 'price', polarity: 'positive' }], summary: 'Good.', descriptors: ['reliable'] },
    { entityType: 'competitor', key: 'c1', name: 'Rival', tone: 'negative', positioning: [], factors: [], summary: '', descriptors: [] },
  ],
}
eq(parseStoredSentiment(JSON.stringify(stored)), stored, 'stored sentiment: round trip')
eq(parseStoredSentiment(JSON.stringify({ entities: [{ key: 'brand', tone: 'neutral' }] }))!.entities[0].entityType, 'brand', 'stored sentiment: key brand = brand')

// bangkokDay
eq(bangkokDay(new Date('2026-11-01T18:00:00Z')), '2026-11-02', 'bangkokDay: rolls over at 17:00Z')
eq(bangkokDay(new Date('2026-11-01T16:59:00Z')), '2026-11-01', 'bangkokDay: before rollover')

// aggregateInsight
const unavailable = aggregateInsight({ available: false, rows: [], groups: new Map(), promptText: new Map(), entityNames: new Map() })
eq(unavailable, emptyInsight(false), 'aggregate: unavailable = empty')
eq(unavailable.available, false, 'aggregate: unavailable flag')
const none = aggregateInsight({ available: true, rows: [], groups: new Map(), promptText: new Map(), entityNames: new Map() })
eq(none, emptyInsight(true), 'aggregate: no rows = empty available')
eq([none.analyzed, none.searches, none.queryGroups, none.entities], [0, 0, [], []], 'aggregate: empty counts')

const sent1: AnswerSentiment = {
  factors: ['price'],
  entities: [
    { entityType: 'brand', key: 'brand', name: 'old', tone: 'positive', positioning: ['trusted'], factors: [{ code: 'price', polarity: 'positive' }], summary: 'S1', descriptors: ['reliable'] },
    { entityType: 'competitor', key: 'c1', name: 'Rival', tone: 'negative', positioning: [], factors: [], summary: '', descriptors: [] },
  ],
}
const sent3: AnswerSentiment = {
  factors: ['price', 'quality'],
  entities: [
    { entityType: 'brand', key: 'brand', name: 'old', tone: 'mixed', positioning: [], factors: [{ code: 'price', polarity: 'negative' }], summary: 'S2', descriptors: ['reliable', 'cheap'] },
  ],
}
const rows: InsightRow[] = [
  { responseId: 'r1', promptId: 'p1', provider: 'openai', at: 1, searchQueries: ['Best CRM', 'best  crm', 'Pricing'], sentiment: sent1 },
  { responseId: 'r2', promptId: 'p1', provider: 'gemini', at: 2, searchQueries: ['hidden query'], sentiment: null },
  { responseId: 'r3', promptId: 'p2', provider: 'openai', at: 3, searchQueries: ['best crm'], sentiment: sent3 },
]
const agg = aggregateInsight({
  available: true, rows,
  groups: new Map([['best crm', 'CRM tools']]),
  promptText: new Map([['p1', 'Which CRM?'], ['p2', 'CRM cost?']]),
  entityNames: new Map([['brand', 'Acme']]),
})
eq(agg.answersWithQueries, 2, 'aggregate: hidden provider not counted')
eq(agg.searches, 4, 'aggregate: searches')
eq(agg.queryGroups.map((g) => [g.group, g.searches, g.answers]), [['CRM tools', 3, 2], ['Pricing', 1, 1]], 'aggregate: groups ordered by searches')
eq(agg.queryGroups[0].prompts, [{ promptId: 'p1', text: 'Which CRM?', searches: 2 }, { promptId: 'p2', text: 'CRM cost?', searches: 1 }], 'aggregate: prompts per group')
eq(agg.queryGroups[0].queries, [{ query: 'Best CRM', searches: 3 }], 'aggregate: first spelling kept')
eq(agg.queryGroups[0].providers, ['openai'], 'aggregate: providers')
eq(agg.analyzed, 2, 'aggregate: analyzed')
eq(agg.factors, [{ code: 'price', label: agg.factors[0].label, answers: 2, rate: 1 }, { code: 'quality', label: agg.factors[1].label, answers: 1, rate: 0.5 }], 'aggregate: factor counts + rates')
eq(agg.overallTones, { positive: 1, neutral: 0, negative: 1, mixed: 1 }, 'aggregate: overall tones')
eq(agg.entities.map((e) => [e.key, e.name, e.answers]), [['brand', 'Acme', 2], ['c1', 'Rival', 1]], 'aggregate: brand first, current name wins')
eq(agg.entities[0].tones, { positive: 1, neutral: 0, negative: 0, mixed: 1 }, 'aggregate: brand tones')
eq(agg.entities[0].summaries, ['S2', 'S1'], 'aggregate: summaries newest first')
eq(agg.entities[0].descriptors, [{ text: 'reliable', answers: 2 }, { text: 'cheap', answers: 1 }], 'aggregate: descriptors by count')
eq(agg.entities[0].positioning.map((p) => [p.code, p.answers, p.rate]), [['trusted', 1, 0.5]], 'aggregate: positioning rate')
eq(agg.entities[0].factors.map((f) => [f.code, f.answers, f.positive, f.negative, f.neutral]), [['price', 2, 1, 1, 0]], 'aggregate: entity factor polarity')

// mentionStyleOf
const ms = [
  { responseId: 'a', recommended: true, compared: false, position: 1 },
  { responseId: 'a', recommended: false, compared: false, position: 1 },
  { responseId: 'b', recommended: false, compared: true, position: 2 },
  { responseId: 'c', recommended: false, compared: false, position: 1 },
  { responseId: 'd', recommended: true, compared: true, position: null },
]
eq(mentionStyleOf(ms), { recommended: 2, compared: 1, listed: 1, first: 2, zones: { early: 0, middle: 0, late: 0 } }, 'mentionStyle: counts, one row per answer')
eq(mentionStyleOf(ms, new Set(['a', 'b'])), { recommended: 1, compared: 1, listed: 0, first: 1, zones: { early: 0, middle: 0, late: 0 } }, 'mentionStyle: subset')
eq(mentionStyleOf([]), { recommended: 0, compared: 0, listed: 0, first: 0, zones: { early: 0, middle: 0, late: 0 } }, 'mentionStyle: empty')
eq(mentionStyleOf(ms, new Set()), { recommended: 0, compared: 0, listed: 0, first: 0, zones: { early: 0, middle: 0, late: 0 } }, 'mentionStyle: empty subset')

// mentionStyleOf zones (null pct not counted)
const zs = [
  { responseId: 'a', recommended: false, compared: false, position: 1, positionPct: 0 },
  { responseId: 'b', recommended: false, compared: false, position: 1, positionPct: 0.5 },
  { responseId: 'c', recommended: false, compared: false, position: 1, positionPct: 0.9 },
  { responseId: 'd', recommended: false, compared: false, position: 1, positionPct: null },
  { responseId: 'e', recommended: false, compared: false, position: 1 },
]
eq(mentionStyleOf(zs).zones, { early: 1, middle: 1, late: 1 }, 'mentionStyle zones: null/missing pct not counted')
eq(answerZone(1 / 3), 'middle', 'answerZone: 1/3 is middle')
eq(answerZone(2 / 3), 'late', 'answerZone: 2/3 is late')
eq([answerZone(null), answerZone(undefined), answerZone(NaN)], [null, null, null], 'answerZone: unknown -> null')

// dailyTrend
const resp = (id: string, at: string | null, brandMentioned: boolean | null) => ({
  id, runId: 'run', promptId: 'p', provider: 'openai' as const, collectedAt: at ? new Date(at) : null,
  brandMentioned, brandOccurrences: null, brandRecommended: null, ownedCited: null, citationCount: null,
})
const mention = (responseId: string, competitorId: string) => ({
  responseId, runId: 'run', promptId: 'p', provider: 'openai' as const, entityType: 'competitor' as const, entityKey: competitorId,
  competitorId, entityName: competitorId, occurrences: 1, recommended: false, compared: false, position: null,
})
const ds = {
  brandName: 'Acme',
  responses: [
    resp('r1', '2026-11-01T10:00:00Z', true),
    resp('r2', '2026-11-01T18:00:00Z', false), // 2026-11-02 in Bangkok
    resp('r3', '2026-11-02T05:00:00Z', true),
    resp('r4', null, true), // no date: ignored
  ],
  mentions: [mention('r2', 'c1'), mention('r3', 'c1'), mention('r3', 'c1')],
  citations: [], prompts: [], competitors: [],
} as unknown as Dataset
const share = (key: string, entityType: 'brand' | 'competitor', mentions: number) => ({ key, name: key, entityType, mentions }) as unknown as EntityShare
const trend = dailyTrend(ds, [share('brand', 'brand', 2), share('c1', 'competitor', 2), share('c2', 'competitor', 0)])
eq(trend.trend.series.map((s) => s.key), ['brand', 'c1'], 'trend: brand + competitors with mentions')
eq(trend.trend.points, [{ date: '2026-11-01', asked: 1, values: [1, 0] }, { date: '2026-11-02', asked: 2, values: [0.5, 1] }], 'trend: per Bangkok day, distinct answers')
eq(trend.change, -0.5, 'trend: brand change')
eq(trend.entityChange, { brand: -0.5, c1: 1, c2: 0 }, 'trend: entity changes')
const oneDay = dailyTrend({ ...ds, responses: [resp('r1', '2026-11-01T10:00:00Z', true)], mentions: [] } as unknown as Dataset, [share('brand', 'brand', 1)])
eq(oneDay.change, null, 'trend: one day = null change')
eq(oneDay.trend.points.length, 1, 'trend: one point')
const emptyTrend = dailyTrend({ brandName: 'A', responses: [], mentions: [], citations: [], prompts: [], competitors: [] } as unknown as Dataset, [share('brand', 'brand', 0)])
eq(emptyTrend.trend.points, [], 'trend: empty points')
eq(emptyTrend.change, null, 'trend: empty change')
eq(emptyTrend.trend.series.map((s) => s.key), ['brand'], 'trend: empty keeps brand series')
const manyComps = dailyTrend(ds, [share('brand', 'brand', 1), ...Array.from({ length: 8 }, (_, i) => share(`k${i}`, 'competitor', 5))])
eq(manyComps.trend.series.length, 1 + INSIGHT_LIMITS.trendCompetitors, 'trend: competitor series capped')

// found-but-not-cited sources
eq(cleanFoundSources(null), [], 'found: null')
eq(cleanFoundSources('x'), [], 'found: string')
const fs1 = cleanFoundSources([
  { url: 'https://a.com/x', domain: 'a.com', title: '  Hello \n world ', ownerType: 'own' },
  { url: 'https://a.com/x', domain: 'a.com', title: 'dupe', ownerType: 'own' },
  { url: 'javascript:alert(1)', domain: 'evil', title: 't', ownerType: 'own' },
  { url: 'ftp://a.com/f', domain: 'a.com', title: 't', ownerType: 'own' },
  { url: 'http://b.com', domain: 'b.com', title: 'x'.repeat(500), ownerType: 'weird' },
  null, 5, { title: 'no url' },
])
eq(fs1.map((f) => f.url), ['https://a.com/x', 'http://b.com'], 'found: http(s) only, de-duplicated')
eq(fs1[0].title, 'Hello world', 'found: title whitespace collapsed')
eq(fs1[1].title.length, 300, 'found: title capped')
eq(fs1[1].ownerType, 'external', 'found: unknown owner -> external')
eq(cleanFoundSources(Array.from({ length: 40 }, (_, i) => ({ url: `https://a.com/${i}`, domain: 'a.com', title: '', ownerType: 'own' }))).length, 30, 'found: capped at 30')
eq(parseStoredFoundSources('not json'), [], 'found: malformed JSON')
eq(parseStoredFoundSources(null), [], 'found: null stored')
eq(parseStoredFoundSources(JSON.stringify([{ url: 'https://c.com', domain: 'c.com', title: 't', ownerType: 'competitor' }])).length, 1, 'found: round trip')

console.log(`insight.test.ts: ${passed} checks passed`)
