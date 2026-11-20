/**
 * Helpers for the LINE Tracking project Overview page: its default date window, the daily
 * series behind the "Leads รายวัน" chart and the tile sparklines, and the scale of the
 * close-rate dial.
 *
 * Pure: no database and no request, and "now" can be passed in, so it is unit-tested directly.
 * Days are Asia/Bangkok calendar days, with the same fixed +07:00 offset date-range.ts uses.
 */
import type { RangeQuery, ResolvedRange } from "./date-range";

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** The daily series never covers more days than this; a longer window shows its last days. */
export const DAILY_MAX_DAYS = 90;

const valid = (d: Date | undefined | null): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/** Bangkok calendar day of an instant, as whole days since 1970-01-01. */
const dayIndex = (d: Date) => Math.floor((d.getTime() + BKK_OFFSET_MS) / DAY_MS);
const dayKey = (index: number) => new Date(index * DAY_MS).toISOString().slice(0, 10);
/** The instant 00:00 Bangkok time of a day index. */
const dayStart = (index: number) => new Date(index * DAY_MS - BKK_OFFSET_MS);

/**
 * The Overview's query with its default window filled in.
 *
 * With no `range` in the URL the page used to show all-time numbers in every panel except the
 * comparison card, which looked at the last 7 days. Now the whole page opens on the last 7 days,
 * exactly as if the "7 วัน" chip had been clicked. `days=30` / `days=90` from old bookmarks keep
 * their meaning; an explicit `range` (including `all`) is never touched.
 */
export function overviewQuery<T extends RangeQuery & { days?: string }>(sp: T, now: Date = new Date()): T {
  if (typeof sp.range === "string") return sp;
  const days = Number(sp.days);
  if (days === 30) return { ...sp, range: "30d" };
  // No 90-day chip exists: the same window as a custom range that starts 90 days back.
  if (days === 90) return { ...sp, range: "custom", from: dayKey(dayIndex(now) - 90), to: undefined };
  return { ...sp, range: "7d" };
}

export type DailyWindow = {
  from: Date;
  to: Date;
  /** The page's window is longer than DAILY_MAX_DAYS, or has no start: only its last days are shown. */
  capped: boolean;
  /** The first day is not a whole day (a rolling window such as "7 วัน" starts at the current time of day). */
  partialStart: boolean;
  /** The last day is not a whole day (it is still today). */
  partialEnd: boolean;
};

/** The part of the page's window the daily series reads. Null: the window is empty. */
export function dailyWindow(range: ResolvedRange, now: Date = new Date()): DailyWindow | null {
  const end = valid(range?.to) && range.to.getTime() < now.getTime() ? range.to : now;
  const earliest = dayStart(dayIndex(end) - (DAILY_MAX_DAYS - 1));
  const start = valid(range?.from) ? range.from : null;
  if (start && start.getTime() > end.getTime()) return null;
  const capped = !start || start.getTime() < earliest.getTime();
  const from = capped ? earliest : start;
  return {
    from,
    to: end,
    capped,
    partialStart: from.getTime() !== dayStart(dayIndex(from)).getTime(),
    partialEnd: end.getTime() !== dayStart(dayIndex(end) + 1).getTime() - 1,
  };
}

export type DailyPoint = {
  /** Bangkok calendar day, YYYY-MM-DD. */
  day: string;
  /** Leads created on that day. */
  leads: number;
  /** Of those leads, how many are closed now. */
  purchases: number;
  /** Value of those closed leads. */
  revenue: number;
};

export type DailySeries = Pick<DailyWindow, "capped" | "partialStart" | "partialEnd"> & {
  points: DailyPoint[];
  /**
   * Length of the time the points cover, in days. A rolling "7 วัน" window is 7.0 days spread
   * over 8 calendar days, so an average per day divides by this, not by the number of points.
   */
  spanDays: number;
};

export const EMPTY_DAILY: DailySeries = { points: [], spanDays: 0, capped: false, partialStart: false, partialEnd: false };

/**
 * Folds lead rows into one point per Bangkok day, oldest first, with empty days kept as zeros.
 * A capped window starts at the first day that has a lead, so a young project does not get a
 * long run of empty days in front of its data.
 */
export function bucketDailyLeads(
  rows: { createdAt: Date; status: string; value: number | null }[],
  window: DailyWindow,
  purchasedStatuses: readonly string[],
): DailySeries {
  const first = dayIndex(window.from);
  const last = dayIndex(window.to);
  const byDay = new Map<number, DailyPoint>();
  let earliest = Infinity;
  for (const r of rows) {
    const i = dayIndex(r.createdAt);
    if (i < first || i > last) continue;
    earliest = Math.min(earliest, i);
    const p = byDay.get(i) ?? { day: dayKey(i), leads: 0, purchases: 0, revenue: 0 };
    p.leads += 1;
    if (purchasedStatuses.includes(r.status)) {
      p.purchases += 1;
      p.revenue += r.value ?? 0;
    }
    byDay.set(i, p);
  }
  const { capped } = window;
  if (capped && earliest === Infinity) return { ...EMPTY_DAILY, capped };
  const start = capped ? earliest : first;
  const points: DailyPoint[] = [];
  for (let i = start; i <= last; i++) {
    points.push(byDay.get(i) ?? { day: dayKey(i), leads: 0, purchases: 0, revenue: 0 });
  }
  const coveredFrom = start === first ? window.from : dayStart(start);
  return {
    points,
    spanDays: (window.to.getTime() - coveredFrom.getTime()) / DAY_MS,
    capped,
    // The first shown day is whole once the series starts later than the window does.
    partialStart: window.partialStart && start === first,
    partialEnd: window.partialEnd,
  };
}

/** "12 พ.ย." for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1] ?? ""}`.trim();
}

/**
 * Top of a rate dial, in percent: the first round step with headroom above the largest rate.
 * A close rate is often a few percent, and a 0–100 dial would leave the needle flat on the left.
 */
export function rateDialMax(...rates: number[]): number {
  const top = Math.max(0, ...rates.filter((r) => Number.isFinite(r))) * 1.25;
  return [1, 2, 5, 10, 20, 30, 50, 100].find((step) => step >= top) ?? 100;
}
