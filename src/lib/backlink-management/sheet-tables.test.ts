/** Run: npx tsx src/lib/backlink-management/sheet-tables.test.ts */
import assert from "node:assert/strict";
import { buildSheetTables, parseSpreadsheetId, type SheetRequestInput, type SheetVendorInput } from "./sheet-tables";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
function req(o: Partial<SheetRequestInput> & { projectId?: string } = {}): SheetRequestInput & { projectId: string } {
  return {
    id: "r1", createdAt: new Date("2026-11-01T00:30:00Z"), projectName: "P1", clientName: "C1", budgetPeriod: "2026-11",
    status: "REQUESTED", vendorDomain: "a.com", targetUrl: "https://x.com", anchorText: "", keyword: "", linkType: "dofollow",
    quotedPrice: 1000, actualPrice: null, requestedByName: "u", assigneeName: "", dueDate: new Date("2026-11-20T12:00:00Z"),
    liveUrl: "", publishedAt: null, checkStatus: "", lastCheckedAt: null, foundRel: "", rejectReason: "", notes: "",
    asanaTaskUrl: "", updatedAt: new Date("2026-11-01T00:30:00Z"), projectId: "p1", ...o,
  } as SheetRequestInput & { projectId: string };
}
function ven(o: Partial<SheetVendorInput> = {}): SheetVendorInput {
  return {
    domain: "b.com", siteUrl: "", category: "", price: 500, currency: "THB", domainRating: 30, traffic: null, linkType: "dofollow",
    contactName: "", contactChannel: "", notes: "", status: "ACTIVE", updatedAt: new Date("2026-11-01T00:00:00Z"), ...o,
  };
}

t("parseSpreadsheetId", () => {
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit`), ID);
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`), ID);
  assert.equal(parseSpreadsheetId(ID), ID);
  assert.equal(parseSpreadsheetId(`https://evil.com/spreadsheets/d/${ID}/edit`), "");
  assert.equal(parseSpreadsheetId("hello world"), "");
  assert.equal(parseSpreadsheetId(123), "");
  assert.equal(parseSpreadsheetId(null), "");
});
t("row length equals header length", () => {
  const tabs = buildSheetTables({
    requests: [req(), req({ id: "r2" })], vendors: [ven()],
    budgets: [{ projectId: "p1", projectName: "P1", clientName: "C1", period: "2026-11", approvedAmount: 5000, note: "" }],
  });
  assert.equal(tabs.length, 3);
  for (const tb of tabs) for (const r of tb.rows) assert.equal(r.length, tb.header.length);
});
t("Thai status label, bangkok time, due date", () => {
  const [r] = buildSheetTables({ requests: [req()], vendors: [], budgets: [] });
  const row = r.rows[0];
  assert.equal(row[5], "รออนุมัติ");
  assert.equal(row[1], "2026-11-01 07:30");
  assert.equal(row[15], "2026-11-20");
});
t("numbers stay numbers, null price empty", () => {
  const [r] = buildSheetTables({ requests: [req({ quotedPrice: 1234.5, actualPrice: null })], vendors: [], budgets: [] });
  assert.equal(r.rows[0][11], 1234.5);
  assert.equal(r.rows[0][12], "");
});
t("formula-like string passes through", () => {
  const [r] = buildSheetTables({ requests: [req({ notes: "=SUM(A1)" })], vendors: [], budgets: [] });
  assert.equal(r.rows[0][22], "=SUM(A1)");
});
t("cut at 5000", () => {
  const [r] = buildSheetTables({ requests: [req({ notes: "x".repeat(6000) })], vendors: [], budgets: [] });
  assert.equal((r.rows[0][22] as string).length, 5000);
});
t("sort order", () => {
  const [r, v, b] = buildSheetTables({
    requests: [req({ id: "old", createdAt: new Date("2026-01-01T00:00:00Z") }), req({ id: "new", createdAt: new Date("2026-06-01T00:00:00Z") })],
    vendors: [ven({ domain: "z.com" }), ven({ domain: "a.com" })],
    budgets: [
      { projectId: "p1", projectName: "B", clientName: "", period: "2026-10", approvedAmount: 1, note: "" },
      { projectId: "p2", projectName: "A", clientName: "", period: "2026-12", approvedAmount: 1, note: "" },
    ],
  });
  assert.deepEqual(r.rows.map((x) => x[0]), ["new", "old"]);
  assert.deepEqual(v.rows.map((x) => x[0]), ["a.com", "z.com"]);
  assert.equal(b.rows[0][0], "2026-12");
});
t("budget row for project with requests but no budget row", () => {
  const [, , b] = buildSheetTables({ requests: [req({ status: "APPROVED", quotedPrice: 700 })], vendors: [], budgets: [] });
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0][1], "P1");
  assert.equal(b.rows[0][3], 0);
  assert.equal(b.rows[0][5], 700);
  assert.equal(b.rows[0][7], -700);
});
console.log(`${n} passed`);
