// Brand Radar URL Monitor: npx tsx src/lib/brand-radar/url-monitor.test.ts
import type { CitationRow, Dataset, PromptLite, RespRow, RunLite } from './metrics'
import { RATE_FAIR_RATIO, RATE_GOOD_RATIO } from './scorecard'
import { PROVIDER_KEYS, type ProviderKey } from './types'
import {
  BENCHMARK_PROJECT, BENCHMARK_SOURCES, URL_MONITOR_MAX, buildUrlMonthStats, buildUrlReport, cleanMonitoredInput, parseMonitoredUrls,
  pickUrlMonths, summarizeUrls, urlMatcher, type UrlMonthRow,
} from './url-monitor'
import type { MonitoredUrl, UrlMonthStat } from './url-monitor-types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

const P0: ProviderKey = PROVIDER_KEYS[0]
const P1: ProviderKey = PROVIDER_KEYS[1]

// ── parseMonitoredUrls ───────────────────────────────────────────────────────
const mon = (id: string, normalizedUrl: string, prefix = false): MonitoredUrl => ({ id, url: `https://${normalizedUrl}`, normalizedUrl, prefix, addedAt: '2026-11-01T00:00:00.000Z' })

eq(parseMonitoredUrls(null), [], 'null -> []')
eq(parseMonitoredUrls(undefined), [], 'undefined -> []')
eq(parseMonitoredUrls(''), [], 'empty string -> []')
eq(parseMonitoredUrls('{not json'), [], 'invalid JSON -> []')
eq(parseMonitoredUrls('{"a":1}'), [], 'non-array -> []')
eq(parseMonitoredUrls('"x"'), [], 'string JSON -> []')
{
  const raw = JSON.stringify([
    { id: 'a', url: 'https://a.com', normalizedUrl: 'a.com', prefix: true, addedAt: 'T1' },
    { url: 'https://noid.com', normalizedUrl: 'noid.com' },
    { id: 'b', url: 'https://b.com' },
    { id: 'c', url: 'https://c.com', normalizedUrl: '' },
    { id: 'a', url: 'https://dup.com', normalizedUrl: 'dup.com' },
    null,
    'text',
    { id: 'd', url: 'https://d.com', normalizedUrl: 'd.com', prefix: 'true' },
    { id: 'e', url: 'https://e.com', normalizedUrl: 'e.com', prefix: 1 },
  ])
  const out = parseMonitoredUrls(raw)
  eq(out.map((m) => m.id), ['a', 'd', 'e'], 'drops no id / no normalizedUrl / duplicate id / non-objects')
  eq(out.map((m) => m.prefix), [true, false, false], 'prefix is true only for literal true')
  eq(out[1].addedAt, '', 'missing addedAt becomes empty string')
  eq(out[0].url, 'https://a.com', 'first duplicate id wins')
}
{
  const many = Array.from({ length: URL_MONITOR_MAX + 10 }, (_, i) => ({ id: `id${i}`, url: `https://s${i}.com`, normalizedUrl: `s${i}.com` }))
  const out = parseMonitoredUrls(JSON.stringify(many))
  eq(out.length, URL_MONITOR_MAX, 'stops at URL_MONITOR_MAX')
  eq(out[URL_MONITOR_MAX - 1].id, `id${URL_MONITOR_MAX - 1}`, 'keeps the first ones')
}

// ── cleanMonitoredInput ──────────────────────────────────────────────────────
{
  const bad = (r: ReturnType<typeof cleanMonitoredInput>) => (r.ok ? 'ok' : r.status)
  eq(bad(cleanMonitoredInput('', false, [])), 400, 'empty -> 400')
  eq(bad(cleanMonitoredInput('   ', false, [])), 400, 'blank -> 400')
  eq(bad(cleanMonitoredInput(undefined, false, [])), 400, 'non-string -> 400')
  eq(bad(cleanMonitoredInput('mailto:a@b.co', false, [])), 400, 'mailto -> 400')
  eq(bad(cleanMonitoredInput('not a url', false, [])), 400, 'text with spaces -> 400')

  const ok = cleanMonitoredInput('example.com/page/', false, [])
  eq(ok, { ok: true, item: { url: 'https://example.com/page/', normalizedUrl: 'example.com/page', prefix: false } }, 'bare host + path gets https and a normalized form')
  const ok2 = cleanMonitoredInput('https://www.Example.com/a?utm_source=x', false, [])
  eq(ok2.ok ? ok2.item.normalizedUrl : null, 'example.com/a', 'www, case and utm are dropped')
  eq(ok2.ok ? ok2.item.url : null, 'https://www.Example.com/a?utm_source=x', 'typed url kept as shown')
  const ok3 = cleanMonitoredInput('example.com', 'yes', [])
  eq(ok3.ok ? ok3.item.prefix : null, false, 'prefix only for literal true')
  const ok4 = cleanMonitoredInput('example.com', true, [])
  eq(ok4.ok ? ok4.item.prefix : null, true, 'prefix true')

  const list = [mon('1', 'example.com/page', false)]
  const dup = cleanMonitoredInput('https://example.com/page/', false, list)
  eq(dup.ok ? null : dup.status, 409, 'same normalizedUrl + same prefix -> 409')
  eq(cleanMonitoredInput('https://example.com/page', true, list).ok, true, 'same normalizedUrl, other prefix -> ok')

  const full = Array.from({ length: URL_MONITOR_MAX }, (_, i) => mon(`id${i}`, `s${i}.com`))
  const f = cleanMonitoredInput('new.com', false, full)
  eq(f.ok ? null : f.status, 400, 'list at max -> 400')
  const fdup = cleanMonitoredInput('s1.com', false, full)
  eq(fdup.ok ? null : fdup.status, 409, 'duplicate is checked before the cap')
}

// ── urlMatcher ───────────────────────────────────────────────────────────────
{
  const exact = urlMatcher({ normalizedUrl: 'example.com/a', prefix: false })
  eq(exact('example.com/a'), true, 'exact: same string')
  eq(exact('example.com/a/b'), false, 'exact: child not matched')
  eq(exact('example.com/a?x=1'), false, 'exact: query variant not matched')
  const pre = urlMatcher({ normalizedUrl: 'example.com/a', prefix: true })
  eq(pre('example.com/a'), true, 'prefix: base')
  eq(pre('example.com/a/x'), true, 'prefix: base/x')
  eq(pre('example.com/a?x=1'), true, 'prefix: base?x=1')
  eq(pre('example.com/a-other'), false, 'prefix: base-other not matched')
  eq(pre('example.com/ax'), false, 'prefix: basex not matched')
  eq(pre('example.com/b'), false, 'prefix: other page not matched')
  const preQ = urlMatcher({ normalizedUrl: 'example.com/a?id=1', prefix: true })
  eq(preQ('example.com/a?id=1'), true, 'prefix with ?: exact string')
  eq(preQ('example.com/a?id=1/x'), false, 'prefix with ?: nothing under it')
  eq(preQ('example.com/a?id=1&b=2'), false, 'prefix with ?: other query not matched')
}

// ── Hand-built dataset ───────────────────────────────────────────────────────
const D = (s: string) => new Date(s)
const prompts: PromptLite[] = [
  { id: 'p1', text: 'prompt one', topic: 'Alpha', intent: 'informational' as PromptLite['intent'], searchVolume: null, priority: 'medium' as PromptLite['priority'] },
  { id: 'p2', text: 'prompt two', topic: 'Beta', intent: 'informational' as PromptLite['intent'], searchVolume: null, priority: 'medium' as PromptLite['priority'] },
]
const runs: RunLite[] = [
  { id: 'r1', startedAt: D('2026-10-10T03:00:00Z'), promptSetHash: 'h', providers: `${P0},${P1}` },
  { id: 'r2', startedAt: D('2026-11-10T03:00:00Z'), promptSetHash: 'h', providers: `${P0},${P1}` },
]
function resp(id: string, runId: string, promptId: string, provider: ProviderKey, brand: boolean, at: string): RespRow {
  return { id, runId, promptId, provider, collectedAt: D(at), brandMentioned: brand, brandOccurrences: null, brandRecommended: null, ownedCited: null, citationCount: null }
}
function cite(responseId: string, url: string, position: number, title = ''): CitationRow {
  const r = responses.find((x) => x.id === responseId)!
  const normalizedUrl = url.replace(/^https:\/\//, '')
  return {
    responseId, runId: r.runId, promptId: r.promptId, provider: r.provider, url, normalizedUrl, domain: normalizedUrl.split('/')[0],
    title, ownerType: 'external', competitorId: null, createdAt: r.collectedAt, position,
  }
}
const responses: RespRow[] = [
  resp('a1', 'r1', 'p1', P0, true, '2026-10-10T03:00:00Z'),
  resp('a2', 'r1', 'p1', P1, false, '2026-10-10T03:30:00Z'),
  resp('a3', 'r1', 'p2', P0, false, '2026-10-10T04:00:00Z'),
  resp('a4', 'r1', 'p2', P1, true, '2026-10-10T05:00:00Z'),
  resp('a5', 'r2', 'p1', P0, true, '2026-11-10T04:00:00Z'),
  resp('a6', 'r2', 'p2', P1, false, '2026-11-10T04:30:00Z'),
]
const citations: CitationRow[] = [
  cite('a1', 'https://example.com/page', 0),
  cite('a2', 'https://other.com/x', 0),
  cite('a4', 'https://example.com/page', 2, 'Page title'),
  cite('a5', 'https://example.com/page', 1),
  cite('a5', 'https://other.com/x', 1),
  cite('a6', 'https://other.com/y', 0),
  cite('a6', 'https://other.com/x', 1),
  cite('a6', 'https://example.com/page/sub', 3),
]
const ds: Dataset = { brandName: 'Brand', responses, mentions: [], citations, prompts, competitors: [] }
const url = mon('u1', 'example.com/page')

{
  const { report, citing } = buildUrlReport(ds, runs, url)
  eq(Array.from(citing).sort(), ['a1', 'a4', 'a5'], 'citing set')
  eq(report.url, url, 'report echoes the url')
  const t = report.totals
  eq([t.answers, t.citingAnswers, t.citationRate], [6, 3, 0.5], 'N, C, AI Citation')
  eq([t.brandMentioned, t.brandMentionRate], [3, 1], 'B, Brand Mention')
  eq([t.prompts, t.citingPrompts, t.visibility], [2, 2, 1], 'P, K, Visibility')
  eq(t.avgPlace, 2, 'avgPlace = mean of (position + 1)')
  eq(t.lastCitedAt, '2026-11-10T04:00:00.000Z', 'lastCitedAt = newest citing answer')

  eq(report.byProvider, [
    { provider: P0, answers: 3, citingAnswers: 2, citationRate: 2 / 3, brandMentioned: 2, brandMentionRate: 1 },
    { provider: P1, answers: 3, citingAnswers: 1, citationRate: 1 / 3, brandMentioned: 1, brandMentionRate: 1 },
  ], 'byProvider rows')

  eq(report.prompts.map((p) => p.promptId), ['p1', 'p2'], 'prompts: most cited first')
  eq(report.prompts[0], {
    promptId: 'p1', text: 'prompt one', topic: 'Alpha', asked: 3, cited: 2, citationRate: 2 / 3, brandMentioned: 2, providers: [P0],
    latest: { responseId: 'a5', runId: 'r2', provider: P0, at: '2026-11-10T04:00:00.000Z' },
  }, 'prompt p1 row, latest = newest citing answer')
  eq(report.prompts[1], {
    promptId: 'p2', text: 'prompt two', topic: 'Beta', asked: 3, cited: 1, citationRate: 1 / 3, brandMentioned: 1, providers: [P1],
    latest: { responseId: 'a4', runId: 'r1', provider: P1, at: '2026-10-10T05:00:00.000Z' },
  }, 'prompt p2 row')

  eq(report.scans.length, 2, 'one scan per run')
  const pick = (s: (typeof report.scans)[number]) => [s.runId, s.date, s.asked, s.cited, s.citationRate, s.prompts, s.citingPrompts, s.visibility, s.brandMentioned, s.brandMentionRate, s.avgPlace]
  eq(pick(report.scans[0]), ['r1', '2026-10-10T03:00:00.000Z', 4, 2, 0.5, 2, 2, 1, 2, 1, 2], 'scan r1')
  eq(pick(report.scans[1]), ['r2', '2026-11-10T03:00:00.000Z', 2, 1, 0.5, 2, 1, 0.5, 1, 1, 2], 'scan r2')

  eq(report.pages, [{ url: 'https://example.com/page', title: 'Page title', answers: 3 }], 'pages: exact mode, title taken from any citation')

  eq(report.heat.rows, ['Alpha', 'Beta'], 'heat rows')
  eq(report.heat.columns.length, 2, 'heat columns')
  eq(report.heat.values, [[1, 0], [0, 0.5]], 'heat values = share of answers citing the URL per topic x provider')

  eq(report.scorecard.months, null, 'months are added by the loader')
  eq(report.scorecard.grades.map((g) => g.metric), ['citation', 'mention', 'position'], 'grade order')
  const [gc, gm, gp] = report.scorecard.grades
  eq([gc.value, gc.bestCompetitor, gc.grade, gc.rank, gc.outOf], [0.5, { name: 'https://other.com/x', value: 0.5 }, 'good', 1, 4], 'citation grade vs most cited other page')
  eq([gm.value, gm.bestCompetitor, gm.grade, gm.rank, gm.outOf], [1, { name: BENCHMARK_PROJECT, value: 0.5 }, 'good', 1, 2], 'mention grade vs project')
  eq([gp.value, gp.bestCompetitor, gp.grade, gp.rank, gp.outOf], [2, { name: BENCHMARK_SOURCES, value: 2 }, 'good', 1, 2], 'position grade vs other sources')
}

// prefix mode: more than one page, most cited first
{
  const { report, citing } = buildUrlReport(ds, runs, mon('u2', 'example.com/page', true))
  eq(Array.from(citing).sort(), ['a1', 'a4', 'a5', 'a6'], 'prefix: citing includes sub pages')
  eq(report.pages.map((p) => [p.url, p.answers]), [['https://example.com/page', 3], ['https://example.com/page/sub', 1]], 'prefix: pages most cited first')
  eq(report.totals.citingAnswers, 4, 'prefix: C counts each answer once')
}

// ── no data ──────────────────────────────────────────────────────────────────
{
  const empty: Dataset = { brandName: 'Brand', responses: [], mentions: [], citations: [], prompts, competitors: [] }
  const t = buildUrlReport(empty, runs, url).report.totals
  eq([t.answers, t.citationRate, t.brandMentionRate, t.visibility, t.avgPlace, t.lastCitedAt], [0, null, null, null, null, null], 'zero responses -> nulls, never 0')
  eq(buildUrlReport(empty, runs, url).report.byProvider, [], 'zero responses -> no provider rows')

  const noMatch: Dataset = { ...ds, citations: citations.filter((c) => c.normalizedUrl.startsWith('other.com')) }
  const r = buildUrlReport(noMatch, runs, url).report
  eq([r.totals.citationRate, r.totals.brandMentionRate, r.totals.avgPlace, r.totals.visibility, r.totals.lastCitedAt], [0, null, null, 0, null], 'no matching citation -> rate 0, mention/place null')
  eq(r.prompts.every((p) => p.latest === null && p.cited === 0), true, 'no matching citation -> no latest')
  eq(r.pages, [], 'no matching citation -> no pages')
}

// ── grades against the most cited other page ─────────────────────────────────
function gradedDs(ours: number, other: number, n = 10): Dataset {
  const rs: RespRow[] = Array.from({ length: n }, (_, i) => resp(`g${i}`, 'r1', 'p1', P0, i < 5, '2026-10-10T03:00:00Z'))
  const cs: CitationRow[] = []
  const add = (u: string, count: number, from: number) => {
    for (let i = 0; i < count; i++) {
      const r = rs[from + i]
      cs.push({ responseId: r.id, runId: 'r1', promptId: 'p1', provider: P0, url: `https://${u}`, normalizedUrl: u, domain: u.split('/')[0], title: '', ownerType: 'external', competitorId: null, createdAt: null, position: 0 })
    }
  }
  add('example.com/page', ours, 0)
  add('best.com/x', other, 0)
  return { brandName: 'Brand', responses: rs, mentions: [], citations: cs, prompts, competitors: [] }
}
{
  const cg = (ours: number, other: number) => buildUrlReport(gradedDs(ours, other), runs, url).report.scorecard.grades[0]
  eq(RATE_GOOD_RATIO, 0.8, 'threshold good')
  eq(RATE_FAIR_RATIO, 0.4, 'threshold fair')
  eq(cg(9, 10).grade, 'good', 'ratio 0.9 is good')
  eq(cg(6, 10).grade, 'fair', 'ratio 0.6 is fair')
  eq(cg(2, 10).grade, 'poor', 'ratio 0.2 is poor')
  eq(cg(0, 10).grade, 'poor', 'not cited at all is poor')
  const g = cg(6, 10)
  eq([g.value, g.bestCompetitor, g.rank, g.outOf], [0.6, { name: 'https://best.com/x', value: 1 }, 2, 2], 'rank/outOf and best other page')
  const none = buildUrlReport(gradedDs(5, 0), runs, url).report.scorecard.grades[0]
  eq([none.grade, none.rank, none.outOf, none.bestCompetitor], [null, null, 0, null], 'no other cited page -> not graded')
  const g3 = buildUrlReport(gradedDs(5, 0), runs, url).report.scorecard.grades
  eq(g3[1].bestCompetitor?.name, BENCHMARK_PROJECT, 'mention benchmark name')
  eq(g3[2].bestCompetitor, null, 'no other source -> position benchmark empty')
}

// ── summarizeUrls ────────────────────────────────────────────────────────────
{
  const y = mon('uy', 'other.com/y')
  const rows = summarizeUrls(ds, [y, url])
  eq(rows.map((r) => r.id), ['uy', 'u1'], 'stored order kept')
  eq(rows.map((r) => [r.citingAnswers, r.citationRate, r.citingPrompts, r.lastCitedAt]), [
    [1, 1 / 6, 1, '2026-11-10T04:30:00.000Z'],
    [3, 0.5, 2, '2026-11-10T04:00:00.000Z'],
  ], 'summary numbers')
  eq(rows[1].normalizedUrl, 'example.com/page', 'summary keeps the monitored fields')
  eq(summarizeUrls(ds, []), [], 'empty list')
}

// ── months ───────────────────────────────────────────────────────────────────
function mrow(startedAt: string, asked: number, cited: number, bm: number, placeSum: number, placeCount: number, promptIds: string[], citingPromptIds: string[]): UrlMonthRow {
  return { startedAt: D(startedAt), asked, cited, brandMentioned: bm, placeSum, placeCount, promptIds, citingPromptIds }
}
{
  const stats = buildUrlMonthStats([
    mrow('2026-11-15T05:00:00Z', 5, 1, 1, 3, 1, ['p1'], ['p1']),
    mrow('2026-10-15T05:00:00Z', 10, 2, 1, 4, 2, ['p1', 'p2'], ['p1']),
    mrow('2026-10-20T05:00:00Z', 10, 4, 2, 8, 4, ['p1', 'p2', 'p3'], ['p1', 'p2']),
    mrow('2026-11-16T05:00:00Z', 0, 0, 0, 0, 0, ['p9'], []),
    mrow('2026-09-15T05:00:00Z', 4, 0, 0, 0, 0, ['p1'], []),
  ])
  eq(stats.map((s) => s.month), ['2026-09', '2026-10', '2026-11'], 'months ascending, two Bangkok months aggregate separately')
  eq(stats[1], { month: '2026-10', scans: 2, asked: 20, cited: 6, citationRate: 0.3, visibility: 2 / 3, brandMentionRate: 0.5, avgPlace: 2 }, 'October aggregates both rounds; a prompt in two rounds counts once')
  eq(stats[2], { month: '2026-11', scans: 1, asked: 5, cited: 1, citationRate: 0.2, visibility: 1, brandMentionRate: 1, avgPlace: 3 }, 'round with asked 0 is skipped')
  eq([stats[0].citationRate, stats[0].visibility, stats[0].brandMentionRate, stats[0].avgPlace], [0, 0, null, null], 'September: 0 only where computable')
  eq(buildUrlMonthStats([]), [], 'no rows')
  eq(buildUrlMonthStats([mrow('2026-10-15T05:00:00Z', 0, 0, 0, 0, 0, [], [])]), [], 'only empty rounds')

  const picked = pickUrlMonths(stats)
  eq([picked.current?.month, picked.previous?.month, picked.first?.month], ['2026-11', '2026-10', '2026-09'], 'current / previous / first')

  const onlyTwo = pickUrlMonths(stats.filter((s) => s.month !== '2026-09'))
  eq([onlyTwo.current?.month, onlyTwo.previous?.month, onlyTwo.first?.month], ['2026-11', '2026-10', '2026-10'], 'first is the earliest even when it is previous')

  const gap = pickUrlMonths(stats.filter((s) => s.month !== '2026-10'))
  eq([gap.current?.month, gap.previous, gap.first?.month], ['2026-11', null, '2026-09'], 'previous only when it is the calendar month right before')

  const single = pickUrlMonths(stats.filter((s) => s.month === '2026-11'))
  eq([single.current?.month, single.previous, single.first], ['2026-11', null, null], 'first is null when it equals current')

  eq(pickUrlMonths([]), { current: null, previous: null, first: null }, 'no stats')

  const st = (month: string): UrlMonthStat => ({ month, scans: 1, asked: 1, cited: 0, citationRate: 0, visibility: 0, brandMentionRate: null, avgPlace: null })
  const jan = pickUrlMonths([st('2027-01'), st('2026-12')])
  eq([jan.current?.month, jan.previous?.month], ['2027-01', '2026-12'], 'January looks back to December of the year before')
  const unsorted = pickUrlMonths([st('2026-11'), st('2026-09'), st('2026-10')])
  eq([unsorted.current?.month, unsorted.previous?.month, unsorted.first?.month], ['2026-11', '2026-10', '2026-09'], 'input order does not matter')
}

console.log(`url-monitor: ${passed} assertions passed`)
