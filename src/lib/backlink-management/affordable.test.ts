/** Run: npx tsx src/lib/backlink-management/affordable.test.ts */
import assert from "node:assert/strict";
import { affordableSites, priceOptions, type AffordableInput } from "./affordable";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

const v = (id: string, o: Partial<AffordableInput> = {}): AffordableInput => ({
  id, domain: `${id}.com`, category: "", price: 0, domainRating: null, traffic: null, linkType: "", ...o,
});

t("detail prices sorted with labels", () => {
  const o = priceOptions(v("a", { price: 999, pricePr: 500, priceBacklink: 100 }));
  assert.deepEqual(o, [{ label: "Only Backlink", price: 100 }, { label: "PR", price: 500 }]);
});
t("fallback to price", () => {
  assert.deepEqual(priceOptions(v("a", { price: 300 })), [{ label: "ราคาเริ่มต้น", price: 300 }]);
});
t("zero/negative/NaN/null ignored", () => {
  assert.deepEqual(priceOptions(v("a", { price: 0, priceBacklink: 0, pricePr: -5, priceCvcWeb: NaN, pricePublisherWeb: null })), []);
  assert.deepEqual(priceOptions(v("a", { price: NaN })), []);
});
t("options filtered by remaining, boundary affordable", () => {
  const r = affordableSites(500, [v("a", { priceBacklink: 100, pricePr: 500, priceCvcWeb: 900 })]);
  assert.equal(r.total, 1);
  assert.deepEqual(r.sites[0].options.map((o) => o.price), [100, 500]);
  assert.equal(r.sites[0].maxLinks, 5);
  assert.equal(affordableSites(99.99, [v("a", { priceBacklink: 100 })]).total, 0);
});
t("sort DR desc null last, then price, then domain", () => {
  const r = affordableSites(1000, [
    v("n", { price: 10, domainRating: null }), v("b", { price: 50, domainRating: 40 }),
    v("a", { price: 50, domainRating: 40 }), v("c", { price: 20, domainRating: 40 }), v("h", { price: 90, domainRating: 70 }),
  ]);
  assert.deepEqual(r.sites.map((s) => s.id), ["h", "c", "a", "b", "n"]);
});
t("limit vs total", () => {
  const r = affordableSites(1000, [v("a", { price: 1 }), v("b", { price: 2 }), v("c", { price: 3 })], 2);
  assert.equal(r.sites.length, 2); assert.equal(r.total, 3);
});
t("remaining 0 / negative / NaN", () => {
  for (const rem of [0, -5, NaN]) {
    const r = affordableSites(rem, [v("a", { price: 10 }), v("b")]);
    assert.equal(r.total, 0); assert.equal(r.sites.length, 0); assert.equal(r.greedyCount, 0); assert.equal(r.greedyCost, 0);
    assert.equal(r.pricedSites, 1); assert.equal(r.cheapest, 10);
  }
});
t("unpriced sites ignored", () => {
  const r = affordableSites(100, [v("a"), v("b", { price: 10 })]);
  assert.equal(r.pricedSites, 1); assert.equal(r.total, 1);
  assert.equal(affordableSites(100, []).cheapest, null);
});
t("greedy count and cost", () => {
  const r = affordableSites(100, [v("a", { price: 60 }), v("b", { price: 30 }), v("c", { price: 20 }), v("d", { price: 50 })]);
  assert.equal(r.greedyCount, 3); assert.equal(r.greedyCost, 100);
});
t("float drift 0.1 + 0.2 within 0.3", () => {
  const r = affordableSites(0.3, [v("a", { price: 0.1 }), v("b", { price: 0.2 })]);
  assert.equal(r.greedyCount, 2); assert.equal(r.greedyCost, 0.3);
});
t("remaining float drift 999.9999999 still affords price 1000", () => {
  const r = affordableSites(999.9999999, [v("a", { price: 1000 })]);
  assert.equal(r.total, 1); assert.equal(r.sites[0].maxLinks, 1);
});
t("remaining 999.994 rounds to 999.99, not affordable for 1000", () => {
  const r = affordableSites(999.994, [v("a", { price: 1000 })]);
  assert.equal(r.total, 0); assert.equal(r.sites.length, 0);
});
t("remaining 2000.004 gives 2 links at price 1000", () => {
  const r = affordableSites(2000.004, [v("a", { price: 1000 })]);
  assert.equal(r.total, 1); assert.equal(r.sites[0].maxLinks, 2);
});
console.log(`${n} passed`);
