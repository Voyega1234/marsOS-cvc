/**
 * Shared date-range vocabulary for the LINE Tracking pages.
 *
 * The Marketing Funnel page defined these chips first; Overview and Leads CRM now
 * read from the same list so the three pages always offer the identical choices.
 *
 * Every boundary is computed in Asia/Bangkok, never in the server's own timezone —
 * Vercel runs the lambdas in UTC, so a naive `new Date(y, m, d)` made "วันนี้" start
 * at 07:00 น. Thai time and dropped the first seven hours of every day the team
 * looked at. The offset is applied by hand instead of relying on `TZ`, so the numbers
 * stay the same whether the code runs on Vercel, on a laptop, or in a test.
 */

export type RangeQuery = { range?: string; from?: string; to?: string };

/** `undefined` = no date filter at all (ทั้งหมด). */
export type ResolvedRange = { from?: Date; to?: Date } | undefined;

export const DATE_RANGES = [
  { key: "today", label: "วันนี้" },
  { key: "1d", label: "เมื่อวาน" },
  { key: "7d", label: "7 วัน" },
  { key: "14d", label: "14 วัน" },
  { key: "30d", label: "30 วัน" },
  { key: "all", label: "ทั้งหมด" },
] as const;

/** Thailand has no DST, so a fixed offset is exact — not an approximation. */
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The instant 00:00:00.000 Bangkok time on the day that contains `d`. */
function bangkokStartOfDay(d: Date): Date {
  const shifted = new Date(d.getTime() + BKK_OFFSET_MS); // Bangkok wall clock, read as UTC
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnight - BKK_OFFSET_MS);
}

export function resolveRange(sp: RangeQuery): ResolvedRange {
  const now = new Date();
  const days = (n: number) => new Date(now.getTime() - n * 86400000);
  switch (sp.range) {
    case "today":
      return { from: bangkokStartOfDay(now) };
    case "1d": {
      const from = new Date(bangkokStartOfDay(now).getTime() - 86400000);
      const to = new Date(from.getTime() + 86400000 - 1);
      return { from, to };
    }
    case "7d":
      return { from: days(7) };
    case "14d":
      return { from: days(14) };
    case "30d":
      return { from: days(30) };
    case "custom":
      // Both ends carry the +07:00 offset. They used to disagree — `from` was parsed as
      // UTC and `to` as server-local — so a custom window silently lost the first hours
      // of its first day.
      return {
        from: sp.from ? new Date(`${sp.from}T00:00:00.000+07:00`) : undefined,
        to: sp.to ? new Date(`${sp.to}T23:59:59.999+07:00`) : undefined,
      };
    default:
      return undefined;
  }
}

/** Which chip should look active. Falls back to ทั้งหมด like the funnel page does. */
export function activeRangeKey(sp: RangeQuery): string {
  return sp.range ?? "all";
}

/** Human label for the chosen window — used in card captions. */
export function rangeLabel(sp: RangeQuery): string {
  const hit = DATE_RANGES.find((r) => r.key === sp.range);
  if (hit) return hit.label;
  if (sp.range === "custom") {
    if (sp.from && sp.to) return `${sp.from} – ${sp.to}`;
    if (sp.from) return `ตั้งแต่ ${sp.from}`;
    if (sp.to) return `ถึง ${sp.to}`;
    return "ช่วงที่เลือก";
  }
  return "ทั้งหมด";
}

/** Prisma `createdAt` filter for a resolved range, or `undefined` when unfiltered. */
export function createdAtFilter(range: ResolvedRange) {
  if (!range || (!range.from && !range.to)) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

/** `where` fragment for a resolved range — `{}` when the window is "ทั้งหมด". */
export function createdAtWhere(range: ResolvedRange) {
  const createdAt = createdAtFilter(range);
  return createdAt ? { createdAt } : {};
}
