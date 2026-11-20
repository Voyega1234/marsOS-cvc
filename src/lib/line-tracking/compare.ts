/**
 * Period comparison for the LINE Tracking pages (Overview, Leads CRM, Marketing Funnel).
 *
 * The page's own date range (see date-range.ts) is the "current" window. This file works out
 * the window it is compared with, from three more query parameters:
 *
 *   cmp=off | prev | month | custom     which comparison
 *   cfrom=YYYY-MM-DD, cto=YYYY-MM-DD    the comparison window, for cmp=custom
 *
 * Pure: no database, no request, and "now" can be passed in, so it is unit-tested directly.
 * Every boundary is Asia/Bangkok, with the same fixed +07:00 offset date-range.ts uses.
 */
import type { RangeQuery, ResolvedRange } from "./date-range";

export type CompareQuery = RangeQuery & { cmp?: string; cfrom?: string; cto?: string };

export type CompareMode = "off" | "prev" | "month" | "custom";

/** A window with both ends fixed. Both ends are inclusive. */
export type DateWindow = { from: Date; to: Date };

/** The quick choices; "custom" is the pair of date inputs next to them. */
export const COMPARE_MODES = [
  { key: "off", label: "ไม่เทียบ" },
  { key: "prev", label: "ช่วงก่อนหน้า" },
  { key: "month", label: "เดือนก่อน (วันเดียวกัน)" },
] as const;

export type CompareInfo = {
  mode: CompareMode;
  /** The page's own window. Null when it has no start (ทั้งหมด). */
  current: DateWindow | null;
  /** The window to compare with. Null: nothing to compare (see `hint`). */
  window: DateWindow | null;
  /** Why there is no comparison window, in Thai. Null when there is one, or when the mode is off. */
  hint: string | null;
};

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

type BkkParts = { y: number; m: number; d: number; ms: number };

/** Bangkok wall-clock parts of an instant. `ms` is the time of day. */
function bkkParts(date: Date): BkkParts {
  const s = new Date(date.getTime() + BKK_OFFSET_MS);
  const midnight = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), ms: s.getTime() - midnight };
}

function fromBkk(y: number, m: number, d: number, ms: number): Date {
  return new Date(Date.UTC(y, m, d) + ms - BKK_OFFSET_MS);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

const valid = (d: Date | undefined | null): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

function parseDay(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value || !ISO_DAY.test(value)) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  if (!valid(d)) return null;
  // Some engines roll 31 Feb over into March. A day that does not exist is not a day.
  const p = bkkParts(d);
  const iso = `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return iso === value ? d : null;
}

/** Which comparison the URL asks for. `fallback` is the page's default when `cmp` is absent or unknown. */
export function compareMode(sp: CompareQuery, fallback: "off" | "prev"): CompareMode {
  return sp.cmp === "off" || sp.cmp === "prev" || sp.cmp === "month" || sp.cmp === "custom" ? sp.cmp : fallback;
}

/** The page's own window with both ends fixed: an open end is "now". Null when it has no start. */
export function currentWindow(range: ResolvedRange, now: Date = new Date()): DateWindow | null {
  if (!range || !valid(range.from)) return null;
  const to = valid(range.to) ? range.to : now;
  return to.getTime() < range.from.getTime() ? null : { from: range.from, to };
}

/** The window of the same length that ends right before `w` starts. */
export function previousWindow(w: DateWindow): DateWindow {
  const span = w.to.getTime() - w.from.getTime();
  const to = new Date(w.from.getTime() - 1);
  return { from: new Date(to.getTime() - span), to };
}

/**
 * Moves an instant by whole calendar months, keeping the Bangkok day and time of day.
 * A day the target month does not have becomes its last day (31 Mar -> 28/29 Feb).
 */
export function shiftMonths(date: Date, months: number, toMonthEnd = false): Date {
  const p = bkkParts(date);
  const first = new Date(Date.UTC(p.y, p.m + months, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const last = daysInMonth(y, m);
  return fromBkk(y, m, toMonthEnd ? last : Math.min(p.d, last), p.ms);
}

/** True when the window is whole calendar months: the 1st at 00:00 to a month's last day at 23:59:59.999. */
function isWholeMonths(w: DateWindow): boolean {
  const a = bkkParts(w.from);
  const b = bkkParts(w.to);
  return a.d === 1 && a.ms === 0 && b.d === daysInMonth(b.y, b.m) && b.ms === DAY_MS - 1;
}

/**
 * The same days one month earlier: 1-11 Nov -> 1-11 Oct.
 * Whole months stay whole: 1-30 Nov -> 1-31 Oct.
 */
export function monthBeforeWindow(w: DateWindow): DateWindow {
  return { from: shiftMonths(w.from, -1), to: shiftMonths(w.to, -1, isWholeMonths(w)) };
}

export function resolveCompare(
  sp: CompareQuery,
  range: ResolvedRange,
  opts: { fallback: "off" | "prev"; now?: Date },
): CompareInfo {
  const mode = compareMode(sp, opts.fallback);
  const current = currentWindow(range, opts.now ?? new Date());
  if (mode === "off") return { mode, current, window: null, hint: null };

  if (mode === "custom") {
    let from = parseDay(sp.cfrom, false);
    let to = parseDay(sp.cto, true);
    // One date only: the comparison window gets the same length as the page's own window.
    const span = current ? current.to.getTime() - current.from.getTime() : null;
    if (from && !to && span !== null) to = new Date(from.getTime() + span);
    else if (!from && to && span !== null) from = new Date(to.getTime() - span);
    if (!from || !to) {
      return { mode, current, window: null, hint: "เลือกวันเริ่มและวันสิ้นสุดของช่วงที่จะเทียบ" };
    }
    // Dates typed the wrong way round still describe one window.
    if (from.getTime() > to.getTime()) {
      const first = parseDay(sp.cto, false);
      const last = parseDay(sp.cfrom, true);
      if (first && last) return { mode, current, window: { from: first, to: last }, hint: null };
    }
    return { mode, current, window: { from, to }, hint: null };
  }

  if (!current) {
    return {
      mode,
      current,
      window: null,
      hint: "ช่วงนี้ไม่มีวันเริ่ม จึงไม่มีช่วงก่อนหน้าให้เทียบ เลือกช่วงวันที่ก่อน หรือกำหนดช่วงเทียบเอง",
    };
  }
  return { mode, current, window: mode === "month" ? monthBeforeWindow(current) : previousWindow(current), hint: null };
}

/**
 * "1–11 ต.ค. 2026", "28 ต.ค. – 3 พ.ย. 2026": the Bangkok days a window covers.
 * A window that is not whole days says so with its times ("11 พ.ย. 2026 14:00–23:59"): "วันนี้" at
 * 10:00 is compared with ten hours, and a bare date would read as the whole day.
 */
export function windowLabel(w: DateWindow): string {
  const a = bkkParts(w.from);
  const b = bkkParts(w.to);
  const day = (p: BkkParts) => `${p.d} ${TH_MONTHS[p.m]}`;
  if (a.ms !== 0 || b.ms !== DAY_MS - 1) {
    // To the minute. The start rounds up: the period before a window starts 1 ms short of the minute.
    const s = bkkParts(new Date(Math.ceil(w.from.getTime() / 60000) * 60000));
    const two = (n: number) => String(n).padStart(2, "0");
    const time = (p: BkkParts) => `${two(Math.floor(p.ms / 3600000))}:${two(Math.floor(p.ms / 60000) % 60)}`;
    return s.y === b.y && s.m === b.m && s.d === b.d
      ? `${day(s)} ${s.y} ${time(s)}–${time(b)}`
      : `${day(s)} ${s.y} ${time(s)} – ${day(b)} ${b.y} ${time(b)}`;
  }
  if (a.y !== b.y) return `${day(a)} ${a.y} – ${day(b)} ${b.y}`;
  if (a.m !== b.m) return `${day(a)} – ${day(b)} ${a.y}`;
  if (a.d !== b.d) return `${a.d}–${b.d} ${TH_MONTHS[a.m]} ${a.y}`;
  return `${day(a)} ${a.y}`;
}

/** The comparison parameters that are set, to carry along in the page's other links and forms. */
export function compareParams(sp: CompareQuery): Record<string, string | undefined> {
  return { cmp: sp.cmp || undefined, cfrom: sp.cfrom || undefined, cto: sp.cto || undefined };
}

/** Percent change from `prev` to `cur`. From zero, any rise counts as +100% (the rule the Overview already used). */
export function pctChange(cur: number, prev: number): number {
  return prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
}

export type Delta = { dir: "up" | "down" | "flat"; text: string };

export function delta(cur: number, prev: number): Delta {
  const d = pctChange(cur, prev);
  if (Math.abs(d) < 0.5) return { dir: "flat", text: "→ 0%" };
  return d > 0 ? { dir: "up", text: `▲ ${d.toFixed(0)}%` } : { dir: "down", text: `▼ ${Math.abs(d).toFixed(0)}%` };
}
