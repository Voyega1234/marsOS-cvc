/** Run: npx tsx src/lib/backlink-management/link-check.test.ts */
import assert from "node:assert/strict";
import { analyzeHtml } from "./link-check";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }
const PAGE = "https://blog.example.com/post/1";
const TARGET = "https://www.client.com/product/a";

t("exact match double quotes", () => {
  const r = analyzeHtml(`<p><a class="x" href="https://client.com/product/a">ซื้อเลย</a></p>`, PAGE, TARGET);
  assert.equal(r.match, "EXACT"); assert.equal(r.nofollow, false); assert.equal(r.anchorText, "ซื้อเลย");
});
t("single quote + unquoted", () => {
  assert.equal(analyzeHtml(`<a href='https://client.com/product/a'>x</a>`, PAGE, TARGET).match, "EXACT");
  assert.equal(analyzeHtml(`<a href=https://client.com/product/a>x</a>`, PAGE, TARGET).match, "EXACT");
});
t("normalisation www/protocol/trailing slash/hash", () => {
  assert.equal(analyzeHtml(`<a href="http://WWW.Client.com/product/a/#top">x</a>`, PAGE, TARGET).match, "EXACT");
});
t("query is kept", () => {
  assert.equal(analyzeHtml(`<a href="https://client.com/product/a?x=1">x</a>`, PAGE, TARGET).match, "DOMAIN");
});
t("domain only", () => {
  assert.equal(analyzeHtml(`<a href="https://client.com/other">x</a>`, PAGE, TARGET).match, "DOMAIN");
});
t("none", () => {
  assert.equal(analyzeHtml(`<a href="https://other.com/product/a">x</a>`, PAGE, TARGET).match, "NONE");
  assert.equal(analyzeHtml(`<p>no links</p>`, PAGE, TARGET).match, "NONE");
});
t("exact wins over domain", () => {
  const r = analyzeHtml(`<a href="https://client.com/x">a</a><a href="https://client.com/product/a">b</a>`, PAGE, TARGET);
  assert.equal(r.match, "EXACT"); assert.equal(r.anchorText, "b");
});
t("nofollow / sponsored / ugc", () => {
  for (const rel of ["nofollow", "sponsored", "ugc", "noopener nofollow"]) {
    const r = analyzeHtml(`<a rel="${rel}" href="https://client.com/product/a">x</a>`, PAGE, TARGET);
    assert.equal(r.nofollow, true, rel);
  }
  assert.equal(analyzeHtml(`<a rel="noopener" href="https://client.com/product/a">x</a>`, PAGE, TARGET).nofollow, false);
});
t("relative href resolved against page", () => {
  const r = analyzeHtml(`<a href="/product/a">x</a>`, "https://www.client.com/blog/1", TARGET);
  assert.equal(r.match, "EXACT");
});
t("meta robots", () => {
  const r = analyzeHtml(`<meta name="robots" content="noindex, nofollow"><a href="https://client.com/product/a">x</a>`, PAGE, TARGET);
  assert.equal(r.pageNoindex, true); assert.equal(r.pageNofollow, true);
  const r2 = analyzeHtml(`<meta name="robots" content="index,follow"><a href="https://client.com/product/a">x</a>`, PAGE, TARGET);
  assert.equal(r2.pageNoindex, false); assert.equal(r2.pageNofollow, false);
});
console.log(`${n} passed`);
