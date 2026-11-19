// Run: npx tsx src/lib/brand-radar/highlight.test.ts
import assert from "node:assert/strict";
import { splitByTerms, brandTermsOf } from "./highlight";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
}
const hits = (t: string, terms: string[]) => splitByTerms(t, terms).filter((s) => s.hit).map((s) => s.text);
const joined = (t: string, terms: string[]) => splitByTerms(t, terms).map((s) => s.text).join("");

test("Thai term inside Thai text", () => {
  assert.deepEqual(hits("ร้านแนะนำคือมาร์สคลินิกใกล้บ้าน", ["มาร์สคลินิก"]), ["มาร์สคลินิก"]);
});
test("Latin term is case-insensitive and keeps original case", () => {
  assert.deepEqual(hits("Try MARS Clinic today", ["mars clinic"]), ["MARS Clinic"]);
});
test("Latin term is not matched inside a longer word", () => {
  assert.deepEqual(hits("a space with ace and Ace2", ["ace"]), ["ace"]);
});
test("longest term wins on overlap", () => {
  const segs = splitByTerms("see Mars Clinic Asia now", ["Mars", "Mars Clinic", "Mars Clinic Asia"]);
  assert.deepEqual(segs.filter((s) => s.hit).map((s) => s.text), ["Mars Clinic Asia"]);
});
test("regex metacharacters are literal", () => {
  assert.deepEqual(hits("we like C++ and AxB and A.B", ["C++", "A.B"]), ["C++", "A.B"]);
});
test("empty, blank and 1-character terms are ignored", () => {
  assert.deepEqual(splitByTerms("hello", []), [{ text: "hello", hit: false }]);
  assert.deepEqual(splitByTerms("a b c", ["", " ", "a"]), [{ text: "a b c", hit: false }]);
});
test("script text stays plain text in one segment", () => {
  const t = "<script>alert(1)</script>";
  assert.deepEqual(splitByTerms(t, ["brand"]), [{ text: t, hit: false }]);
});
test("joined segments equal the input", () => {
  const t = "Mars is great. มาร์ส ดี. mars again, MARS!";
  assert.equal(joined(t, ["mars", "มาร์ส"]), t);
  assert.equal(joined("", ["mars"]), "");
});
test("brandTermsOf merges, dedupes and sorts longest first", () => {
  assert.deepEqual(brandTermsOf("Mars", ["mars", "Mars Clinic", "x"]), ["Mars Clinic", "Mars"]);
});

if (failed > 0) { console.error(`${failed} test(s) failed`); process.exit(1); }
console.log("all passed");
