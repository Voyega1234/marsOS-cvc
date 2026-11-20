import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRange } from "./date-range";
import { bucketDailyLeads, dailyWindow, dayLabel, overviewQuery, rateDialMax, DAILY_MAX_DAYS } from "./overview";

const NOW = new Date("2026-11-13T10:00:00.000+07:00");
const at = (iso: string) => new Date(`${iso}+07:00`);
const PURCHASED = ["WON", "PAID"];
const lead = (iso: string, status = "NEW", value: number | null = 0) => ({ createdAt: at(iso), status, value });

test("overviewQuery: no range opens on the last 7 days", () => {
  assert.deepEqual(overviewQuery({}, NOW), { range: "7d" });
  assert.deepEqual(overviewQuery({ cmp: "month" } as { cmp: string; range?: string }, NOW), { cmp: "month", range: "7d" });
});

test("overviewQuery: an explicit range is never touched", () => {
  for (const range of ["all", "today", "30d", "custom", "nonsense"]) {
    const sp = { range, days: "30" };
    assert.equal(overviewQuery(sp, NOW), sp);
  }
});

test("overviewQuery: old days= bookmarks keep their window", () => {
  assert.deepEqual(overviewQuery({ days: "30" }, NOW), { days: "30", range: "30d" });
  assert.deepEqual(overviewQuery({ days: "7" }, NOW), { days: "7", range: "7d" });
  assert.deepEqual(overviewQuery({ days: "12" }, NOW), { days: "12", range: "7d" });
  const q = overviewQuery({ days: "90" }, NOW);
  assert.deepEqual(q, { days: "90", range: "custom", from: "2026-08-15", to: undefined });
  // It resolves like any custom range: from Bangkok midnight, open end.
  assert.equal(resolveRange(q)?.from?.toISOString(), "2026-08-14T17:00:00.000Z");
});

test("dailyWindow: a rolling window ends now and has partial first and last days", () => {
  const w = dailyWindow({ from: new Date(NOW.getTime() - 7 * 86400000) }, NOW);
  assert.ok(w);
  assert.equal(w.from.toISOString(), at("2026-11-06T10:00:00.000").toISOString());
  assert.equal(w.to, NOW);
  assert.deepEqual([w.capped, w.partialStart, w.partialEnd], [false, true, true]);
});

test("dailyWindow: whole days are not partial", () => {
  const w = dailyWindow({ from: at("2026-11-01T00:00:00.000"), to: at("2026-11-07T23:59:59.999") }, NOW);
  assert.ok(w);
  assert.deepEqual([w.capped, w.partialStart, w.partialEnd], [false, false, false]);
});

test("dailyWindow: no start, or a start too far back, is capped to the last days", () => {
  for (const range of [undefined, {}, { from: at("2025-01-01T00:00:00.000") }]) {
    const w = dailyWindow(range, NOW);
    assert.ok(w);
    assert.equal(w.capped, true);
    assert.equal(w.partialStart, false);
    // 90 calendar days including today.
    assert.equal(w.from.toISOString(), at("2026-08-16T00:00:00.000").toISOString());
    assert.equal(Math.round((at("2026-11-14T00:00:00.000").getTime() - w.from.getTime()) / 86400000), DAILY_MAX_DAYS);
  }
});

test("dailyWindow: an end in the future stops at now; a window that has not started is empty", () => {
  const w = dailyWindow({ from: at("2026-11-10T00:00:00.000"), to: at("2026-12-31T23:59:59.999") }, NOW);
  assert.equal(w?.to, NOW);
  assert.equal(dailyWindow({ from: at("2026-12-01T00:00:00.000") }, NOW), null);
});

test("bucketDailyLeads: one point per Bangkok day, empty days kept, oldest first", () => {
  const w = dailyWindow({ from: at("2026-11-10T00:00:00.000"), to: at("2026-11-13T23:59:59.999") }, NOW)!;
  const s = bucketDailyLeads(
    [
      // 00:30 Bangkok is still the previous day in UTC: it must land on the 10th.
      lead("2026-11-10T00:30:00.000"),
      lead("2026-11-10T23:59:00.000", "PAID", 5000),
      lead("2026-11-12T09:00:00.000", "WON", 3000),
      lead("2026-11-12T12:00:00.000", "LOST", 9999),
      lead("2026-11-13T08:00:00.000", "PAID", null),
    ],
    w,
    PURCHASED,
  );
  assert.deepEqual(s.points, [
    { day: "2026-11-10", leads: 2, purchases: 1, revenue: 5000 },
    { day: "2026-11-11", leads: 0, purchases: 0, revenue: 0 },
    { day: "2026-11-12", leads: 2, purchases: 1, revenue: 3000 },
    { day: "2026-11-13", leads: 1, purchases: 1, revenue: 0 },
  ]);
  assert.deepEqual([s.capped, s.partialStart, s.partialEnd], [false, false, true]);
});

test("bucketDailyLeads: a rolling 7-day window covers 8 calendar days", () => {
  const w = dailyWindow({ from: new Date(NOW.getTime() - 7 * 86400000) }, NOW)!;
  const s = bucketDailyLeads([lead("2026-11-06T11:00:00.000"), lead("2026-11-13T09:00:00.000")], w, PURCHASED);
  assert.equal(s.points.length, 8);
  assert.equal(s.points[0].day, "2026-11-06");
  assert.equal(s.points[7].day, "2026-11-13");
  assert.equal(s.points.reduce((n, p) => n + p.leads, 0), 2);
  assert.equal(s.partialStart, true);
  // 8 calendar days, but 7 days of time: the average per day divides by 7.
  assert.equal(s.spanDays, 7);
});

test("bucketDailyLeads: a capped window starts at the first day with a lead", () => {
  const w = dailyWindow(undefined, NOW)!;
  const s = bucketDailyLeads([lead("2026-11-11T09:00:00.000"), lead("2026-11-12T09:00:00.000")], w, PURCHASED);
  assert.deepEqual(s.points.map((p) => p.day), ["2026-11-11", "2026-11-12", "2026-11-13"]);
  assert.equal(s.capped, true);
  // From 00:00 on the 11th to 10:00 on the 13th.
  assert.equal(s.spanDays, 2 + 10 / 24);
  const empty = bucketDailyLeads([], w, PURCHASED);
  assert.deepEqual([empty.points, empty.spanDays, empty.capped], [[], 0, true]);
});

test("bucketDailyLeads: rows outside the window are ignored", () => {
  const w = dailyWindow({ from: at("2026-11-12T00:00:00.000"), to: at("2026-11-12T23:59:59.999") }, NOW)!;
  const s = bucketDailyLeads([lead("2026-11-11T23:00:00.000"), lead("2026-11-12T01:00:00.000"), lead("2026-11-13T01:00:00.000")], w, PURCHASED);
  assert.deepEqual(s.points, [{ day: "2026-11-12", leads: 1, purchases: 0, revenue: 0 }]);
});

test("dayLabel", () => {
  assert.equal(dayLabel("2026-11-05"), "5 พ.ย.");
  assert.equal(dayLabel("2026-01-31"), "31 ม.ค.");
});

test("rateDialMax: first round step with headroom", () => {
  assert.equal(rateDialMax(3, 2), 5);
  assert.equal(rateDialMax(20, 26.5), 50);
  assert.equal(rateDialMax(0, 0), 1);
  assert.equal(rateDialMax(1.1), 2);
  assert.equal(rateDialMax(95, 40), 100);
  assert.equal(rateDialMax(NaN, 4), 5);
});
