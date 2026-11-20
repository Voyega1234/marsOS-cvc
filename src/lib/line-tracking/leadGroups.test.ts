import { test } from "node:test";
import assert from "node:assert/strict";
import { foldByProject, foldByStatus, foldClicks, type LeadGroupRow } from "./leadGroups";

const row = (channelGroup: string | null, status: string, count: number, value: number | null): LeadGroupRow => ({
  channelGroup,
  status,
  _count: count,
  _sum: { value },
});

test("foldByStatus merges channels into one row per status, in first-seen order", () => {
  const out = foldByStatus([
    row("google", "NEW", 3, 100),
    row("facebook", "WON", 2, 500),
    row(null, "NEW", 1, 50),
    row("facebook", "NEW", 4, null),
  ]);
  assert.deepEqual(out, [
    { status: "NEW", _count: 8, _sum: { value: 150 } },
    { status: "WON", _count: 2, _sum: { value: 500 } },
  ]);
});

test("foldByStatus keeps a null sum only when every value in the status is null", () => {
  assert.deepEqual(foldByStatus([row("a", "LOST", 1, null), row("b", "LOST", 2, null)]), [
    { status: "LOST", _count: 3, _sum: { value: null } },
  ]);
  assert.deepEqual(foldByStatus([row("a", "PAID", 1, null), row("b", "PAID", 1, 0)]), [
    { status: "PAID", _count: 2, _sum: { value: 0 } },
  ]);
});

test("foldByStatus does not mutate its input rows", () => {
  const input = [row("a", "NEW", 1, 10), row("b", "NEW", 1, 20)];
  foldByStatus(input);
  assert.deepEqual(input, [row("a", "NEW", 1, 10), row("b", "NEW", 1, 20)]);
});

test("foldByStatus and foldClicks return empty totals for no rows", () => {
  assert.deepEqual(foldByStatus([]), []);
  assert.deepEqual(foldClicks([]), { _all: 0, lineClickedAt: 0 });
});

test("foldClicks sums every channel", () => {
  assert.deepEqual(
    foldClicks([{ _count: { _all: 10, lineClickedAt: 4 } }, { _count: { _all: 5, lineClickedAt: 0 } }]),
    { _all: 15, lineClickedAt: 4 },
  );
});

test("foldByProject counts all leads and purchased leads per project", () => {
  const { leads, purchases } = foldByProject(
    [
      { projectId: "p1", status: "NEW", _count: 3 },
      { projectId: "p1", status: "WON", _count: 2 },
      { projectId: "p1", status: "PAID", _count: 1 },
      { projectId: "p2", status: "LOST", _count: 4 },
    ],
    ["WON", "PAID"],
  );
  assert.deepEqual(Array.from(leads), [["p1", 6], ["p2", 4]]);
  assert.deepEqual(Array.from(purchases), [["p1", 3]]);
});
