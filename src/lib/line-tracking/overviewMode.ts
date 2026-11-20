// What the project Overview shows: sales (the default) or Lead / LINE / CPA for a business
// that does not sell through the funnel. Pure, so it can be tested (overviewMode.test.ts);
// services/overviewSettingsStore.ts reads and writes it.
//
// The setting is kept in one lt_project_connection row with type OVERVIEW_SETTINGS (status
// stays NOT_CONNECTED), so no database migration is needed. That type is NOT in
// CONNECTION_TYPES: the setup checklist and the connections page never see it.
import type { DateWindow } from "./compare";

export const OVERVIEW_SETTINGS_TYPE = "OVERVIEW_SETTINGS";

export const OVERVIEW_MODES = ["SALE", "LEAD"] as const;
export type OverviewMode = (typeof OVERVIEW_MODES)[number];

export type OverviewSettings = {
  mode: OverviewMode;
  /** Ad spend typed by staff for a whole Bangkok calendar month, keyed "YYYY-MM". */
  adSpendByMonth: Record<string, number>;
};

export const DEFAULT_OVERVIEW_SETTINGS: OverviewSettings = { mode: "SALE", adSpendByMonth: {} };

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Upper bound for one month of spend; keeps a typo of extra zeros out of the CPA. */
export const MAX_MONTHLY_SPEND = 1_000_000_000;

export function parseOverviewMode(v: unknown): OverviewMode | null {
  return typeof v === "string" && (OVERVIEW_MODES as readonly string[]).includes(v) ? (v as OverviewMode) : null;
}

/** The stored JSON, read defensively: anything unexpected falls back to the default. */
export function parseOverviewSettings(raw: string | null | undefined): OverviewSettings {
  if (!raw) return { ...DEFAULT_OVERVIEW_SETTINGS, adSpendByMonth: {} };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_OVERVIEW_SETTINGS, adSpendByMonth: {} };
  }
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const adSpendByMonth: Record<string, number> = {};
  const spend = obj.adSpendByMonth;
  if (spend && typeof spend === "object") {
    for (const [k, v] of Object.entries(spend as Record<string, unknown>)) {
      if (MONTH_KEY.test(k) && typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_MONTHLY_SPEND) {
        adSpendByMonth[k] = v;
      }
    }
  }
  return { mode: parseOverviewMode(obj.mode) ?? "SALE", adSpendByMonth };
}

export type SpendInput = { ok: true; month: string; amount: number | null } | { ok: false; error: string };

/**
 * One month of spend from the form. An empty amount or 0 removes the month (amount null).
 * Commas are allowed ("12,500").
 */
export function parseSpendInput(month: unknown, amount: unknown): SpendInput {
  const m = typeof month === "string" ? month.trim() : "";
  if (!MONTH_KEY.test(m)) return { ok: false, error: "เลือกเดือนก่อน" };
  const a = typeof amount === "string" ? amount.replace(/,/g, "").trim() : "";
  if (a === "") return { ok: true, month: m, amount: null };
  if (!/^\d+(\.\d{1,2})?$/.test(a)) return { ok: false, error: "งบโฆษณาต้องเป็นตัวเลข" };
  const n = Number(a);
  if (!Number.isFinite(n) || n > MAX_MONTHLY_SPEND) return { ok: false, error: "งบโฆษณาสูงเกินไป" };
  return { ok: true, month: m, amount: n === 0 ? null : n };
}

export function withSpend(settings: OverviewSettings, month: string, amount: number | null): OverviewSettings {
  const adSpendByMonth = { ...settings.adSpendByMonth };
  if (amount === null) delete adSpendByMonth[month];
  else adSpendByMonth[month] = amount;
  return { ...settings, adSpendByMonth };
}

/** What a duplicated project starts with: the same view, but not the original's ad spend. */
export function settingsForDuplicate(settings: OverviewSettings): OverviewSettings {
  return { mode: settings.mode, adSpendByMonth: {} };
}

/** Start of a Bangkok calendar month, as an instant. month0 may run past 11 or below 0. */
function bkkMonthStart(year: number, month0: number): number {
  return Date.UTC(year, month0, 1) - BKK_OFFSET_MS;
}

function monthKey(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type WindowSpend = {
  /** Spend for the window, or null when it cannot be worked out without guessing. */
  amount: number | null;
  /** Months the window touches that have no spend entered. */
  missingMonths: string[];
  /** True when the window has no start (all time): no spend figure is given then. */
  unbounded: boolean;
};

/**
 * The ad spend for a date window, each month's amount spread evenly over that month's time
 * (Bangkok). A window of 7 days in a 30-day month gets 7/30 of that month's spend. When any
 * month the window touches has no spend entered, the amount is null rather than a partial sum.
 */
export function spendForWindow(spendByMonth: Record<string, number>, window: DateWindow | null): WindowSpend {
  if (!window) return { amount: null, missingMonths: [], unbounded: true };
  const from = window.from.getTime();
  const to = window.to.getTime() + 1; // the window's end is inclusive
  if (!(to > from)) return { amount: null, missingMonths: [], unbounded: false };

  const startLocal = new Date(from + BKK_OFFSET_MS);
  let year = startLocal.getUTCFullYear();
  let month0 = startLocal.getUTCMonth();
  let total = 0;
  const missingMonths: string[] = [];
  // At most a few hundred iterations even for a window of decades.
  for (let guard = 0; guard < 1200; guard++) {
    const mStart = bkkMonthStart(year, month0);
    if (mStart >= to) break;
    const mEnd = bkkMonthStart(year, month0 + 1);
    const overlap = Math.min(to, mEnd) - Math.max(from, mStart);
    if (overlap > 0) {
      const key = monthKey(year, month0);
      const spend = spendByMonth[key];
      if (spend === undefined) missingMonths.push(key);
      else total += spend * (overlap / (mEnd - mStart));
    }
    month0 += 1;
    if (month0 > 11) {
      month0 = 0;
      year += 1;
    }
  }
  return { amount: missingMonths.length ? null : total, missingMonths, unbounded: false };
}

/** Cost per lead, or null when there is no spend figure or no lead. */
export function costPerLead(spend: number | null, leads: number): number | null {
  if (spend === null || !(leads > 0)) return null;
  return spend / leads;
}

/** "2026-11" → "พ.ย. 2026" style label for the list of entered months. */
export function monthLabel(key: string): string {
  const m = MONTH_KEY.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return d.toLocaleDateString("th-TH", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** The Bangkok month an instant falls in, as "YYYY-MM" (the month picker's default). */
export function bkkMonthKey(date: Date): string {
  const d = new Date(date.getTime() + BKK_OFFSET_MS);
  return monthKey(d.getUTCFullYear(), d.getUTCMonth());
}
