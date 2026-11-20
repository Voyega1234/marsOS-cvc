import assert from "node:assert/strict";
import { test } from "node:test";
import { canRevert, changedByLabel, diffLeadFields, parseLeadContactInput } from "./leadChangeDiff";

const base = { fullName: "Somchai", phone: "0812345678", salesOwner: "Nok", value: 10 };

test("parseLeadContactInput trims and turns empty strings into null", () => {
  const r = parseLeadContactInput({ fullName: "  Somchai  ", phone: "   ", salesOwner: null, value: "12.5" });
  assert.deepEqual(r, { fullName: "Somchai", phone: null, salesOwner: null, value: 12.5 });
});

test("parseLeadContactInput cuts names to 200 and phone to 50 characters", () => {
  const r = parseLeadContactInput({ fullName: "a".repeat(300), phone: "9".repeat(80), salesOwner: "b".repeat(250), value: 0 });
  assert.equal(r.fullName?.length, 200);
  assert.equal(r.phone?.length, 50);
  assert.equal(r.salesOwner?.length, 200);
});

test("parseLeadContactInput: an empty value is 0", () => {
  assert.equal(parseLeadContactInput({ fullName: "", phone: "", salesOwner: "", value: "" }).value, 0);
  assert.equal(parseLeadContactInput({ fullName: "", phone: "", salesOwner: "", value: null }).value, 0);
});

test("parseLeadContactInput rejects NaN, negative, Infinity and too-large values", () => {
  for (const value of ["abc", "-1", "Infinity", "1000000000001", -5]) {
    assert.throws(
      () => parseLeadContactInput({ fullName: "", phone: "", salesOwner: "", value }),
      /มูลค่าไม่ถูกต้อง/,
      String(value),
    );
  }
  assert.equal(parseLeadContactInput({ fullName: "", phone: "", salesOwner: "", value: "1000000000000" }).value, 1_000_000_000_000);
});

test("diffLeadFields: no change gives an empty list", () => {
  assert.deepEqual(diffLeadFields(base, { ...base }), []);
});

test("diffLeadFields reports each changed field", () => {
  assert.deepEqual(diffLeadFields(base, { ...base, fullName: "Somsri" }), [{ field: "fullName", oldValue: "Somchai", newValue: "Somsri" }]);
  assert.deepEqual(diffLeadFields(base, { ...base, phone: null }), [{ field: "phone", oldValue: "0812345678", newValue: null }]);
  assert.deepEqual(diffLeadFields(base, { ...base, salesOwner: "Mali" }), [{ field: "salesOwner", oldValue: "Nok", newValue: "Mali" }]);
  assert.deepEqual(diffLeadFields(base, { ...base, value: 25.5 }), [{ field: "value", oldValue: "10", newValue: "25.5" }]);
  assert.equal(diffLeadFields(base, { fullName: null, phone: null, salesOwner: null, value: 0 }).length, 4);
});

test("diffLeadFields: value 10 vs 10.0 is not a change", () => {
  assert.deepEqual(diffLeadFields(base, { ...base, value: Number("10.0") }), []);
});

test("canRevert is true while the field still holds the logged new value", () => {
  assert.equal(canRevert({ field: "fullName", newValue: "Somchai" }, base), true);
  assert.equal(canRevert({ field: "phone", newValue: "0812345678" }, base), true);
  assert.equal(canRevert({ field: "salesOwner", newValue: null }, { ...base, salesOwner: null }), true);
  assert.equal(canRevert({ field: "value", newValue: "10" }, base), true);
});

test("canRevert is false after a later edit", () => {
  assert.equal(canRevert({ field: "fullName", newValue: "Somchai" }, { ...base, fullName: "Other" }), false);
  assert.equal(canRevert({ field: "value", newValue: "10" }, { ...base, value: 11 }), false);
});

test("canRevert is false for status and unknown fields", () => {
  assert.equal(canRevert({ field: "status", newValue: "NEW" }, base), false);
  assert.equal(canRevert({ field: "id", newValue: "x" }, base), false);
});

test("changedByLabel keeps the staff label and names the client", () => {
  assert.equal(changedByLabel({ type: "staff", name: "a@b.com" }), "Agency Admin (dashboard)");
  assert.equal(changedByLabel({ type: "client", name: "shop1" }), "Client (dashboard): shop1");
});
