// Brand Radar metrics: npx tsx src/lib/brand-radar/metrics.test.ts
import {
  byIntent, byProvider, byTopic, citationGapDomains, citationOwners, citedDomains, competitorByTopic, competitorDomains, competitorTrend,
  computeKpis, entityShares, filterDataset, headToHead, promptEntityTrend, promptStatsMap, rate, shareOfVoice, topicProviderHeat, trendByRun, wilsonInterval,
  type CitationRow, type Dataset, type MentionRow, type PromptLite, type RespRow, type RunLite,
} from './metrics'
import type { CitationOwner } from './types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

function near(actual: number | null, expected: number, msg: string) {
  if (actual === null || Math.abs(actual - expected) > 1e-9) throw new Error(`FAIL: ${msg}\n  actual: ${actual}\n  expected: ${expected}`)
  passed++
}

const T = (d: string) => new Date(`2026-11-${d}T03:00:00.000Z`)

function resp(id: string, promptId: string, o: Partial<RespRow> = {}): RespRow {
  return {
    id, runId: 'r1', promptId, provider: 'openai', collectedAt: T('10'),
    brandMentioned: false, brandOccurrences: 0, brandRecommended: false, ownedCited: false, citationCount: 0, ...o,
  }
}
function men(responseId: string, promptId: string, entityType: 'brand' | 'competitor', key: string, o: Partial<MentionRow> = {}): MentionRow {
  return {
    responseId, runId: 'r1', promptId, provider: 'openai', entityType, entityKey: key,
    competitorId: entityType === 'competitor' ? key : null, entityName: key, occurrences: 1, recommended: false, compared: false, position: 1, ...o,
  }
}
function cit(responseId: string, promptId: string, domain: string, ownerType: CitationOwner, o: Partial<CitationRow> = {}): CitationRow {
  return {
    responseId, runId: 'r1', promptId, provider: 'openai', url: `https://${domain}/a`, normalizedUrl: `${domain}/a`, domain, title: '',
    ownerType, competitorId: null, createdAt: T('10'), ...o,
  }
}
const prompt = (id: string, o: Partial<PromptLite> = {}): PromptLite => ({ id, text: id, topic: 'crm', intent: 'recommendation', searchVolume: null, priority: 'medium', ...o })
const empty = (): Dataset => ({ brandName: 'Acme', responses: [], mentions: [], citations: [], prompts: [], competitors: [] })

// rate / SoV
eq(rate(1, 0), null, 'rate d=0 -> null')
eq(rate(0, 0), null, '0/0 -> null')
eq(rate(0, 4), 0, 'real zero stays 0')
eq(rate(1, 4), 0.25, 'rate')
eq(shareOfVoice(0, []), null, 'SoV zero denominator -> null')
eq(shareOfVoice(0, [0, 0]), null, 'SoV all zeros -> null')
eq(shareOfVoice(0, [3]), 0, 'SoV real zero when competitors exist')
eq(shareOfVoice(2, [1, 1]), 0.5, 'SoV')

// empty dataset: everything null, never 0
{
  const k = computeKpis(empty(), 0)
  eq([k.mentionRate, k.citationRate, k.competitorMentionRate, k.shareOfVoice, k.estimatedVisibility, k.lastScanAt], [null, null, null, null, null, null], 'empty dataset rates all null')
  eq([k.responses, k.brandMentions, k.brandOccurrences, k.citationCount, k.brandRecommended, k.estimatedVisibilityPrompts], [0, 0, 0, 0, 0, 0], 'empty dataset counts are 0')
  eq(entityShares(empty()), [{ entityType: 'brand', key: 'brand', name: 'Acme', mentions: 0, mentionRate: null, visible: 0, visibilityRate: null, recommended: 0, cited: 0, occurrences: 0, avgPosition: null, avgPositionPct: null, zones: { early: 0, middle: 0, late: 0 } }], 'brand always present, rate null')
  eq(byProvider(empty()), [], 'empty byProvider')
  eq(trendByRun(empty(), []), [], 'empty trend')
  eq(topicProviderHeat(empty()), { rows: [], columns: [], values: [] }, 'empty heat')
  eq(citedDomains(empty()), [], 'no domains')
}

// main dataset
// prompt A (vol 1000): r-a1 brand x3 recommended, own cited; r-a2 comp1 only; r-a3 nothing
// prompt B (vol unknown): r-b1 comp1+comp2, competitor citation; r-b2 brand, ext citation
// prompt C (vol 500): no response
const ds: Dataset = {
  brandName: 'Acme',
  competitors: [{ id: 'c1', name: 'Rival' }, { id: 'c2', name: 'Other' }, { id: 'c3', name: 'Silent' }],
  prompts: [prompt('A', { searchVolume: 1000, topic: 'crm', intent: 'recommendation' }), prompt('B', { topic: '', intent: 'informational' }), prompt('C', { searchVolume: 500 })],
  responses: [
    resp('a1', 'A', { brandMentioned: true, brandOccurrences: 3, brandRecommended: true, ownedCited: true, citationCount: 1, collectedAt: T('10') }),
    resp('a2', 'A', { provider: 'gemini', collectedAt: T('12') }),
    resp('a3', 'A', { provider: 'gemini', brandMentioned: null, brandOccurrences: null, ownedCited: null }),
    resp('b1', 'B', { provider: 'gemini', citationCount: 1 }),
    resp('b2', 'B', { brandMentioned: true, brandOccurrences: 1, citationCount: 1 }),
  ],
  mentions: [
    men('a1', 'A', 'brand', 'brand', { occurrences: 3, position: 1, recommended: true }),
    men('a2', 'A', 'competitor', 'c1', { position: 1 }),
    men('b1', 'B', 'competitor', 'c1', { position: 2 }),
    men('b1', 'B', 'competitor', 'c2', { position: 1, recommended: true }),
    men('b2', 'B', 'brand', 'brand', { position: 3 }),
    men('a2', 'A', 'competitor', 'ghost', { competitorId: 'ghost' }),
  ],
  citations: [
    cit('a1', 'A', 'acme.com', 'own'),
    cit('a1', 'A', 'news.com', 'external'),
    cit('b1', 'B', 'rival.com', 'competitor', { competitorId: 'c1', provider: 'gemini', createdAt: T('13') }),
    cit('b1', 'B', 'news.com', 'external', { provider: 'gemini' }),
    cit('b2', 'B', 'blog.com', 'external'),
    cit('b2', 'B', 'rival.com', 'competitor', { competitorId: 'c1', url: 'https://rival.com/b', normalizedUrl: 'rival.com/b' }),
  ],
}

const k = computeKpis(ds, 3)
eq(k.responses, 5, 'responses')
eq(k.brandMentions, 2, 'mention counted once per response')
eq(k.brandOccurrences, 4, 'occurrences summed separately, null as 0 (3+1)')
eq(k.mentionRate, 0.4, 'mention rate')
eq(k.citationCount, 1, 'citation count = own citation rows')
eq(k.citationRate, 0.2, 'citation rate = ownedCited responses / responses')
eq(k.competitorMentionRate, 0.4, 'competitor mention rate = distinct responses with any competitor (a2,b1) / 5')
eq(k.shareOfVoice, 0.4, 'SoV = 2 / (2 + c1 2 + c2 1 + c3 0); unknown competitor ignored')
eq(k.brandRecommended, 1, 'brand recommended')
near(k.estimatedVisibility, 1 / 3, 'estimated visibility ignores unknown volume and prompts without responses')
eq(k.estimatedVisibilityPrompts, 1, 'only prompt A fed visibility')
eq(k.monitoringPrompts, 3, 'monitoring prompts passthrough')
eq(k.lastScanAt, T('12').toISOString(), 'last scan = max collectedAt')

// estimated visibility null when no volume is known
{
  const noVol: Dataset = { ...ds, prompts: ds.prompts.map((p) => ({ ...p, searchVolume: null })) }
  const kk = computeKpis(noVol, 3)
  eq([kk.estimatedVisibility, kk.estimatedVisibilityPrompts], [null, 0], 'all volumes unknown -> null, not 0')
  const zeroVol: Dataset = { ...ds, prompts: ds.prompts.map((p) => ({ ...p, searchVolume: 0 })) }
  eq(computeKpis(zeroVol, 0).estimatedVisibility, null, 'volume 0 -> null')
}

// SoV null when nobody is mentioned
{
  const none: Dataset = { ...empty(), responses: [resp('x', 'A')], prompts: [prompt('A')], competitors: [{ id: 'c1', name: 'Rival' }] }
  const kk = computeKpis(none, 1)
  eq([kk.shareOfVoice, kk.mentionRate, kk.competitorMentionRate], [null, 0, 0], 'denominator 0 -> SoV null; real zero rates stay 0')
}

// filterDataset
{
  const g = filterDataset(ds, (r) => r.provider === 'gemini')
  eq(g.responses.map((r) => r.id), ['a2', 'a3', 'b1'], 'filter keeps matching responses')
  eq(g.mentions.length, 4, 'filter keeps only their mentions')
  eq(g.citations.length, 2, 'filter keeps only their citations')
  eq(ds.responses.length, 5, 'original untouched')
}

// entityShares
{
  const e = entityShares(ds)
  eq(e.map((x) => x.name), ['Acme', 'Rival', 'Other', 'Silent'], 'brand first, competitors by mentions desc, zero-mention competitor kept')
  eq(e[0], { entityType: 'brand', key: 'brand', name: 'Acme', mentions: 2, mentionRate: 0.4, visible: 2, visibilityRate: 0.4, recommended: 1, cited: 1, occurrences: 4, avgPosition: 2, avgPositionPct: null, zones: { early: 0, middle: 0, late: 0 } }, 'brand share')
  eq(e[1], { entityType: 'competitor', key: 'c1', name: 'Rival', mentions: 2, mentionRate: 0.4, visible: 3, visibilityRate: 0.6, recommended: 0, cited: 2, occurrences: 2, avgPosition: 1.5, avgPositionPct: null, zones: { early: 0, middle: 0, late: 0 } }, 'Rival share')
  eq(e[2].recommended, 1, 'Other recommended once')
  // Rival is named in a2,b1 and cited (without being named) in b2, so visible exceeds mentions
  eq([e[1].mentions, e[1].visible], [2, 3], 'Rival: cited in an answer that does not name it counts as visible')
  eq([e[2].visible, e[2].visibilityRate, e[3].visible, e[3].visibilityRate], [1, 0.2, 0, 0], 'Other/Silent visibility')
  eq([e[3].mentions, e[3].mentionRate, e[3].avgPosition], [0, 0, null], 'Silent: 0 mentions, rate 0, avgPosition null')
}

// avgPositionPct: null rows ignored, all-null -> null
{
  const d: Dataset = {
    ...empty(), responses: [resp('p1', 'A'), resp('p2', 'A'), resp('p3', 'A')], prompts: [prompt('A')],
    competitors: [{ id: 'c1', name: 'Rival' }],
    mentions: [
      men('p1', 'A', 'brand', 'brand', { positionPct: 0.1 }),
      men('p2', 'A', 'brand', 'brand', { positionPct: 0.5 }),
      men('p3', 'A', 'brand', 'brand', { positionPct: null }),
      men('p1', 'A', 'competitor', 'c1', { positionPct: null }),
    ],
  }
  const s = entityShares(d)
  eq(s[0].avgPositionPct !== null && Math.abs(s[0].avgPositionPct - 0.3) < 1e-9, true, 'avgPositionPct ignores null rows')
  eq(s[1].avgPositionPct, null, 'avgPositionPct all-null -> null')
  eq(s[0].zones, { early: 1, middle: 1, late: 0 }, 'zones count rows with a position only')
  eq(s[1].zones, { early: 0, middle: 0, late: 0 }, 'zones all-null -> zero counts')
}

// promptStatsMap
{
  const m = promptStatsMap(ds)
  eq(Array.from(m.keys()), ['A', 'B', 'C'], 'one entry per prompt')
  const a = m.get('A')!
  eq([a.responses, a.brandMentions, a.brandRecommended, a.ownedCited], [3, 1, 1, 1], 'A counts')
  near(a.mentionRate, 1 / 3, 'A mention rate')
  near(a.citationRate, 1 / 3, 'A citation rate')
  eq(a.topCompetitor?.name, 'Rival', 'A top competitor')
  eq(a.lastCollectedAt, T('12').toISOString(), 'A last collected')
  const b = m.get('B')!
  eq([b.responses, b.mentionRate, b.citationRate], [2, 0.5, 0], 'B: real zero citation rate')
  eq(b.topCompetitor, { id: 'c1', name: 'Rival', mentionRate: 0.5 }, 'B top competitor tie -> first listed')
  eq(m.get('C'), { responses: 0, brandMentions: 0, mentionRate: null, brandRecommended: 0, ownedCited: 0, citationRate: null, topCompetitor: null, lastCollectedAt: null }, 'C no responses: rates null')
}

// trend + comparability
const ds2: Dataset = { ...ds, responses: ds.responses.map((r) => (['a3', 'b1', 'b2'].includes(r.id) ? { ...r, runId: 'r2' } : r)) }
const P1 = '["openai","gemini"]'
const run = (id: string, day: string, hash: string, providers = P1): RunLite => ({ id, startedAt: T(day), promptSetHash: hash, providers })
const runs: RunLite[] = [run('r2', '14', 'H1'), run('r1', '10', 'H2'), run('r0', '05', 'H1')]
{
  const t = trendByRun(ds2, runs)
  eq(t.map((x) => x.runId), ['r1', 'r2'], 'oldest first, runs without responses dropped')
  eq(t.map((x) => x.comparable), [false, true], 'different prompt set = not comparable; newest comparable with itself')
  eq(t[0].label, '10/11', 'DD/MM label')
  eq([t[0].responses, t[0].mentionRate, t[0].citationRate, t[0].shareOfVoice], [2, 0.5, 0.5, 0.5], 'r1 point')
  near(t[1].mentionRate, 1 / 3, 'r2 mention rate')
  eq(t[1].date, T('14').toISOString(), 'date ISO')
  const sameSet = trendByRun(ds2, [run('r2', '14', 'H1'), run('r1', '10', 'H1')])
  eq(sameSet.map((x) => x.comparable), [true, true], 'same hash + providers = comparable')
  const diffProv = trendByRun(ds2, [run('r2', '14', 'H1'), run('r1', '10', 'H1', '["openai"]')])
  eq(diffProv.map((x) => x.comparable), [false, true], 'different providers = not comparable')
  eq(trendByRun(ds2, []), [], 'no runs')
  // Bangkok date label: 2026-11-30T20:00Z is 1 Dec in Bangkok
  const late = trendByRun(ds2, [{ id: 'r1', startedAt: new Date('2026-11-30T20:00:00.000Z'), promptSetHash: 'x', providers: P1 }])
  eq(late[0].label, '01/12', 'label uses Bangkok date')
}

// breakdowns
{
  const p = byProvider(ds)
  eq(p.map((x) => x.provider), ['openai', 'gemini'], 'provider order')
  eq([p[0].responses, p[0].mentionRate, p[0].citationRate, p[0].shareOfVoice], [2, 1, 0.5, 1], 'openai')
  eq([p[1].responses, p[1].mentionRate, p[1].citationRate, p[1].shareOfVoice], [3, 0, 0, 0], 'gemini real zeros')
  eq(p[0].method, 'observed_chat', 'method from PROVIDERS')

  const i = byIntent(ds)
  eq(i.map((x) => [x.intent, x.label, x.prompts, x.responses]), [['informational', 'Informational', 1, 2], ['recommendation', 'Recommendation', 1, 3]], 'by intent (prompts with responses only)')
  eq(i[0].mentionRate, 0.5, 'intent mention rate')

  const t = byTopic(ds)
  eq(t.map((x) => [x.topic, x.prompts, x.responses]), [['crm', 1, 3], ['(no topic)', 1, 2]], 'by topic, empty topic labelled, sorted by responses')
  near(t[0].citationRate, 1 / 3, 'topic citation rate')

  const h = topicProviderHeat(ds)
  eq(h.rows, ['crm', '(no topic)'], 'heat rows')
  eq(h.columns, ['ChatGPT', 'Google Gemini'], 'heat columns short labels')
  eq(h.values, [[1, 0], [1, 0]], 'heat values')

  const sparse: Dataset = {
    ...empty(),
    prompts: [prompt('X', { topic: 'x' }), prompt('Y', { topic: 'y' })],
    responses: [resp('1', 'X', { provider: 'openai', brandMentioned: true }), resp('2', 'Y', { provider: 'gemini' })],
  }
  const hs = topicProviderHeat(sparse)
  eq(hs.values, [[1, null], [null, 0]], 'cell without responses is null, not 0')

  const many: Dataset = {
    ...empty(),
    prompts: Array.from({ length: 15 }, (_, n) => prompt(`p${n}`, { topic: `t${n}` })),
    responses: Array.from({ length: 15 }, (_, n) => resp(`r${n}`, `p${n}`)),
  }
  eq(topicProviderHeat(many).rows.length, 12, 'heat capped at 12 topics')

  eq(citationOwners(ds), [{ ownerType: 'own', citations: 1 }, { ownerType: 'competitor', citations: 2 }, { ownerType: 'external', citations: 3 }], 'citation owners')
}

// cited domains
{
  const d = citedDomains(ds)
  eq(d.map((x) => x.domain), ['news.com', 'rival.com', 'acme.com', 'blog.com'], 'sorted by responses desc, citations desc, domain')
  const rival = d[1]
  eq([rival.ownerType, rival.competitorId, rival.competitorName, rival.citations, rival.responses, rival.prompts], ['competitor', 'c1', 'Rival', 2, 2, 1], 'rival row')
  eq(rival.urls.map((u) => u.url), ['https://rival.com/a', 'https://rival.com/b'], 'urls by count then url')
  eq(rival.providers, ['openai', 'gemini'], 'distinct providers')
  eq(rival.lastSeenAt, T('13').toISOString(), 'last seen = max createdAt')
  eq([rival.vendor, rival.isOwnPbn], [null, false], 'vendor/pbn left for the server')
  eq([d[0].competitorId, d[0].competitorName], [null, ''], 'external domain has no competitor')
  eq(d[0].prompts, 2, 'news.com cited for 2 prompts')
  const many: Dataset = { ...empty(), responses: [resp('1', 'A')], citations: Array.from({ length: 7 }, (_, n) => cit('1', 'A', 'big.com', 'external', { url: `https://big.com/${n}`, normalizedUrl: `big.com/${n}` })) }
  eq(citedDomains(many)[0].urls.length, 5, 'urls capped at 5')
}

// citation gap
{
  const g = citationGapDomains(ds)
  eq(g.map((x) => x.domain), ['rival.com', 'blog.com'], 'gap = non-own domains never cited next to an own domain; news.com excluded (a1 cites own)')
  eq(citationGapDomains(empty()), [], 'empty gap')
}

// head to head
{
  const h = headToHead(ds)
  eq(h, [
    { competitorId: 'c1', name: 'Rival', bothMentioned: 2, onlyCompetitor: 0, onlyBrand: 0, neither: 0 },
    { competitorId: 'c2', name: 'Other', bothMentioned: 1, onlyCompetitor: 0, onlyBrand: 1, neither: 0 },
    { competitorId: 'c3', name: 'Silent', bothMentioned: 0, onlyCompetitor: 0, onlyBrand: 2, neither: 0 },
  ], 'head to head over prompts with responses (C excluded)')
  const only: Dataset = {
    ...empty(), competitors: [{ id: 'c1', name: 'Rival' }], prompts: [prompt('A'), prompt('B')],
    responses: [resp('1', 'A'), resp('2', 'B')], mentions: [men('1', 'A', 'competitor', 'c1')],
  }
  eq(headToHead(only)[0], { competitorId: 'c1', name: 'Rival', bothMentioned: 0, onlyCompetitor: 1, onlyBrand: 0, neither: 1 }, 'onlyCompetitor + neither')
}

// competitor trend / by topic / domains / prompt trend
{
  const ct = competitorTrend(ds2, runs)
  eq(ct.map((s) => s.key), ['brand', 'c1', 'c2', 'c3'], 'brand series first')
  eq(ct.every((s) => s.points.length === 2), true, 'one point per run of trendByRun')
  eq(ct[0].points.map((p) => p.runId), ['r1', 'r2'], 'same run order')
  eq(ct[1].points[0].mentionRate, 0.5, 'Rival r1')
  near(ct[1].points[1].mentionRate, 1 / 3, 'Rival r2')
  eq(ct[3].points.map((p) => p.mentionRate), [0, 0], 'Silent has real zeros')

  const bt = competitorByTopic(ds)
  eq(bt.rows, ['Acme', 'Rival', 'Other', 'Silent'], 'by topic rows')
  eq(bt.columns, ['crm', '(no topic)'], 'by topic columns')
  near(bt.values[0][0], 1 / 3, 'brand crm')
  eq(bt.values[0][1], 0.5, 'brand no topic')
  eq(bt.values[2], [0, 0.5], 'Other')
  eq(competitorByTopic(empty()), { rows: ['Acme'], columns: [], values: [[]] }, 'empty by topic')

  eq(competitorDomains(ds), [
    { competitorId: 'c1', name: 'Rival', domains: [{ domain: 'rival.com', citations: 2 }] },
    { competitorId: 'c2', name: 'Other', domains: [] },
    { competitorId: 'c3', name: 'Silent', domains: [] },
  ], 'competitor domains')

  const pt = promptEntityTrend(ds2, runs)
  eq(pt.map((x) => x.runId), ['r1', 'r2'], 'prompt trend runs')
  eq([pt[0].responses, pt[0].brandMentionRate, pt[0].topCompetitorRate], [2, 0.5, 0.5], 'prompt trend r1')
  near(pt[1].topCompetitorRate, 1 / 3, 'prompt trend r2 top competitor')
  const noComp = promptEntityTrend({ ...ds2, competitors: [] }, runs)
  eq(noComp[0].topCompetitorRate, null, 'no competitors configured -> null')
}

// Wilson interval (95%)
{
  const r2 = (x: { low: number; high: number } | null) => x && [Math.round(x.low * 1000) / 1000, Math.round(x.high * 1000) / 1000]
  eq(wilsonInterval(0, 0), null, 'wilson: no asks -> null, not 0')
  eq(wilsonInterval(3, 2), null, 'wilson: k > n rejected')
  eq(r2(wilsonInterval(5, 10)), [0.237, 0.763], 'wilson 5/10')
  eq(r2(wilsonInterval(15, 30)), [0.332, 0.668], 'wilson 15/30')
  eq(r2(wilsonInterval(0, 10)), [0, 0.278], 'wilson 0/10 keeps an upper bound')
  eq(r2(wilsonInterval(10, 10)), [0.722, 1], 'wilson 10/10 keeps a lower bound')
  const w1 = wilsonInterval(1, 1)!
  eq(w1.high - w1.low > 0.7, true, 'wilson: one ask is nearly uninformative')
  const w30 = wilsonInterval(15, 30)!, w10 = wilsonInterval(5, 10)!
  eq(w30.high - w30.low < w10.high - w10.low, true, 'wilson: more asks -> narrower range')
}

console.log(`metrics.test.ts: ${passed} assertions passed`)
