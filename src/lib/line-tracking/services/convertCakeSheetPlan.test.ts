import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ccStatusName, isConvertCakeProject, parseCcSheet, parseSheetUrl, planCcSync, suggestStatus,
  type LeadLite, type LinkLite,
} from "./convertCakeSheetPlan";

const UID = "U" + "a".repeat(32);

// Convert Cake's layout: a group-heading row above the real header row.
const RAW = [
  ["ID & DATE", "", "NEED"],
  ["Lead ID", "Date", "Phone", "Status", "Note"],
  ["LD-0001", "2026-10-01", "081-234-5678", "J. Signed", ""],
  ["LD-0002", "2026-10-02", "", "D. Potential lead", `line ${UID}`],
  ["", "2026-10-03", "", "A. Spam", ""],
  ["LD-0003", "2026-10-03", "0899999999", "C. Cold lead", ""],
];

const lead = (id: string, status: string, extra: Partial<LeadLite> = {}): LeadLite => ({
  id, status, phone: null, fullName: null, displayName: null, lineUser: null, ...extra,
});

test("only the Convert Cake project is enabled", () => {
  assert.equal(isConvertCakeProject({ name: "Convert Cake" }), true);
  assert.equal(isConvertCakeProject({ name: " convertcake " }), true);
  assert.equal(isConvertCakeProject({ name: "MFactors" }), false);
  assert.equal(isConvertCakeProject({ name: "Convert Cake Clinic" }), false);
});

test("status names drop the sheet's letter prefix", () => {
  assert.equal(ccStatusName("G. Warm opportunity"), "Warm opportunity");
  assert.equal(ccStatusName("A. Spam"), "Spam");
  assert.equal(ccStatusName("Signed"), "Signed");
});

test("sheet url gives the id and gid", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`), { sheetId: id, gid: "42" });
  assert.deepEqual(parseSheetUrl(id), { sheetId: id, gid: null });
  assert.equal(parseSheetUrl("not a sheet"), null);
});

test("suggested mapping follows the status words", () => {
  assert.equal(suggestStatus("A. Spam"), "LOST");
  assert.equal(suggestStatus("B. Unqualified lead"), "LOST");
  assert.equal(suggestStatus("K. No opportunity"), "LOST");
  assert.equal(suggestStatus("C. Cold lead"), "CONTACTED");
  assert.equal(suggestStatus("D. Potential lead"), "QUALIFIED");
  assert.equal(suggestStatus("J. Signed"), "WON");
  assert.equal(suggestStatus("E. Lost opportunity"), "LOST");
  assert.equal(suggestStatus("F. Cold opportunity"), "QUALIFIED");
  assert.equal(suggestStatus("G. Warm opportunity"), "QUOTED");
  assert.equal(suggestStatus("H. Hot opportunity"), "QUOTED");
  assert.equal(suggestStatus("I. Commit to sign"), "QUOTED");
  assert.equal(suggestStatus("E. Something new"), "");
});

test("header is found below a group-heading row; rows without a Lead ID are skipped", () => {
  const p = parseCcSheet(RAW)!;
  assert.equal(p.columns.leadId, "Lead ID");
  assert.equal(p.columns.status, "Status");
  assert.equal(p.columns.phone, "Phone");
  assert.equal(p.columns.lineUserId, null);
  assert.deepEqual(p.rows.map((r) => r.sheetLeadId), ["LD-0001", "LD-0002", "LD-0003"]);
  assert.equal(p.rows[0].row, 3);
  assert.equal(p.rows[1].lineUserId, UID); // found inside a notes cell
  assert.equal(parseCcSheet([["a", "b"]]), null);
});

test("matching, mapping and protections", () => {
  const rows = parseCcSheet(RAW)!.rows;
  const leads = [
    lead("l1", "CONTACTED", { phone: "+66812345678" }),
    lead("l2", "NEW", { lineUser: { lineUserId: UID, displayName: "Ann" } }),
    lead("l3", "PAID", { phone: "0899999999" }),
  ];
  const map = { "J. Signed": "WON", "D. Potential lead": "QUALIFIED", "C. Cold lead": "CONTACTED" } as const;
  const plan = planCcSync({ rows, leads, links: [], map: { ...map } });
  const by = Object.fromEntries(plan.map((p) => [p.r.sheetLeadId, p]));
  assert.equal(by["LD-0001"].outcome, "change");
  assert.equal(by["LD-0001"].matchedBy, "phone");
  assert.equal(by["LD-0001"].next.appliedStatus, "WON");
  assert.equal(by["LD-0002"].outcome, "change");
  assert.equal(by["LD-0002"].matchedBy, "lineUserId");
  assert.equal(by["LD-0003"].outcome, "paid"); // PAID is never moved
  assert.ok(plan.every((p) => p.isNew && p.dirty));
});

test("unmapped status, not found and ambiguous are reported, never applied", () => {
  const rows = parseCcSheet(RAW)!.rows;
  const leads = [lead("a", "NEW", { phone: "0812345678" }), lead("b", "NEW", { phone: "0812345678" })];
  const plan = planCcSync({ rows, leads, links: [], map: {} });
  const by = Object.fromEntries(plan.map((p) => [p.r.sheetLeadId, p]));
  assert.equal(by["LD-0001"].outcome, "ambiguous");
  assert.equal(by["LD-0001"].next.leadId, null);
  assert.equal(by["LD-0002"].outcome, "notfound");
  const one = planCcSync({ rows, leads: [lead("a", "NEW", { phone: "0812345678" })], links: [], map: {} });
  assert.equal(one[0].outcome, "unmapped");
  assert.equal(one[0].next.leadId, "a");
});

test("a returning customer: the newest row drives the lead, older rows are unlinked", () => {
  const rows = parseCcSheet([
    ["Lead ID", "Status", "Phone"],
    ["LD-0002", "J. Signed", "0811111111"],
    ["LD-0010", "A. Spam", "0811111111"],
  ])!.rows;
  const plan = planCcSync({ rows, leads: [lead("x", "NEW", { phone: "0811111111" })], links: [], map: { "J. Signed": "WON", "A. Spam": "LOST" } });
  assert.deepEqual(plan.map((p) => p.outcome), ["older", "change"]);
  assert.equal(plan[0].next.leadId, null);
  assert.equal(plan[1].next.leadId, "x");
  assert.equal(plan[1].target, "LOST");
});

test("two rows with the same Lead ID on one lead stay duplicate and unlinked", () => {
  const rows = parseCcSheet([
    ["Lead ID", "Status", "Phone"],
    ["LD-1", "J. Signed", "0811111111"],
    ["LD-1", "A. Spam", "0811111111"],
  ])!.rows;
  const plan = planCcSync({ rows, leads: [lead("x", "NEW", { phone: "0811111111" })], links: [], map: { "J. Signed": "WON", "A. Spam": "LOST" } });
  assert.deepEqual(plan.map((p) => p.outcome), ["duplicate", "duplicate"]);
  assert.ok(plan.every((p) => p.next.leadId === null));
});

test("an applied status is not re-applied; a sheet change is", () => {
  const rows = parseCcSheet([["Lead ID", "Status"], ["LD-1", "D. Potential lead"]])!.rows;
  const link: LinkLite = { sheetLeadId: "LD-1", leadId: "x", matchedBy: "phone", sheetStatus: "D. Potential lead", appliedStatus: "QUALIFIED", note: null };
  const map = { "D. Potential lead": "QUALIFIED", "J. Signed": "WON" } as const;
  // Staff moved the lead to QUOTED in MarsOS; the sheet still says Potential → kept, no write.
  const kept = planCcSync({ rows, leads: [lead("x", "QUOTED")], links: [link], map: { ...map } });
  assert.equal(kept[0].outcome, "kept");
  assert.equal(kept[0].dirty, false);
  // Sheet moves to Signed → applied.
  const signed = planCcSync({ rows: [{ ...rows[0], status: "J. Signed" }], leads: [lead("x", "QUOTED")], links: [link], map: { ...map } });
  assert.equal(signed[0].outcome, "change");
  assert.equal(signed[0].target, "WON");
  assert.equal(signed[0].matchedBy, "phone");
});

test("changes per run are capped; the rest wait", () => {
  const rows = parseCcSheet([["Lead ID", "Status", "Phone"], ["LD-1", "S", "0811111111"], ["LD-2", "S", "0822222222"]])!.rows;
  const leads = [lead("a", "NEW", { phone: "0811111111" }), lead("b", "NEW", { phone: "0822222222" })];
  const plan = planCcSync({ rows, leads, links: [], map: { S: "WON" }, maxChanges: 1 });
  assert.deepEqual(plan.map((p) => p.outcome), ["change", "deferred"]);
  assert.equal(plan[1].next.appliedStatus, null);
});
