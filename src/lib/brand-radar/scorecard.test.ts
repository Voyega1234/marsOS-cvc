// Brand Radar scorecard: npx tsx src/lib/brand-radar/scorecard.test.ts
import { buildMonthStats, gradeScores, monthKey, pickMonths, type MonthRow } from './scorecard'
import type { EntityShare } from './types'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}

function ent(type: 'brand' | 'competitor', name: string, o: Partial<EntityShare> = {}): EntityShare {
  return {
    entityType: type, key: type === 'brand' ? 'brand' : name, name, mentions: 0, mentionRate: 0, recommended: 0, cited: 0,
    occurrences: 0, avgPosition: null, avgPositionPct: null, zones: { early: 0, middle: 0, late: 0 }, ...o,
  }
}
const mention = (ours: number | null, comp: number[]) =>
  gradeScores([ent('brand', 'B', { mentionRate: ours }), ...comp.map((v, i) => ent('competitor', `C${i}`, { mentionRate: v }))], 10)[0]

// rate boundaries (ratio against the best competitor)
eq(mention(0.8, [1]).grade, 'good', 'ratio 0.8 is good')
eq(mention(0.79, [1]).grade, 'fair', 'ratio just under 0.8 is fair')
eq(mention(0.4, [1]).grade, 'fair', 'ratio 0.4 is fair')
eq(mention(0.39, [1]).grade, 'poor', 'ratio just under 0.4 is poor')
eq(mention(0, [0.5]).grade, 'poor', 'our value 0 is poor')
eq(mention(0, [0]).grade, 'poor', 'both 0 is poor')
eq(mention(0.1, [0, 0]).grade, 'good', 'best competitor 0 and ours > 0 is good')
eq(mention(0.5, []).grade, null, 'no competitor: not graded')
eq(mention(0.5, []).bestCompetitor, null, 'no competitor: no best')
eq(mention(0.5, []).rank, null, 'no competitor: no rank')
eq(mention(null, [0.5]).grade, null, 'our value null: not graded')
eq(mention(null, [0.5]).bestCompetitor, { name: 'C0', value: 0.5 }, 'best competitor still shown')
eq(mention(0.5, [0.9, 0.2]).bestCompetitor, { name: 'C0', value: 0.9 }, 'best competitor is the highest')

// rank
eq([mention(0.5, [0.9, 0.2]).rank, mention(0.5, [0.9, 0.2]).outOf], [2, 3], 'rank 2 of 3')
eq(mention(0.5, [0.5, 0.2]).rank, 1, 'tie shares the better rank')
eq(mention(0.2, [0.5, 0.5, 0.2]).rank, 3, 'two ahead, a tie behind')

// citation uses cited / responses
const cit = gradeScores([ent('brand', 'B', { cited: 4 }), ent('competitor', 'C', { cited: 5 })], 10)[1]
eq([cit.value, cit.grade, cit.bestCompetitor], [0.4, 'good', { name: 'C', value: 0.5 }], 'citation 4/10 vs 5/10')
const none = gradeScores([ent('brand', 'B', { mentionRate: null }), ent('competitor', 'C', { mentionRate: null })], 0)
eq([none[0].grade, none[1].value, none[1].grade, none[1].bestCompetitor], [null, null, null, null], 'zero responses: nothing computable')

// position (lower is better)
const pos = (ours: number | null, comp: Array<number | null>) =>
  gradeScores([ent('brand', 'B', { avgPosition: ours }), ...comp.map((v, i) => ent('competitor', `C${i}`, { avgPosition: v }))], 10)[2]
eq(pos(2.5, [2]).grade, 'good', 'gap 0.5 is good')
eq(pos(2.6, [2]).grade, 'fair', 'gap just over 0.5 is fair')
eq(pos(3.5, [2]).grade, 'fair', 'gap 1.5 is fair')
eq(pos(3.6, [2]).grade, 'poor', 'gap just over 1.5 is poor')
eq(pos(1, [2]).grade, 'good', 'ahead of the best is good')
eq(pos(null, [2]).grade, null, 'our position null')
eq(pos(2, [null]).grade, null, 'competitor position null')
eq(pos(2, [null]).bestCompetitor, null, 'no competitor with position')
eq(pos(2, []).grade, null, 'no competitor')
eq(pos(2, [1.5, null, 3]).bestCompetitor, { name: 'C0', value: 1.5 }, 'best is lowest')
eq([pos(2, [1.5, null, 3]).rank, pos(2, [1.5, null, 3]).outOf], [2, 3], 'competitors without data are not ranked')
eq(pos(2, [2, 2]).rank, 1, 'position tie shares rank')
eq(gradeScores([ent('brand', 'B')], 5).map((g) => g.metric), ['mention', 'citation', 'position'], 'order')

// months
eq(monthKey(new Date('2026-12-31T17:30:00Z')), '2027-01', 'Bangkok midnight crosses the year')
eq(monthKey(new Date('2026-12-31T16:59:00Z')), '2026-12', 'just before Bangkok midnight')
const row = (iso: string, o: Partial<MonthRow> = {}): MonthRow => ({
  startedAt: new Date(iso), asked: 10, mentioned: 5, ownedCited: 2, appeared: 6, positionSum: 10, positionCount: 5, ...o,
})
const stats = buildMonthStats([
  row('2027-01-05T00:00:00Z'), row('2026-12-31T17:30:00Z', { asked: 10 }), row('2026-12-31T16:00:00Z'), row('2026-11-01T00:00:00Z', { asked: 0 }),
])
eq(stats.map((s) => [s.month, s.scans, s.asked]), [['2026-12', 1, 10], ['2027-01', 2, 20]], 'grouping, asc, empty round dropped')
eq([stats[1].mentionRate, stats[1].citationRate, stats[1].appearRate, stats[1].avgPosition], [0.5, 0.2, 0.6, 2], 'rates')
eq(buildMonthStats([row('2026-11-05T00:00:00Z', { positionCount: 0, positionSum: 0 })])[0].avgPosition, null, 'no position is null')
eq(buildMonthStats([row('2026-11-05T00:00:00Z', { asked: 0 })]), [], 'only empty rounds')

const m = (month: string) => buildMonthStats([row(`${month}-10T00:00:00Z`)])[0]
const all = (...ms: string[]) => buildMonthStats(ms.map((x) => row(`${x}-10T00:00:00Z`)))
eq(pickMonths([]), { current: null, previous: null, first: null }, 'no months')
eq(pickMonths(all('2026-11')), { current: m('2026-11'), previous: null, first: null }, 'single month')
eq(pickMonths(all('2026-09', '2026-11')).previous, null, 'gap: previous month missing')
eq(pickMonths(all('2026-09', '2026-11')).first?.month, '2026-09', 'first with gap')
eq(pickMonths(all('2026-10', '2026-11')).first?.month, '2026-10', 'first equals previous')
eq(pickMonths(all('2026-10', '2026-11')).previous?.month, '2026-10', 'previous found')
eq(pickMonths(all('2026-12', '2027-01')).previous?.month, '2026-12', 'previous across year boundary')
eq(pickMonths(all('2027-01', '2026-12', '2026-10')).current?.month, '2027-01', 'unsorted input')

console.log(`scorecard: ${passed} checks passed`)
