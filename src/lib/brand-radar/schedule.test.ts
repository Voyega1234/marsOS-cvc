// Brand Radar schedule: npx tsx src/lib/brand-radar/schedule.test.ts
import { formatSchedule, normalizeSchedule, parseSchedule } from './types'
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

// ── Every N days / chosen weekdays ───────────────────────────────────────────
// parse
eq(parseSchedule('weekly'), { kind: 'weekly' }, 'preset parses')
eq(parseSchedule('every:3'), { kind: 'interval', days: 3 }, 'every:3')
eq(parseSchedule('every:90'), { kind: 'interval', days: 90 }, 'every:90 = upper limit')
eq(parseSchedule('every:1'), { kind: 'daily' }, 'every 1 day = daily')
eq(parseSchedule('every:0'), null, 'every:0 rejected')
eq(parseSchedule('every:91'), null, 'above the limit rejected')
eq(parseSchedule('every:3.5'), null, 'fraction rejected')
eq(parseSchedule('every:-3'), null, 'negative rejected')
eq(parseSchedule('every:'), null, 'missing number rejected')
eq(parseSchedule('days:1,3'), { kind: 'weekdays', days: [1, 3] }, 'days:1,3')
eq(parseSchedule('days:3,1,3'), { kind: 'weekdays', days: [1, 3] }, 'weekdays sorted, duplicates dropped')
eq(parseSchedule('days:7'), { kind: 'weekdays', days: [7] }, 'Sunday only')
eq(parseSchedule('days:1,2,3,4,5,6,7'), { kind: 'daily' }, 'all 7 weekdays = daily')
eq(parseSchedule('days:'), null, 'no weekday rejected')
eq(parseSchedule('days:0'), null, 'weekday 0 rejected')
eq(parseSchedule('days:8'), null, 'weekday 8 rejected')
eq(parseSchedule('days:1;3'), null, 'wrong separator rejected')
eq(parseSchedule('days:1,2,3,4,5,6,7,1'), null, 'more than 7 items rejected')
eq(parseSchedule('hourly'), null, 'unknown word rejected')
eq(parseSchedule(''), null, 'empty rejected')
eq(parseSchedule(3), null, 'non-string rejected')
eq(parseSchedule(null), null, 'null rejected')
eq(parseSchedule(' every:3 '), { kind: 'interval', days: 3 }, 'surrounding spaces ignored')
// format / normalize: one canonical stored value
eq(formatSchedule({ kind: 'interval', days: 3 }), 'every:3', 'format interval')
eq(formatSchedule({ kind: 'interval', days: 1 }), 'daily', 'format every 1 day = daily')
eq(formatSchedule({ kind: 'weekdays', days: [3, 1] }), 'days:1,3', 'format weekdays ascending')
eq(formatSchedule({ kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] }), 'daily', 'format all weekdays = daily')
eq(formatSchedule({ kind: 'monthly' }), 'monthly', 'format preset')
eq(normalizeSchedule('days:3,1', 'manual'), 'days:1,3', 'normalize sorts')
eq(normalizeSchedule('every:1', 'manual'), 'daily', 'normalize every:1')
eq(normalizeSchedule('garbage', 'manual'), 'manual', 'unreadable value -> fallback')
eq(normalizeSchedule(undefined, 'weekly'), 'weekly', 'missing value -> fallback')

// periodKey: the Bangkok day, same key as daily
eq(periodKey('every:3', NOW), '2026-11-16', 'every:3 period = Bangkok day')
eq(periodKey('days:1,3', NOW), '2026-11-16', 'weekdays period = Bangkok day')
eq(periodKey('days:1,3', new Date('2026-11-16T17:30:00.000Z')), '2026-11-17', 'weekdays period turns at Bangkok midnight')
eq(periodKey('garbage', NOW), null, 'unreadable schedule = no period')

// nextRunAfter: every N days
eq(iso(nextRunAfter('every:3', NOW)), '2026-11-18T17:00:00.000Z', 'every 3 days from Mon 16 -> Thu 19 00:00 Bangkok')
eq(iso(nextRunAfter('every:2', NOW)), '2026-11-17T17:00:00.000Z', 'every 2 days from Mon 16 -> Wed 18')
eq(iso(nextRunAfter('every:3', new Date('2026-11-29T05:00:00.000Z'))), '2026-12-01T17:00:00.000Z', 'every 3 days across a month end: 29 Nov -> 2 Dec')
eq(iso(nextRunAfter('every:7', new Date('2026-12-28T05:00:00.000Z'))), '2027-01-03T17:00:00.000Z', 'every 7 days across a year end: 28 Dec -> 4 Jan')
eq(iso(nextRunAfter('every:3', new Date('2026-11-16T17:30:00.000Z'))), '2026-11-19T17:00:00.000Z', 'counted from the Bangkok day (already Tue 17) -> Fri 20')
eq(iso(nextRunAfter('every:1', NOW)), iso(nextRunAfter('daily', NOW)), 'every:1 behaves as daily')

// nextRunAfter: chosen weekdays (Mon + Wed). NOW is Monday.
eq(iso(nextRunAfter('days:1,3', NOW)), '2026-11-17T17:00:00.000Z', 'Mon -> Wed 18 00:00 Bangkok')
eq(iso(nextRunAfter('days:1,3', new Date('2026-11-17T05:00:00.000Z'))), '2026-11-17T17:00:00.000Z', 'Tue -> Wed 18')
eq(iso(nextRunAfter('days:1,3', new Date('2026-11-18T05:00:00.000Z'))), '2026-11-22T17:00:00.000Z', 'Wed -> next Mon 23')
eq(iso(nextRunAfter('days:1,3', new Date('2026-11-22T05:00:00.000Z'))), '2026-11-22T17:00:00.000Z', 'Sun -> Mon 23')
eq(iso(nextRunAfter('days:1', NOW)), '2026-11-22T17:00:00.000Z', 'only Monday, on a Monday -> the following Monday')
eq(iso(nextRunAfter('days:7', NOW)), '2026-11-21T17:00:00.000Z', 'only Sunday, from Mon -> Sun 22')
eq(iso(nextRunAfter('days:6,7', new Date('2026-11-21T05:00:00.000Z'))), '2026-11-21T17:00:00.000Z', 'Sat -> Sun 22')
eq(iso(nextRunAfter('days:6,7', new Date('2026-11-22T05:00:00.000Z'))), '2026-11-27T17:00:00.000Z', 'Sun -> Sat 28')
eq(iso(nextRunAfter('days:1,3', new Date('2026-11-17T17:30:00.000Z'))), '2026-11-22T17:00:00.000Z', 'Wed 00:30 Bangkok (UTC still Tue) -> next Mon')
eq(iso(nextRunAfter('days:1,2,3,4,5,6,7', NOW)), iso(nextRunAfter('daily', NOW)), 'all weekdays behaves as daily')
eq(nextRunAfter('garbage', NOW), null, 'unreadable schedule = no next run')
// every next run lands on a chosen weekday
{
  let at = NOW
  const seen: number[] = []
  for (let i = 0; i < 6; i++) {
    const next = nextRunAfter('days:2,5', at) as Date
    seen.push(new Date(next.getTime() + 7 * 3600_000).getUTCDay()) // Bangkok day of week, 0 = Sunday
    at = next
  }
  eq(seen, [2, 5, 2, 5, 2, 5], 'Tue/Fri chain alternates Tue, Fri')
}

// isDue
eq(isDue('every:3', null, NOW), true, 'interval with no nextRunAt = due')
eq(isDue('every:3', new Date('2026-11-18T17:00:00.000Z'), NOW), false, 'interval not due before its day')
eq(isDue('days:1,3', new Date('2026-11-15T17:00:00.000Z'), NOW), true, 'weekday due once its midnight has passed')
eq(isDue('garbage', null, NOW), false, 'unreadable schedule is never due')
eq(isDue('every:500', null, NOW), false, 'out-of-range interval is never due')

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
