import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLineDestination } from "./lineDestination";

test("accepts LINE add-friend and LIFF addresses", () => {
  assert.equal(safeLineDestination("https://lin.ee/abc123"), "https://lin.ee/abc123");
  assert.equal(safeLineDestination("https://line.me/R/ti/p/@shop"), "https://line.me/R/ti/p/@shop");
  assert.equal(safeLineDestination("https://liff.line.me/1234-abcd"), "https://liff.line.me/1234-abcd");
  assert.equal(safeLineDestination("https://page.line.me/shop"), "https://page.line.me/shop");
});

test("rejects other sites, look-alike hosts and unsafe schemes", () => {
  assert.equal(safeLineDestination("https://evil.example/login"), null);
  assert.equal(safeLineDestination("https://line.me.evil.example/"), null);
  assert.equal(safeLineDestination("https://evilline.me/"), null);
  assert.equal(safeLineDestination("https://lin.ee@evil.example/"), null);
  assert.equal(safeLineDestination("http://line.me/R/ti/p/@shop"), null);
  assert.equal(safeLineDestination("javascript:alert(1)"), null);
  assert.equal(safeLineDestination("//evil.example"), null);
  assert.equal(safeLineDestination("/line-tracking"), null);
});

test("empty input gives null", () => {
  assert.equal(safeLineDestination(undefined), null);
  assert.equal(safeLineDestination(""), null);
  assert.equal(safeLineDestination("   "), null);
});
