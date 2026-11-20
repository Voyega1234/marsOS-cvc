import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareMode,
  compareParams,
  currentWindow,
  delta,
  monthBeforeWindow,
  pctChange,
  previousWindow,
  resolveCompare,
  shiftMonths,
  windowLabel,
  type DateWindow,
} from "./compare";

/** A Bangkok day as the custom range of date-range.ts resolves it. */
const days = (from: string, to: string): DateWindow => ({
  from: new Date(`${from}T00:00:00.000+07:00`),
  to: new Date(`${to}T23:59:59.999+07:00`),
});
const iso = (w: DateWindow | null) => (w ? [w.from.toISOString(), w.to.toISOString()] : null);
const NOW = new Date("2026-11-12T10:00:00.000+07:00");

test("compareMode: known values pass, anything else is the page default", () => {
  assert.equal(compareMode({ cmp: "month" }, "off"), "month");
  assert.equal(compareMode({ cmp: "off" }, "prev"), "off");
  assert.equal(compareMode({}, "prev"), "prev");
  assert.equal(compareMode({ cmp: "nonsense" }, "off"), "off");
});

test("currentWindow: an open end is now, no start means no window", () => {
  assert.equal(currentWindow(undefined, NOW), null);
  assert.equal(currentWindow({}, NOW), null);
  assert.equal(currentWindow({ to: NOW }, NOW), null);
  const from = new Date("2026-11-05T10:00:00.000+07:00");
  assert.deepEqual(currentWindow({ from }, NOW), { from, to: NOW });
  assert.equal(currentWindow({ from: NOW, to: from }, NOW), null);
  assert.equal(currentWindow({ from: new Date("x") }, NOW), null);
});

test("previousWindow: the same number of days right before", () => {
  assert.deepEqual(iso(previousWindow(days("2026-11-01", "2026-11-11"))), iso(days("2026-10-21", "2026-10-31")));
  assert.deepEqual(iso(previousWindow(days("2026-11-12", "2026-11-12"))), iso(days("2026-11-11", "2026-11-11")));
});

test("monthBeforeWindow: 1-11 of this month against 1-11 of last month", () => {
  assert.deepEqual(iso(monthBeforeWindow(days("2026-11-01", "2026-11-11"))), iso(days("2026-10-01", "2026-10-11")));
  // Across the year boundary.
  assert.deepEqual(iso(monthBeforeWindow(days("2026-01-05", "2026-01-15"))), iso(days("2025-12-05", "2025-12-15")));
});

test("monthBeforeWindow: whole months stay whole months", () => {
  assert.deepEqual(iso(monthBeforeWindow(days("2026-11-01", "2026-11-30"))), iso(days("2026-10-01", "2026-10-31")));
  assert.deepEqual(iso(monthBeforeWindow(days("2026-03-01", "2026-03-31"))), iso(days("2026-02-01", "2026-02-28")));
  // Not a whole month: the end keeps its day number.
  assert.deepEqual(iso(monthBeforeWindow(days("2026-11-02", "2026-11-30"))), iso(days("2026-10-02", "2026-10-30")));
});

test("monthBeforeWindow: a day the earlier month lacks becomes its last day", () => {
  assert.deepEqual(iso(monthBeforeWindow(days("2026-03-29", "2026-03-31"))), iso(days("2026-02-28", "2026-02-28")));
  assert.deepEqual(iso(monthBeforeWindow(days("2024-03-30", "2024-03-31"))), iso(days("2024-02-29", "2024-02-29")));
});

test("shiftMonths keeps the Bangkok time of day", () => {
  // 02:30 Bangkok is still the previous day in UTC; the shift must follow the Bangkok calendar.
  const d = new Date("2026-11-01T02:30:00.000+07:00");
  assert.equal(shiftMonths(d, -1).toISOString(), new Date("2026-10-01T02:30:00.000+07:00").toISOString());
  assert.equal(shiftMonths(d, 1).toISOString(), new Date("2026-12-01T02:30:00.000+07:00").toISOString());
});

test("resolveCompare: off and the page default", () => {
  const range = days("2026-11-01", "2026-11-11");
  const off = resolveCompare({ cmp: "off" }, range, { fallback: "prev", now: NOW });
  assert.equal(off.mode, "off");
  assert.equal(off.window, null);
  assert.equal(off.hint, null);
  const byDefault = resolveCompare({}, range, { fallback: "prev", now: NOW });
  assert.equal(byDefault.mode, "prev");
  assert.deepEqual(iso(byDefault.window), iso(days("2026-10-21", "2026-10-31")));
  assert.equal(resolveCompare({}, range, { fallback: "off", now: NOW }).window, null);
});

test("resolveCompare: month", () => {
  const info = resolveCompare({ cmp: "month" }, days("2026-11-01", "2026-11-11"), { fallback: "off", now: NOW });
  assert.deepEqual(iso(info.window), iso(days("2026-10-01", "2026-10-11")));
  assert.equal(info.hint, null);
});

test("resolveCompare: a range that is still open ends now", () => {
  const from = new Date("2026-11-05T10:00:00.000+07:00");
  const info = resolveCompare({ cmp: "month" }, { from }, { fallback: "off", now: NOW });
  assert.deepEqual(iso(info.current), [from.toISOString(), NOW.toISOString()]);
  assert.deepEqual(iso(info.window), [
    new Date("2026-10-05T10:00:00.000+07:00").toISOString(),
    new Date("2026-10-12T10:00:00.000+07:00").toISOString(),
  ]);
});

test("resolveCompare: all time has nothing before it, but can take its own dates", () => {
  for (const cmp of ["prev", "month"]) {
    const info = resolveCompare({ cmp }, undefined, { fallback: "off", now: NOW });
    assert.equal(info.window, null);
    assert.ok(info.hint);
  }
  const own = resolveCompare({ cmp: "custom", cfrom: "2026-10-01", cto: "2026-10-11" }, undefined, { fallback: "off", now: NOW });
  assert.deepEqual(iso(own.window), iso(days("2026-10-01", "2026-10-11")));
});

test("resolveCompare: custom dates", () => {
  const range = days("2026-11-01", "2026-11-11");
  const opts = { fallback: "off" as const, now: NOW };
  const both = resolveCompare({ cmp: "custom", cfrom: "2026-09-01", cto: "2026-09-11" }, range, opts);
  assert.deepEqual(iso(both.window), iso(days("2026-09-01", "2026-09-11")));
  // Typed the wrong way round.
  const swapped = resolveCompare({ cmp: "custom", cfrom: "2026-09-11", cto: "2026-09-01" }, range, opts);
  assert.deepEqual(iso(swapped.window), iso(days("2026-09-01", "2026-09-11")));
  // One date: the other end follows from the length of the page's own range.
  const startOnly = resolveCompare({ cmp: "custom", cfrom: "2026-09-01" }, range, opts);
  assert.deepEqual(iso(startOnly.window), iso(days("2026-09-01", "2026-09-11")));
  const endOnly = resolveCompare({ cmp: "custom", cto: "2026-09-11" }, range, opts);
  assert.deepEqual(iso(endOnly.window), iso(days("2026-09-01", "2026-09-11")));
});

test("resolveCompare: custom dates that cannot be used give a hint, never a broken window", () => {
  const range = days("2026-11-01", "2026-11-11");
  const opts = { fallback: "off" as const, now: NOW };
  for (const sp of [
    { cmp: "custom" },
    { cmp: "custom", cfrom: "nope", cto: "2026-13-45" },
    { cmp: "custom", cfrom: "2026-02-31", cto: "2026-02-31" },
    { cmp: "custom", cfrom: "2026-9-1", cto: "1 Sep" },
  ]) {
    const info = resolveCompare(sp, range, opts);
    assert.equal(info.window, null, JSON.stringify(sp));
    assert.ok(info.hint);
  }
  // One date and no range to take the length from.
  assert.equal(resolveCompare({ cmp: "custom", cfrom: "2026-09-01" }, undefined, opts).window, null);
});

test("windowLabel", () => {
  assert.equal(windowLabel(days("2026-10-01", "2026-10-11")), "1–11 ต.ค. 2026");
  assert.equal(windowLabel(days("2026-10-28", "2026-11-03")), "28 ต.ค. – 3 พ.ย. 2026");
  assert.equal(windowLabel(days("2025-12-28", "2026-01-03")), "28 ธ.ค. 2025 – 3 ม.ค. 2026");
  assert.equal(windowLabel(days("2026-11-12", "2026-11-12")), "12 พ.ย. 2026");
});

test("windowLabel shows the times of a window that is not whole days", () => {
  // "วันนี้" at 10:00: the period before is the last ten hours of yesterday, not all of yesterday.
  const today = { from: new Date("2026-11-12T00:00:00.000+07:00"), to: NOW };
  assert.equal(windowLabel(previousWindow(today)), "11 พ.ย. 2026 14:00–23:59");
  assert.equal(windowLabel(monthBeforeWindow(today)), "12 ต.ค. 2026 00:00–10:00");
  const week = { from: new Date(NOW.getTime() - 7 * 86400000), to: NOW };
  assert.equal(windowLabel(monthBeforeWindow(week)), "5 ต.ค. 2026 10:00 – 12 ต.ค. 2026 10:00");
});

test("compareParams keeps only what is set", () => {
  assert.deepEqual(compareParams({ cmp: "custom", cfrom: "2026-09-01", cto: "" }), {
    cmp: "custom",
    cfrom: "2026-09-01",
    cto: undefined,
  });
  assert.deepEqual(compareParams({ range: "7d" }), { cmp: undefined, cfrom: undefined, cto: undefined });
});

test("pctChange and delta", () => {
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(3, 0), 100);
  assert.deepEqual(delta(150, 100), { dir: "up", text: "▲ 50%" });
  assert.deepEqual(delta(50, 100), { dir: "down", text: "▼ 50%" });
  assert.deepEqual(delta(1001, 1000), { dir: "flat", text: "→ 0%" });
  assert.deepEqual(delta(0, 0), { dir: "flat", text: "→ 0%" });
});
