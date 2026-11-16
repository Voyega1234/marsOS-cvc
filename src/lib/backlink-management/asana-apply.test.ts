/** Run: npx tsx src/lib/backlink-management/asana-apply.test.ts */
import assert from "node:assert/strict";
import { decideAsanaApply } from "./asana-apply";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

t("APPROVED + completed + liveUrl -> PUBLISHED", () => {
  const d = decideAsanaApply({ status: "APPROVED", liveUrl: "https://a.com/x", asanaCompleted: false, taskCompleted: true });
  assert.equal(d.nextStatus, "PUBLISHED");
  assert.equal(d.asanaCompleted, true);
  assert.equal(d.note, "ปิดงานใน Asana แล้ว");
});
t("IN_PROGRESS + completed + liveUrl -> PUBLISHED", () => {
  const d = decideAsanaApply({ status: "IN_PROGRESS", liveUrl: "https://a.com/x", asanaCompleted: false, taskCompleted: true });
  assert.equal(d.nextStatus, "PUBLISHED");
});
t("APPROVED + completed + empty liveUrl -> PUBLISHED with warning note", () => {
  const d = decideAsanaApply({ status: "APPROVED", liveUrl: "", asanaCompleted: false, taskCompleted: true });
  assert.equal(d.nextStatus, "PUBLISHED");
  assert.equal(d.note, "ปิดงานใน Asana แล้ว — ยังไม่ได้ใส่ลิงก์ที่เผยแพร่");
});
t("IN_PROGRESS + completed + null/whitespace liveUrl -> warning note", () => {
  assert.equal(decideAsanaApply({ status: "IN_PROGRESS", liveUrl: null, asanaCompleted: false, taskCompleted: true }).note, "ปิดงานใน Asana แล้ว — ยังไม่ได้ใส่ลิงก์ที่เผยแพร่");
  assert.equal(decideAsanaApply({ status: "IN_PROGRESS", liveUrl: "  ", asanaCompleted: false, taskCompleted: true }).nextStatus, "PUBLISHED");
});
t("REQUESTED + completed -> no status change", () => {
  const d = decideAsanaApply({ status: "REQUESTED", liveUrl: "https://a.com", asanaCompleted: false, taskCompleted: true });
  assert.equal(d.nextStatus, null);
  assert.equal(d.asanaCompleted, true);
});
t("other statuses + completed -> no status change", () => {
  for (const status of ["PUBLISHED", "VERIFIED", "LOST", "REJECTED", "CANCELLED"]) {
    const d = decideAsanaApply({ status, liveUrl: "https://a.com", asanaCompleted: false, taskCompleted: true });
    assert.equal(d.nextStatus, null, status);
    assert.equal(d.asanaCompleted, true, status);
  }
});
t("re-opened task -> asanaCompleted false, no status change", () => {
  for (const status of ["APPROVED", "IN_PROGRESS", "PUBLISHED", "REQUESTED"]) {
    const d = decideAsanaApply({ status, liveUrl: "https://a.com", asanaCompleted: true, taskCompleted: false });
    assert.equal(d.nextStatus, null, status);
    assert.equal(d.asanaCompleted, false, status);
  }
});
t("already-completed flag stays true when task still completed", () => {
  const d = decideAsanaApply({ status: "VERIFIED", liveUrl: "", asanaCompleted: true, taskCompleted: true });
  assert.equal(d.asanaCompleted, true);
  assert.equal(d.nextStatus, null);
});

console.log(`\n${n} passed`);
