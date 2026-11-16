// Brand Radar schedule: npx tsx src/lib/brand-radar/schedule.test.ts
import { isDue, lastMonthKeys, monthKey, monthRange, nextRunAfter, parseDayRange, periodKey, previousRange, promptSetHash } from './schedule'

let passed = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`FAIL: ${msg}\n  actual:   ${a}\n  expected: ${e}`)
  passed++
}
const iso = (d: Date | null) => (d ? d.toISOString() : null)

// 2026-11-16 (Monday) 10:00 Bangkok
const NOW = new Date('2026-11-16T03:00:00.000Z')

// periodKey
eq(periodKey('manual', NOW), null, 'manual = null')
eq(periodKey('daily', NOW), '2026-11-16', 'daily')
eq(periodKey('weekly', NOW), '2026-W47', 'weekly')
eq(periodKey('monthly', NOW), '2026-11', 'monthly')

// UTC/Bangkok day boundary: 2026-11-16 17:30 UTC = 2026-11-17 00:30 Bangkok
eq(periodKey('daily', new Date('2026-11-16T17:30:00.000Z')), '2026-11-17', 'after Bangkok midnight = next day')
eq(periodKey('daily', new Date('2026-11-16T16:59:59.999Z')), '2026-11-16', 'just before Bangkok midnight')
// Sunday 2026-11-22 23:30 Bangkok is still W47, Monday 00:30 Bangkok is W48
eq(periodKey('weekly', new Date('2026-11-22T16:30:00.000Z')), '2026-W47', 'Sunday night Bangkok = W47')
eq(periodKey('weekly', new Date('2026-11-22T17:30:00.000Z')), '2026-W48', 'Monday 00:30 Bangkok = W48 even though UTC is still Sunday')
eq(periodKey('monthly', new Date('2026-10-31T17:00:00.000Z')), '2026-11', 'month turns at Bangkok midnight')

// ISO week across the year boundary: 2026-12-31 is Thursday -> 2026-W53, 2027-01-01 Friday -> 2026-W53, 2027-01-04 Monday -> 2027-W01
eq(periodKey('weekly', new Date('2026-12-31T05:00:00.000Z')), '2026-W53', '2026-12-31 = 2026-W53')
eq(periodKey('weekly', new Date('2027-01-01T05:00:00.000Z')), '2026-W53', '2027-01-01 still 2026-W53 (ISO week-year)')
eq(periodKey('weekly', new Date('2027-01-03T05:00:00.000Z')), '2026-W53', '2027-01-03 Sunday still 2026-W53')
eq(periodKey('weekly', new Date('2027-01-04T05:00:00.000Z')), '2027-W01', '2027-01-04 Monday = 2027-W01')
eq(periodKey('weekly', new Date('2026-12-31T17:30:00.000Z')), '2026-W53', '2027-01-01 00:30 Bangkok (UTC still Dec 31) = 2026-W53')
eq(periodKey('daily', new Date('2026-12-31T17:30:00.000Z')), '2027-01-01', 'daily across year boundary Bangkok')
eq(periodKey('weekly', new Date('2024-12-30T05:00:00.000Z')), '2025-W01', '2024-12-30 Monday = 2025-W01')

// nextRunAfter
eq(nextRunAfter('manual', NOW), null, 'manual next = null')
eq(iso(nextRunAfter('daily', NOW)), '2026-11-16T17:00:00.000Z', 'daily next = next Bangkok midnight')
eq(iso(nextRunAfter('weekly', NOW)), '2026-11-22T17:00:00.000Z', 'weekly next = next Monday 00:00 Bangkok')
eq(iso(nextRunAfter('weekly', new Date('2026-11-22T10:00:00.000Z'))), '2026-11-22T17:00:00.000Z', 'Sunday -> next day Monday')
eq(iso(nextRunAfter('weekly', new Date('2026-11-22T17:00:00.000Z'))), '2026-11-29T17:00:00.000Z', 'exactly Monday 00:00 -> following Monday')
eq(iso(nextRunAfter('monthly', NOW)), '2026-11-30T17:00:00.000Z', 'monthly next = 1 Dec 00:00 Bangkok')
eq(iso(nextRunAfter('monthly', new Date('2026-12-15T05:00:00.000Z'))), '2026-12-31T17:00:00.000Z', 'December -> 1 Jan')
eq(iso(nextRunAfter('daily', new Date('2026-12-31T05:00:00.000Z'))), '2026-12-31T17:00:00.000Z', 'daily on 31 Dec')

// isDue
eq(isDue('manual', null, NOW), false, 'manual never due')
eq(isDue('manual', new Date('2020-01-01'), NOW), false, 'manual never due even in the past')
eq(isDue('daily', null, NOW), true, 'null nextRunAt = due')
eq(isDue('daily', new Date('2026-11-16T03:00:00.000Z'), NOW), true, 'equal = due')
eq(isDue('daily', new Date('2026-11-16T03:00:00.001Z'), NOW), false, 'future = not due')
eq(isDue('weekly', new Date('2026-11-10T00:00:00.000Z'), NOW), true, 'past = due')

// promptSetHash
eq(promptSetHash(['b', 'a', 'c']), promptSetHash(['c', 'b', 'a']), 'order independent')
eq(promptSetHash(['a', 'b']) === promptSetHash(['a', 'c']), false, 'different ids differ')
eq(/^[0-9a-f]{16}$/.test(promptSetHash(['a'])), true, '16 hex chars')
eq(promptSetHash([]).length, 16, 'empty set hashes')

// months
eq(monthKey(NOW), '2026-11', 'monthKey')
eq(monthKey(new Date('2026-11-30T17:00:00.000Z')), '2026-12', 'monthKey Bangkok boundary')
const mr = monthRange(NOW)
eq([iso(mr.start), iso(mr.end)], ['2026-10-31T17:00:00.000Z', '2026-11-30T17:00:00.000Z'], 'monthRange Bangkok, end exclusive')
eq(lastMonthKeys(NOW, 3), ['2026-09', '2026-10', '2026-11'], 'lastMonthKeys oldest first')
eq(lastMonthKeys(new Date('2027-02-10T05:00:00.000Z'), 4), ['2026-11', '2026-12', '2027-01', '2027-02'], 'lastMonthKeys across year')
eq(lastMonthKeys(NOW, 0), [], 'zero months')

// parseDayRange
const r = parseDayRange('2026-11-01', '2026-11-30')
eq([iso(r.gte ?? null), iso(r.lte ?? null)], ['2026-10-31T17:00:00.000Z', '2026-11-30T16:59:59.999Z'], 'inclusive Bangkok days')
eq(parseDayRange('2026-11-01'), { gte: new Date('2026-10-31T17:00:00.000Z') }, 'from only')
eq(Object.keys(parseDayRange('', null)), [], 'empty -> omitted')
eq(Object.keys(parseDayRange('nope', '2026-02-31')), [], 'invalid -> omitted')
eq(Object.keys(parseDayRange(undefined, '2026-11-30')), ['lte'], 'to only')

// previousRange
eq(previousRange('2026-11-10', '2026-11-16'), { from: '2026-11-03', to: '2026-11-09' }, '7-day period')
eq(previousRange('2026-11-16', '2026-11-16'), { from: '2026-11-15', to: '2026-11-15' }, 'single day')
eq(previousRange('2026-03-01', '2026-03-31'), { from: '2026-01-29', to: '2026-02-28' }, '31-day period across Feb')
eq(previousRange('2027-01-01', '2027-01-07'), { from: '2026-12-25', to: '2026-12-31' }, 'across year')
eq(previousRange('bad', '2026-11-16'), null, 'invalid from')
eq(previousRange('2026-11-16', '2026-13-01'), null, 'invalid to')
eq(previousRange('2026-11-16', '2026-11-10'), null, 'reversed')

console.log(`schedule.test.ts: ${passed} assertions passed`)
