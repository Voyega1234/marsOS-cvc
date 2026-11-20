import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_LOGO_MAX_CHARS, logoFromConfig, parseProjectLogo } from "./projectLogo";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("png, jpeg and webp data URIs are accepted", () => {
  assert.deepEqual(parseProjectLogo(PNG), { ok: true, dataUri: PNG });
  assert.equal(parseProjectLogo("data:image/jpeg;base64,AAAA").ok, true);
  assert.equal(parseProjectLogo("data:image/webp;base64,AAAA").ok, true);
});

test("svg, links and junk are refused", () => {
  for (const bad of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "https://example.com/logo.png",
    "data:image/png;base64,<script>",
    "data:text/html;base64,AAAA",
    "",
    null,
    42,
  ]) {
    assert.deepEqual(parseProjectLogo(bad), { ok: false, code: "invalid" }, String(bad));
  }
});

test("an over-long data URI is refused", () => {
  const big = `data:image/png;base64,${"A".repeat(PROJECT_LOGO_MAX_CHARS)}`;
  assert.deepEqual(parseProjectLogo(big), { ok: false, code: "too_big" });
});

test("the stored row is read back, and anything odd reads as no logo", () => {
  assert.equal(logoFromConfig(JSON.stringify({ dataUri: PNG })), PNG);
  assert.equal(logoFromConfig(null), null);
  assert.equal(logoFromConfig("not json"), null);
  assert.equal(logoFromConfig(JSON.stringify({ dataUri: "javascript:alert(1)" })), null);
});
