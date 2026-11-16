/** Run: npx tsx src/lib/backlink-management/quota-year.test.ts */
import assert from "node:assert/strict";
import { quotaPackageYear, quotaYears } from "./quota-year";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }
const p = (tabTitle: string, startDate: string | null = null, expireDate: string | null = null) => ({ tabTitle, startDate, expireDate });

t("year from tab title wins", () => {
  assert.equal(quotaPackageYear(p("2024 [Done]", "2023-12-01")), 2024);
  assert.equal(quotaPackageYear(p("2025")), 2025);
  assert.equal(quotaPackageYear(p("Status Contracts List 2026", "2025-11-01")), 2026);
});

t("tab without a year falls back to start, then expiry", () => {
  assert.equal(quotaPackageYear(p("Total Backlinks with Tier", "2025-03-01", "2026-03-01")), 2025);
  assert.equal(quotaPackageYear(p("Sheet1", null, "2026-03-01")), 2026);
  assert.equal(quotaPackageYear(p("Sheet1")), null);
});

t("numbers that are not years are ignored", () => {
  assert.equal(quotaPackageYear(p("Tier 3 links 120")), null);
  assert.equal(quotaPackageYear(p("Batch 202501")), null);
});

t("year list is newest first, no-year last, with counts", () => {
  const ys = quotaYears([p("2024 [Done]"), p("2025"), p("2025"), p("Status Contracts List 2026"), p("Sheet1")]);
  assert.deepEqual(ys, [{ year: 2026, count: 1 }, { year: 2025, count: 2 }, { year: 2024, count: 1 }, { year: null, count: 1 }]);
});

console.log(`\n${n} passed`);
