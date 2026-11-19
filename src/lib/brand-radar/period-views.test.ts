// Brand Radar cited pages / period diff / mention split / prompt run change: npx tsx src/lib/brand-radar/period-views.test.ts
import { citedPages, diffPeriods, mentionSplit, promptRunChanges, promptRunChangeDetails, type CitationRow, type Dataset, type MentionRow, type RespRow, type RunLite } from './metrics'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

const resp = (id: string, promptId: string, runId: string, brand: boolean | null, o: Partial<RespRow> = {}): RespRow => ({
  id, runId, promptId, provider: 'openai', collectedAt: new Date('2026-11-10T03:00:00Z'),
  brandMentioned: brand, brandOccurrences: 0, brandRecommended: false, ownedCited: false, citationCount: 0, ...o,
})
const cite = (responseId: string, url: string, domain: string, o: Partial<CitationRow> = {}): CitationRow => ({
  responseId, runId: 'r1', promptId: 'p1', provider: 'openai', url, normalizedUrl: url.toLowerCase(), domain, title: '', ownerType: 'external', competitorId: null, createdAt: null, ...o,
})
const ds = (o: Partial<Dataset>): Dataset => ({ brandName: 'B', responses: [], mentions: [], citations: [], prompts: [], competitors: [], ...o })

// citedPages: ranked by distinct answers, then citations; owner own > competitor > external
const pagesDs = ds({
  competitors: [{ id: 'c1', name: 'Rival' }],
  citations: [
    cite('a', 'https://x.com/1', 'x.com'), cite('b', 'https://x.com/1', 'x.com', { provider: 'gemini' }),
    cite('a', 'https://y.com/2', 'y.com', { ownerType: 'competitor', competitorId: 'c1' }),
    cite('a', 'https://y.com/2', 'y.com', { ownerType: 'competitor', competitorId: 'c1' }),
    cite('c', 'https://z.com/3', 'z.com', { ownerType: 'own' }),
  ],
})
const pages = citedPages(pagesDs, 50)
eq(pages.map((p) => p.url), ['https://x.com/1', 'https://y.com/2', 'https://z.com/3'], 'pages ranked by distinct answers then citations')
eq(pages[0].answers, 2, 'answers count')
eq(pages[0].platforms, 2, 'platforms count')
eq(pages[1].competitorName, 'Rival', 'competitor name')
eq(pages[2].ownerType, 'own', 'owner type')
eq(citedPages(pagesDs, 1).length, 1, 'limit')
eq(citedPages(pagesDs, 50, new Set(['z.com'])).map((p) => p.domain), ['z.com'], 'domain restriction')

// diffPeriods
const d1 = diffPeriods(['a', 'b'], ['b', 'c'])
eq([d1.available, Array.from(d1.added), d1.lost], [true, ['a'], ['c']], 'diff added/lost')
eq(diffPeriods(['a'], null).available, false, 'no range -> unavailable')
eq(diffPeriods(['a'], []).available, false, 'empty previous -> unavailable')
eq(Array.from(diffPeriods(['a'], []).added), [], 'never claims new without previous')
eq(diffPeriods(['a'], []).lost, [], 'never claims lost without previous')

// mentionSplit
const cm = (responseId: string, key: string): MentionRow => ({
  responseId, runId: 'r1', promptId: 'p1', provider: 'openai', entityType: 'competitor', entityKey: key, competitorId: key,
  entityName: key, occurrences: 1, recommended: false, compared: false, position: null,
})
const split = mentionSplit(ds({
  competitors: [{ id: 'c1', name: 'R' }],
  responses: [resp('1', 'p1', 'r1', true), resp('2', 'p1', 'r1', true), resp('3', 'p1', 'r1', false), resp('4', 'p1', 'r1', null), resp('5', 'p1', 'r1', false)],
  mentions: [cm('2', 'c1'), cm('3', 'c1'), cm('4', 'c1'), cm('5', 'untracked')],
}))
eq(split, { total: 5, onlyBrand: 1, brandAndCompetitor: 1, onlyCompetitor: 2, nobody: 1 }, 'mention split')
eq(split.onlyBrand + split.brandAndCompetitor + split.onlyCompetitor + split.nobody, split.total, 'split sums to total')

// promptRunChanges
const run = (id: string, day: string): RunLite => ({ id, startedAt: new Date(`2026-11-${day}T00:00:00Z`), promptSetHash: '', providers: '' })
const runs = [run('r1', '01'), run('r2', '05'), run('r3', '09')]
const ch = promptRunChanges(ds({
  responses: [
    resp('a1', 'gain', 'r2', false), resp('a2', 'gain', 'r3', true),
    resp('b1', 'lose', 'r2', true), resp('b2', 'lose', 'r3', false),
    resp('c1', 'same', 'r2', true), resp('c2', 'same', 'r3', true),
    resp('d1', 'single', 'r3', true),
    resp('e1', 'unknown', 'r2', null), resp('e2', 'unknown', 'r3', true),
    resp('f1', 'old', 'r1', false), resp('f2', 'old', 'r2', false), resp('f3', 'old', 'r3', true),
  ],
}), runs)
eq(ch.get('gain'), 'gained', 'gained')
eq(ch.get('lose'), 'lost', 'lost')
eq(ch.has('same'), false, 'unchanged')
eq(ch.has('single'), false, 'one run only')
eq(ch.has('unknown'), false, 'undecided earlier run')
eq(ch.get('old'), 'gained', 'uses two most recent runs only')

// per provider, repeat asks, disagreement
const mk = (id: string, p: string, runId: string, provider: RespRow['provider'], b: boolean) => resp(id, p, runId, b, { provider })
const ch2 = promptRunChanges(ds({
  responses: [
    // provider mix change only: openai mentioned in both runs, gemini only ran in the latest (not mentioned)
    mk('m1', 'mix', 'r2', 'openai', true), mk('m2', 'mix', 'r3', 'openai', true), mk('m3', 'mix', 'r3', 'gemini', false),
    // 1 of 4 asks mentioned is not "mentioned": earlier 1/4, latest 1/4 -> no change; earlier 0/4 -> 1/4 -> no change
    mk('n1', 'noisy', 'r2', 'openai', false), mk('n2', 'noisy', 'r2', 'openai', false), mk('n3', 'noisy', 'r2', 'openai', false), mk('n4', 'noisy', 'r2', 'openai', false),
    mk('n5', 'noisy', 'r3', 'openai', true), mk('n6', 'noisy', 'r3', 'openai', false), mk('n7', 'noisy', 'r3', 'openai', false), mk('n8', 'noisy', 'r3', 'openai', false),
    // 2 of 4 counts as mentioned -> gained
    mk('q1', 'half', 'r2', 'openai', false), mk('q2', 'half', 'r3', 'openai', true), mk('q3', 'half', 'r3', 'openai', true), mk('q4', 'half', 'r3', 'openai', false), mk('q5', 'half', 'r3', 'openai', false),
    // real gained / lost per provider
    mk('g1', 'pg', 'r2', 'gemini', false), mk('g2', 'pg', 'r3', 'gemini', true), mk('g3', 'pg', 'r2', 'openai', true), mk('g4', 'pg', 'r3', 'openai', true),
    mk('l1', 'pl', 'r2', 'gemini', true), mk('l2', 'pl', 'r3', 'gemini', false),
    // disagreement
    mk('d1', 'dis', 'r2', 'gemini', false), mk('d2', 'dis', 'r3', 'gemini', true), mk('d3', 'dis', 'r2', 'openai', true), mk('d4', 'dis', 'r3', 'openai', false),
  ],
}), runs)
eq(ch2.has('mix'), false, 'provider mix change alone gives no chip')
eq(ch2.has('noisy'), false, '1 of 4 asks is not mentioned')
eq(ch2.get('half'), 'gained', '2 of 4 asks counts as mentioned')
eq(ch2.get('pg'), 'gained', 'gained for one provider')
eq(ch2.get('pl'), 'lost', 'lost for one provider')
eq(ch2.has('dis'), false, 'disagreement gives no chip')
const det = promptRunChangeDetails(ds({ responses: [mk('g1', 'pg', 'r2', 'gemini', false), mk('g2', 'pg', 'r3', 'gemini', true)] }), runs)
eq(det.get('pg'), { change: 'gained', gained: ['gemini'], lost: [] }, 'detail lists providers')

console.log(`period-views tests passed: ${passed}`)
