/**
 * Year of a quota package, for the Quota tab's year filter.
 *
 * The quota sheet keeps one tab per contract year ("2024 [Done]", "2025", "Status Contracts List 2026"),
 * so the year in the tab title wins. A tab without a year falls back to the package's start date,
 * then its expiry date. A package with none of these has no year.
 */

export interface QuotaYearInput {
  tabTitle: string;
  startDate: string | null;
  expireDate: string | null;
}

const YEAR_IN_TEXT = /(?:^|\D)((?:19|20)\d{2})(?!\d)/;
const YEAR_IN_ISO = /^(\d{4})-\d{2}-\d{2}/;

export function quotaPackageYear(p: QuotaYearInput): number | null {
  const fromTab = YEAR_IN_TEXT.exec(p.tabTitle ?? "");
  if (fromTab) return parseInt(fromTab[1], 10);
  for (const d of [p.startDate, p.expireDate]) {
    const m = d ? YEAR_IN_ISO.exec(d) : null;
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** Years present in the packages, newest first, with how many packages each holds. */
export function quotaYears(pkgs: QuotaYearInput[]): { year: number | null; count: number }[] {
  const m = new Map<number | null, number>();
  for (const p of pkgs) {
    const y = quotaPackageYear(p);
    m.set(y, (m.get(y) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => (a.year == null ? 1 : b.year == null ? -1 : b.year - a.year));
}
