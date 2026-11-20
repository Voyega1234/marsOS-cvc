import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bkkMonthKey,
  costPerLead,
  parseOverviewMode,
  parseOverviewSettings,
  parseSpendInput,
  settingsForDuplicate,
  spendForWindow,
  withSpend,
} from "./overviewMode";

// Bangkok midnight of a day, as an instant.
const bkk = (iso: string) => new Date(`${iso}T00:00:00+07:00`);
const endOfBkkDay = (iso: string) => new Date(bkk(iso).getTime() + 24 * 3600 * 1000 - 1);

test("no saved setting means the sales view", () => {
  assert.deepEqual(parseOverviewSettings(null), { mode: "SALE", adSpendByMonth: {} });
  assert.deepEqual(parseOverviewSettings("{}"), { mode: "SALE", adSpendByMonth: {} });
  assert.deepEqual(parseOverviewSettings("not json"), { mode: "SALE", adSpendByMonth: {} });
  assert.deepEqual(parseOverviewSettings('{"mode":"OTHER"}'), { mode: "SALE", adSpendByMonth: {} });
});

test("a saved lead view and its spend are read back; bad entries are dropped", () => {
  const s = parseOverviewSettings(
    JSON.stringify({ mode: "LEAD", adSpendByMonth: { "2026-11": 30000, "2026-13": 5, bad: 1, "2026-10": -4, "2026-09": "9" } }),
  );
  assert.deepEqual(s, { mode: "LEAD", adSpendByMonth: { "2026-11": 30000 } });
});

test("mode values outside the list are refused", () => {
  assert.equal(parseOverviewMode("LEAD"), "LEAD");
  assert.equal(parseOverviewMode("SALE"), "SALE");
  assert.equal(parseOverviewMode("lead"), null);
  assert.equal(parseOverviewMode(undefined), null);
});

test("spend form input", () => {
  assert.deepEqual(parseSpendInput("2026-11", "12,500"), { ok: true, month: "2026-11", amount: 12500 });
  assert.deepEqual(parseSpendInput("2026-11", "99.5"), { ok: true, month: "2026-11", amount: 99.5 });
  assert.deepEqual(parseSpendInput("2026-11", ""), { ok: true, month: "2026-11", amount: null });
  assert.deepEqual(parseSpendInput("2026-11", "0"), { ok: true, month: "2026-11", amount: null });
  assert.equal(parseSpendInput("", "100").ok, false);
  assert.equal(parseSpendInput("2026-11", "-5").ok, false);
  assert.equal(parseSpendInput("2026-11", "abc").ok, false);
  assert.equal(parseSpendInput("2026-11", "1e9").ok, false);
  assert.equal(parseSpendInput("2026-11", "99999999999").ok, false);
});

test("saving 0 removes the month", () => {
  const s = withSpend({ mode: "LEAD", adSpendByMonth: { "2026-11": 100 } }, "2026-11", null);
  assert.deepEqual(s.adSpendByMonth, {});
  assert.deepEqual(withSpend(s, "2026-10", 50).adSpendByMonth, { "2026-10": 50 });
});

test("a duplicated project keeps the view but not the spend", () => {
  assert.deepEqual(settingsForDuplicate({ mode: "LEAD", adSpendByMonth: { "2026-11": 100 } }), {
    mode: "LEAD",
    adSpendByMonth: {},
  });
});

test("a whole month gets that month's spend", () => {
  const r = spendForWindow({ "2026-11": 30000 }, { from: bkk("2026-11-01"), to: endOfBkkDay("2026-11-30") });
  assert.equal(Math.round(r.amount!), 30000);
  assert.deepEqual(r.missingMonths, []);
});

test("7 days of a 30-day month get 7/30 of it", () => {
  const r = spendForWindow({ "2026-11": 30000 }, { from: bkk("2026-11-10"), to: endOfBkkDay("2026-11-16") });
  assert.equal(Math.round(r.amount!), 7000);
});

test("a window across two months adds each month's share", () => {
  // 31 Oct (1 of 31 days) + 1 Nov (1 of 30 days)
  const r = spendForWindow({ "2026-10": 31000, "2026-11": 30000 }, { from: bkk("2026-10-31"), to: endOfBkkDay("2026-11-01") });
  assert.equal(Math.round(r.amount!), 2000);
});

test("a month with no spend gives no figure, and names the month", () => {
  const r = spendForWindow({ "2026-11": 30000 }, { from: bkk("2026-10-31"), to: endOfBkkDay("2026-11-01") });
  assert.equal(r.amount, null);
  assert.deepEqual(r.missingMonths, ["2026-10"]);
});

test("all time gives no figure", () => {
  assert.deepEqual(spendForWindow({ "2026-11": 1 }, null), { amount: null, missingMonths: [], unbounded: true });
});

test("Bangkok month edges: 17:00 UTC on the last day already belongs to the next month", () => {
  assert.equal(bkkMonthKey(new Date("2026-10-31T16:59:59.999Z")), "2026-10");
  assert.equal(bkkMonthKey(new Date("2026-10-31T17:00:00.000Z")), "2026-11");
  assert.equal(bkkMonthKey(new Date("2026-12-31T17:00:00.000Z")), "2027-01");
});

test("cost per lead", () => {
  assert.equal(costPerLead(1000, 4), 250);
  assert.equal(costPerLead(1000, 0), null);
  assert.equal(costPerLead(null, 4), null);
});
