import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomHeaders,
  buildCustomPayload,
  sendCustomWebhook,
  validateDestination,
  SIGNATURE_HEADER,
} from "./customWebhookSender";
import { PLATFORMS, PLATFORM_BY_ID, PLATFORM_DATA_SENT, PLATFORM_STANDARD_EVENTS, defaultPlatformsForStatus, fillMissingPlatforms } from "../platforms";
import { CONNECTION_TYPES } from "../enums";
import { CONNECTOR_META } from "../connectors";
import type { PlatformsConfig } from "../platforms";
import type { SendContext } from "./senderTypes";

function ctx(): SendContext {
  const created = new Date("2026-11-01T10:00:00.000Z");
  return {
    lead: {
      id: "lead1", status: "QUALIFIED", lineUserId: "Uline1", clickId: "clk1",
      source: "google", campaign: "camp", keyword: "kw", channel: "ads", channelGroup: "paid",
      gclid: "G1", fbclid: "F1", ttclid: "T1", msclkid: "M1", twclid: "X1", scclid: "S1",
      gaClientId: "111.222", purchaseId: null, createdAt: created,
    } as unknown as SendContext["lead"],
    eventName: "lead_qualified", value: 100, currency: "THB", projectId: "p1", projectName: "Proj",
    click: {
      gaClientId: "333.444", gaSessions: { ABC: "1700000000" }, fbp: "fbp1", fbc: "fb.1.1.F1", ttp: "ttp1",
      gbraid: "GB1", wbraid: "WB1", lineClickId: "lc1", lineBrowserId: "lb1", scid: "sc1",
      clickedAt: new Date("2026-11-01T09:00:00.000Z"), userAgent: "UA", landingUrl: "https://x.test/", referrer: "https://r.test/",
    },
  };
}

test("destination must be https", () => {
  assert.equal(validateDestination("http://api.example.com/x").ok, false);
  assert.equal(validateDestination("ftp://api.example.com/x").ok, false);
  assert.equal(validateDestination("nope").ok, false);
  assert.equal(validateDestination("https://api.example.com/x").ok, true);
});

test("internal destination hosts are rejected", () => {
  for (const u of [
    "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.1/x",
    "https://169.254.169.254/latest", "https://172.20.0.1/x", "https://[::1]/x", "https://db.internal/x", "https://printer.local/x",
  ]) {
    assert.equal(validateDestination(u).ok, false, u);
  }
});

test("send returns an error and never calls out for an http destination", async () => {
  const r = await sendCustomWebhook({ destinationUrl: "http://api.example.com/x" }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.mock, false);
  assert.match(String(r.error), /https/);
});

test("send with no destination stays in mock mode", async () => {
  const r = await sendCustomWebhook({}, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.mock, true);
});

test("payload carries every stored id", () => {
  const p = buildCustomPayload({}, ctx());
  assert.equal(p.event, "lead_qualified");
  assert.deepEqual(p.project, { id: "p1", name: "Proj" });
  const l = p.lead;
  assert.equal(l.line_user_id, "Uline1");
  assert.equal(l.click_id, "clk1");
  assert.equal(l.gclid, "G1");
  assert.equal(l.fbclid, "F1");
  assert.equal(l.ttclid, "T1");
  assert.equal(l.msclkid, "M1");
  assert.equal(l.twclid, "X1");
  assert.equal(l.scclid, "S1");
  assert.equal(l.ga_client_id, "111.222"); // lead value wins over click value
  assert.equal(l.gbraid, "GB1");
  assert.equal(l.wbraid, "WB1");
  assert.equal(l.fbp, "fbp1");
  assert.equal(l.fbc, "fb.1.1.F1");
  assert.equal(l.ttp, "ttp1");
  assert.equal(l.line_click_id, "lc1");
  assert.equal(l.line_browser_id, "lb1");
  assert.equal(l.scid, "sc1");
  assert.deepEqual(l.ga_sessions, { ABC: "1700000000" });
  assert.equal(l.landing_url, "https://x.test/");
  assert.equal(l.referrer, "https://r.test/");
  assert.equal(l.user_agent, "UA");
  assert.deepEqual(l.clicked_at, new Date("2026-11-01T09:00:00.000Z"));
  assert.equal(p.value, 100);
  assert.equal(p.currency, "THB");
  assert.equal(p.order_id, "lead1");
});

test("payload falls back to nulls when the lead has no click and no LINE user", () => {
  const c = ctx();
  c.click = undefined;
  (c.lead as unknown as { lineUserId: string | null }).lineUserId = null;
  const l = buildCustomPayload({}, c).lead;
  assert.equal(l.line_user_id, null);
  assert.equal(l.gbraid, null);
  assert.equal(l.clicked_at, null);
});

test("configured headers can never override host / content-type / content-length / signature", () => {
  const headersJson = JSON.stringify({
    Host: "evil.test",
    "Content-Type": "text/plain",
    "CONTENT-LENGTH": "1",
    "X-MarsOS-Signature": "forged",
    Authorization: "Bearer abc",
  });
  const h = buildCustomHeaders({ headersJson, signingSecret: "s3cret" }, "{}");
  assert.equal(h["content-type"], "application/json");
  assert.equal(h["Authorization"], "Bearer abc");
  for (const k of Object.keys(h)) {
    assert.ok(!/^(host|content-length)$/i.test(k), k);
    assert.ok(!/^x-marsos-signature$/i.test(k) || k === SIGNATURE_HEADER, k);
    assert.ok(!/^content-type$/i.test(k) || k === "content-type", k);
  }
  assert.notEqual(h[SIGNATURE_HEADER], "forged");
});

test("forged signature header is dropped when there is no secret", () => {
  const h = buildCustomHeaders({ headersJson: JSON.stringify({ "x-marsos-signature": "forged" }) }, "{}");
  assert.equal(h[SIGNATURE_HEADER], undefined);
});

test("signature header is present with a secret and is the HMAC of the body", async () => {
  const { createHmac } = await import("crypto");
  const body = '{"a":1}';
  const h = buildCustomHeaders({ signingSecret: "s3cret" }, body);
  assert.equal(SIGNATURE_HEADER, "x-marsos-signature");
  assert.equal(h[SIGNATURE_HEADER], createHmac("sha256", "s3cret").update(body).digest("hex"));
  assert.equal(buildCustomHeaders({}, body)[SIGNATURE_HEADER], undefined);
});

test("malformed headersJson is ignored", () => {
  assert.deepEqual(buildCustomHeaders({ headersJson: "{not json" }, "{}"), { "content-type": "application/json" });
});

test("google_ads and custom are registered and wired to connectors", () => {
  assert.equal(PLATFORM_BY_ID["google_ads"]?.connectionType, "GOOGLE_ADS");
  assert.equal(PLATFORM_BY_ID["custom"]?.connectionType, "CUSTOM_WEBHOOK");
  for (const t of ["GOOGLE_ADS", "CUSTOM_WEBHOOK"] as const) {
    assert.ok(CONNECTION_TYPES.includes(t));
    assert.ok(CONNECTOR_META[t]);
  }
  for (const p of PLATFORMS) {
    assert.ok(PLATFORM_DATA_SENT[p.id], p.id);
    assert.ok(PLATFORM_STANDARD_EVENTS[p.id], p.id);
  }
  // Neither new platform bypasses the rules through the block-event path.
  assert.equal(PLATFORM_BY_ID["google_ads"].blockEvent, undefined);
  assert.equal(PLATFORM_BY_ID["custom"].blockEvent, undefined);
});

test("new project defaults: google_ads on for QUALIFIED/WON/PAID only, custom on for the funnel", () => {
  assert.equal(defaultPlatformsForStatus("NEW")["google_ads"].enabled, false);
  assert.equal(defaultPlatformsForStatus("QUALIFIED")["google_ads"].enabled, true);
  assert.equal(defaultPlatformsForStatus("PAID")["google_ads"].enabled, true);
  assert.equal(defaultPlatformsForStatus("NEW")["custom"].enabled, true);
});

test("a stored rule without google_ads / custom resolves them OFF", () => {
  for (const status of ["NEW", "QUALIFIED", "WON", "PAID"] as const) {
    const stored: PlatformsConfig = { meta: { enabled: true, eventName: "Lead" } };
    const added = fillMissingPlatforms(stored, defaultPlatformsForStatus(status));
    assert.ok(added.includes("google_ads") && added.includes("custom"));
    assert.equal(stored["google_ads"].enabled, false, status);
    assert.equal(stored["custom"].enabled, false, status);
    assert.equal(stored["meta"].enabled, true); // untouched
  }
});

test("fillMissingPlatforms never changes an existing entry", () => {
  const stored: PlatformsConfig = { custom: { enabled: true, eventName: "mine" } };
  fillMissingPlatforms(stored, defaultPlatformsForStatus("WON"));
  assert.deepEqual(stored["custom"], { enabled: true, eventName: "mine" });
});
