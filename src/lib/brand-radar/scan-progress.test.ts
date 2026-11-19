// Brand Radar scan progress: npx tsx src/lib/brand-radar/scan-progress.test.ts
import { scanProgress, type Dataset, type MentionRow, type RespRow, type RunLite } from './metrics'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

const T = (d: string) => new Date(`2026-11-${d}T03:00:00.000Z`)

function resp(id: string, runId: string, o: Partial<RespRow> = {}): RespRow {
  return {
    id, runId, promptId: 'p1', provider: 'openai', collectedAt: T('10'),
    brandMentioned: false, brandOccurrences: 0, brandRecommended: false, ownedCited: false, citationCount: 0, ...o,
  }
}
function men(responseId: string, runId: string, entityType: 'brand' | 'competitor', position: number | null): MentionRow {
  return {
    responseId, runId, promptId: 'p1', provider: 'openai', entityType, entityKey: entityType === 'brand' ? 'brand' : 'c1',
    competitorId: entityType === 'competitor' ? 'c1' : null, entityName: entityType, occurrences: 1, recommended: false, compared: false, position,
  }
}
function run(id: string, day: string, hash = 'h1', providers = 'openai'): RunLite {
  return { id, startedAt: T(day), promptSetHash: hash, providers }
}
function ds(responses: RespRow[], mentions: MentionRow[] = []): Dataset {
  return { brandName: 'Brand', responses, mentions, citations: [], prompts: [], competitors: [] }
}

// Two rounds passed newest first: counts and rates
{
  const responses = [
    resp('a1', 'r1', { brandMentioned: true }),
    resp('a2', 'r1', { ownedCited: true }),
    resp('a3', 'r1', { brandMentioned: true, ownedCited: true }),
    resp('a4', 'r1'),
    resp('b1', 'r2', { brandMentioned: true }),
    resp('b2', 'r2'),
  ]
  const out = scanProgress(ds(responses), [run('r2', '12'), run('r1', '10')])
  eq(out.map((p) => p.runId), ['r1', 'r2'], 'oldest first')
  const p = out[0]
  eq([p.asked, p.mentioned, p.ownedCited, p.appeared], [4, 2, 2, 3], 'round 1 counts (named OR linked once)')
  eq([p.mentionRate, p.citationRate, p.appearRate], [0.5, 0.5, 0.75], 'round 1 rates')
  eq([out[1].asked, out[1].mentioned, out[1].ownedCited, out[1].appeared], [2, 1, 0, 1], 'round 2 counts')
  eq(out[1].mentionRate, 0.5, 'round 2 rate')
}

// Average position: brand rows only, nulls ignored; null when never named
{
  const responses = [resp('a1', 'r1'), resp('a2', 'r1'), resp('a3', 'r1'), resp('b1', 'r2')]
  const mentions = [
    men('a1', 'r1', 'brand', 1), men('a2', 'r1', 'brand', 3), men('a3', 'r1', 'brand', null),
    men('a1', 'r1', 'competitor', 5),
    men('b1', 'r2', 'competitor', 2),
  ]
  const out = scanProgress(ds(responses, mentions), [run('r1', '10'), run('r2', '11')])
  eq(out[0].avgPosition, 2, 'mean of 1 and 3, null and competitor ignored')
  eq(out[1].avgPosition, null, 'brand never named -> null')
}

// A run with no responses is left out
{
  const out = scanProgress(ds([resp('a1', 'r1')]), [run('r1', '10'), run('r2', '11')])
  eq(out.map((p) => p.runId), ['r1'], 'run without responses left out')
}

// sameSetAsPrevious
{
  const responses = ['r1', 'r2', 'r3', 'r4'].map((r) => resp(`x-${r}`, r))
  const runs = [run('r1', '10'), run('r2', '11'), run('r3', '12', 'h2'), run('r4', '13', 'h2', 'openai,gemini')]
  const out = scanProgress(ds(responses), runs)
  eq(out.map((p) => p.sameSetAsPrevious), [null, true, false, false], 'sameSetAsPrevious')
}

// Cap keeps the latest N rounds
{
  const runs = ['10', '11', '12', '13'].map((d) => run(`r${d}`, d))
  const responses = runs.map((r) => resp(`x-${r.id}`, r.id))
  const out = scanProgress(ds(responses), runs, 2)
  eq(out.map((p) => p.runId), ['r12', 'r13'], 'cap keeps latest rounds')
  eq(out[0].sameSetAsPrevious, true, 'flag still computed against the dropped round')
}

console.log(`scan-progress.test.ts: ${passed} assertions passed`)
