/** Run: npx tsx src/lib/backlink-management/vendor-rank.test.ts */
import assert from "node:assert/strict";
import { VENDOR_RANKS, vendorRank } from "./vendor-rank";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

t("General up to 7,999", () => {
  assert.equal(vendorRank(1), "GENERAL");
  assert.equal(vendorRank(3000), "GENERAL");
  assert.equal(vendorRank(7999), "GENERAL");
  assert.equal(vendorRank(7999.99), "GENERAL");
});

t("High Authority from 8,000", () => {
  assert.equal(vendorRank(8000), "HIGH_AUTHORITY");
  assert.equal(vendorRank(25000), "HIGH_AUTHORITY");
});

t("no price -> no rank", () => {
  assert.equal(vendorRank(0), null);
  assert.equal(vendorRank(-5), null);
  assert.equal(vendorRank(null), null);
  assert.equal(vendorRank(undefined), null);
  assert.equal(vendorRank(Number.NaN), null);
});

t("rank list labels and ranges", () => {
  assert.deepEqual(VENDOR_RANKS.map((r) => [r.key, r.range]), [["HIGH_AUTHORITY", "8,000+ บาท"], ["GENERAL", "0–7,999 บาท"]]);
});

console.log(`\n${n} passed`);
