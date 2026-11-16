/** Run: npx tsx src/lib/backlink-management/quota-sheets-port.test.ts */
import assert from "node:assert/strict";
import { parseListValidation, uniqueOptions } from "./quota-sheets-port";
import { sheetErrorMessage } from "./sheet-sync";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

t("uniqueOptions trims, drops blanks and duplicates, keeps order", () => {
  assert.deepEqual(uniqueOptions([" Guest Post ", "", "PR", "Guest Post", null, undefined, 5]), ["Guest Post", "PR", "5"]);
});

t("ONE_OF_LIST returns the listed values", () => {
  const r = parseListValidation({ condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "Guest Post" }, { userEnteredValue: "PR" }, { userEnteredValue: "PR" }] }, strict: true }, "2026");
  assert.deepEqual(r, { options: ["Guest Post", "PR"], range: null, strict: true });
});

t("ONE_OF_RANGE without a tab name points at the same tab", () => {
  const r = parseListValidation({ condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "=$M$2:$M$20" }] } }, "Tab's 2026");
  assert.deepEqual(r, { options: [], range: "'Tab''s 2026'!M2:M20", strict: false });
});

t("ONE_OF_RANGE with a tab name keeps it", () => {
  const r = parseListValidation({ condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='Lists'!$A$1:$A$9" }] }, strict: false }, "2026");
  assert.deepEqual(r, { options: [], range: "'Lists'!A1:A9", strict: false });
});

t("no validation or a non-list rule returns null", () => {
  assert.equal(parseListValidation(undefined, "x"), null);
  assert.equal(parseListValidation({ condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "1" }] } }, "x"), null);
  assert.equal(parseListValidation({ condition: { type: "ONE_OF_RANGE", values: [] } }, "x"), null);
});

t("data validation rejection is not reported as a missing sheet", () => {
  const msg = sheetErrorMessage({ code: 400, message: "Invalid value at 'data[0].values' violates the data validation rule" }, "sa@example.com");
  assert.match(msg, /dropdown/);
  assert.equal(sheetErrorMessage({ code: 404, message: "Requested entity was not found." }, "sa@example.com"), "ไม่พบชีทนี้ ตรวจลิงก์อีกครั้ง");
});

console.log(`\n${n} tests passed`);
