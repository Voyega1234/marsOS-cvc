import { test } from "node:test";
import assert from "node:assert/strict";
import { isLineTrackingPublicPath as pub } from "./publicPaths";

test("visitor links, webhook, tracking and scheduler paths are public", () => {
  assert.equal(pub("/api/webhooks/line/abc123", "POST"), true);
  assert.equal(pub("/api/webhooks/line/abc123", "GET"), true);
  assert.equal(pub("/api/track/my-shop", "POST"), true);
  assert.equal(pub("/api/track/my-shop", "OPTIONS"), true);
  assert.equal(pub("/api/liff/my-shop", "GET"), true);
  assert.equal(pub("/api/liff/my-shop", "POST"), true);
  assert.equal(pub("/api/conversions/process", "GET"), true);
  assert.equal(pub("/api/conversions/convertcake-sheet", "POST"), true);
  assert.equal(pub("/api/line-tracking/looker/summary", "GET"), true);
  assert.equal(pub("/api/line-tracking/looker/leads", "GET"), true);
  assert.equal(pub("/api/line-tracking/looker/conversions", "GET"), true);
  assert.equal(pub("/go/my-shop", "GET"), true);
  assert.equal(pub("/s/Ab12Cd", "GET"), true);
  assert.equal(pub("/t/my-shop", "GET"), true);
  assert.equal(pub("/liff/my-shop", "GET"), true);
  assert.equal(pub("/line/start", "GET"), true);
  assert.equal(pub("/line/success", "GET"), true);
  assert.equal(pub("/line/callback", "GET"), true);
  assert.equal(pub("/embed.js", "GET"), true);
});

test("staff pages and the rest of the module API stay behind the login", () => {
  assert.equal(pub("/line-tracking", "GET"), false);
  assert.equal(pub("/line-tracking/projects/abc", "GET"), false);
  assert.equal(pub("/line-tracking/projects/abc/leads", "GET"), false);
  assert.equal(pub("/api/line-tracking", "GET"), false);
  assert.equal(pub("/api/line-tracking/looker", "GET"), false);
  assert.equal(pub("/api/line-tracking/looker/other", "GET"), false);
  assert.equal(pub("/api/line-tracking/looker/summary/extra", "GET"), false);
  assert.equal(pub("/api/conversions", "GET"), false);
  assert.equal(pub("/api/conversions/other", "GET"), false);
  assert.equal(pub("/api/conversions/process/extra", "GET"), false);
  assert.equal(pub("/line", "GET"), false);
  assert.equal(pub("/line/callback/mock", "GET"), false);
  assert.equal(pub("/line/other", "GET"), false);
});

test("a path is public only for the methods it needs", () => {
  assert.equal(pub("/api/track/my-shop", "GET"), false);
  assert.equal(pub("/api/track/my-shop", "DELETE"), false);
  assert.equal(pub("/api/webhooks/line/abc123", "PUT"), false);
  assert.equal(pub("/api/line-tracking/looker/summary", "POST"), false);
  assert.equal(pub("/go/my-shop", "POST"), false);
  assert.equal(pub("/line/start", "POST"), false);
});

test("other parts of MarsOS are not opened by these rules", () => {
  assert.equal(pub("/", "GET"), false);
  assert.equal(pub("/api/webhooks/slack", "POST"), false);
  assert.equal(pub("/api/webhooks/line", "POST"), false);
  assert.equal(pub("/api/webhooks/line/a/b", "POST"), false);
  assert.equal(pub("/api/projects", "GET"), false);
  assert.equal(pub("/settings/ai-cost", "GET"), false);
  assert.equal(pub("/t", "GET"), false);
  assert.equal(pub("/s/a/b", "GET"), false);
  assert.equal(pub("/goods/x", "GET"), false);
  assert.equal(pub("/embed.js/x", "GET"), false);
  assert.equal(pub("/embedXjs", "GET"), false);
});
