/** Run: npx tsx src/lib/backlink-management/project-name.test.ts */
import assert from "node:assert/strict";
import { cleanProjectName } from "./project-name";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

t("non-string -> empty", () => {
  assert.equal(cleanProjectName(undefined), "");
  assert.equal(cleanProjectName(null), "");
  assert.equal(cleanProjectName(123), "");
});
t("trim and collapse whitespace", () => {
  assert.equal(cleanProjectName("  ร้าน   กาแฟ \n สด  "), "ร้าน กาแฟ สด");
});
t("cut to 120 chars", () => {
  assert.equal(cleanProjectName("a".repeat(200)).length, 120);
});
t("blank -> empty", () => { assert.equal(cleanProjectName("   "), ""); });

console.log(`${n} passed`);
