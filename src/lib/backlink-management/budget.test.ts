/** Run: npx tsx src/lib/backlink-management/budget.test.ts */
import assert from "node:assert/strict";
import { currentPeriod, isValidPeriod, round2, summarizeBudget } from "./budget";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

t("round2", () => { assert.equal(round2(1.005 + 0.1), 1.11); assert.equal(round2(NaN), 0); });
t("isValidPeriod", () => {
  assert.ok(isValidPeriod("2026-11")); assert.ok(!isValidPeriod("2026-13")); assert.ok(!isValidPeriod("26-11")); assert.ok(!isValidPeriod(null));
});
t("currentPeriod uses Bangkok time", () => {
  assert.equal(currentPeriod(new Date("2026-10-31T17:30:00Z")), "2026-11"); // 00:30 ICT 1 Nov
  assert.equal(currentPeriod(new Date("2026-10-31T16:30:00Z")), "2026-10");
});
t("summarizeBudget buckets", () => {
  const s = summarizeBudget(10000, [
    { status: "REQUESTED", quotedPrice: 1000, actualPrice: null },
    { status: "APPROVED", quotedPrice: 2000, actualPrice: null },
    { status: "IN_PROGRESS", quotedPrice: 500.5, actualPrice: null },
    { status: "PUBLISHED", quotedPrice: 1500, actualPrice: 1400 },
    { status: "VERIFIED", quotedPrice: 800, actualPrice: null },
    { status: "LOST", quotedPrice: 300, actualPrice: 250 },
    { status: "REJECTED", quotedPrice: 9999, actualPrice: null },
    { status: "CANCELLED", quotedPrice: 9999, actualPrice: 9999 },
  ]);
  assert.deepEqual(s, { approved: 10000, pending: 1000, reserved: 2500.5, actual: 2450, remaining: 5049.5, overBudget: false });
});
t("overBudget", () => {
  const s = summarizeBudget(1000, [{ status: "APPROVED", quotedPrice: 1500, actualPrice: null }]);
  assert.equal(s.remaining, -500); assert.equal(s.overBudget, true);
});
t("empty", () => { assert.equal(summarizeBudget(0, []).remaining, 0); });
console.log(`${n} passed`);
