import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_WEBSITE_MAX, normalizeProjectWebsite, planProjectWebsite } from "./projectWebsite";

test("a full https link is kept as typed, trimmed", () => {
  assert.deepEqual(normalizeProjectWebsite("  https://www.vaanaa.com/th/  "), { ok: true, url: "https://www.vaanaa.com/th/" });
  assert.deepEqual(normalizeProjectWebsite("http://shop.example.co.th"), { ok: true, url: "http://shop.example.co.th" });
});

test("a link without a scheme gets https://", () => {
  assert.deepEqual(normalizeProjectWebsite("www.example.com/en/"), { ok: true, url: "https://www.example.com/en/" });
});

test("an empty link clears the field", () => {
  assert.deepEqual(normalizeProjectWebsite("   "), { ok: true, url: null });
  assert.deepEqual(normalizeProjectWebsite(null), { ok: true, url: null });
});

test("things that are not a website are refused", () => {
  for (const bad of ["javascript:alert(1)", "ftp://example.com", "https://localhost", "vaanaa", "https://a b.com", "https://user:pw@example.com"]) {
    assert.deepEqual(normalizeProjectWebsite(bad), { ok: false, code: "invalid" }, bad);
  }
});

test("an over-long link is refused", () => {
  assert.deepEqual(normalizeProjectWebsite(`https://example.com/${"a".repeat(PROJECT_WEBSITE_MAX)}`), { ok: false, code: "too_long" });
});

test("the same link (after normalizing) changes nothing", () => {
  assert.deepEqual(planProjectWebsite("https://example.com", " https://example.com "), { kind: "unchanged" });
  assert.deepEqual(planProjectWebsite(null, ""), { kind: "unchanged" });
});

test("a new or cleared link is a change", () => {
  assert.deepEqual(planProjectWebsite("https://old.com", "new.com"), { kind: "set", url: "https://new.com" });
  assert.deepEqual(planProjectWebsite("https://old.com", ""), { kind: "set", url: null });
  assert.deepEqual(planProjectWebsite("https://old.com", "nope"), { kind: "error", code: "invalid" });
});
