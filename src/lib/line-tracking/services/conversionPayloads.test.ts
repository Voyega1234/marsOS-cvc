import { test } from "node:test";
import assert from "node:assert/strict";
import type { Lead } from "@prisma/client";
import { buildGa4Payload } from "./ga4Service";
import { buildMetaPayload } from "./metaAdsService";
import { buildTiktokPayload } from "./tiktokAdsService";
import { buildLineAdsPayload, lineDedupKey, lineEventName, sendLineAds } from "./lineAdsService";
import { buildMicrosoftPayload, cleanMsclkid, sendMicrosoft } from "./microsoftAdsService";
import { buildXPayload, sendX } from "./xAdsService";
import { buildSnapchatPayload, sendSnapchat } from "./snapchatAdsService";
import { buildGoogleAdsPayload } from "./googleAdsService";
import type { ClickSignals, SendContext } from "./senderTypes";

const CREATED = new Date("2026-11-20T03:00:00.000Z");

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "lead1",
    projectId: "proj1",
    lineUserId: "Uabc",
    clickId: "clk_1",
    gaClientId: null,
    fbclid: null,
    ttclid: null,
    source: "google",
    campaign: "brand",
    keyword: null,
    phone: null,
    purchaseId: null,
    createdAt: CREATED,
    ...over,
  } as unknown as Lead;
}

function ctx(leadOver: Partial<Lead> = {}, click?: ClickSignals, eventName = "generate_lead"): SendContext {
  return { lead: lead(leadOver), eventName, value: 100, currency: "THB", projectId: "proj1", projectName: "Test", click };
}

type Ga4 = { client_id: string; user_id?: string; events: { name: string; params: Record<string, unknown> }[] };
const ga4 = (c: SendContext, measurementId?: string, now?: Date) => buildGa4Payload(c, measurementId, now) as Ga4;

/** Runs `fn` with global fetch stubbed (200 + {}), returns the captured requests, restores fetch. */
async function captureFetch(
  fn: () => Promise<unknown>,
  onCall?: () => void
): Promise<{ url: string; headers: Record<string, string>; body: string }[]> {
  const original = globalThis.fetch;
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
    onCall?.();
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

// ---- GA4 -------------------------------------------------------------------

test("GA4: no click signals gives the payload the system sent before", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildGa4Payload(ctx(), "G-ABC123"))), {
    client_id: "lead.lead1",
    user_id: "Uabc",
    events: [
      {
        name: "generate_lead",
        params: { currency: "THB", value: 100, project_id: "proj1", lead_id: "lead1", source: "google", campaign: "brand" },
      },
    ],
  });
});

test("GA4: client id from the click wins over the copy on the lead", () => {
  assert.equal(ga4(ctx({ gaClientId: "1.1" }), "G-ABC123").client_id, "1.1");
  assert.equal(ga4(ctx({ gaClientId: "1.1" }, { gaClientId: "2.2" }), "G-ABC123").client_id, "2.2");
  assert.equal(ga4(ctx({}, { gaClientId: "2.2" }), "G-ABC123").client_id, "2.2");
});

test("GA4: session id of this stream is sent, with engagement time, inside 24 hours", () => {
  const start = 1_795_000_000;
  const click: ClickSignals = { gaClientId: "2.2", gaSessions: { ABC123: String(start), OTHER9: "1795000111" } };
  const params = ga4(ctx({}, click), "G-ABC123", new Date((start + 600) * 1000)).events[0].params;
  assert.equal(params.session_id, String(start));
  assert.equal(params.engagement_time_msec, 1);
});

test("GA4: no session id after 24 hours, for another stream, or without a measurement id", () => {
  const start = 1_795_000_000;
  const click: ClickSignals = { gaClientId: "2.2", gaSessions: { ABC123: String(start) } };
  const soon = new Date((start + 600) * 1000);
  const late = new Date((start + 25 * 3600) * 1000);
  for (const params of [
    ga4(ctx({}, click), "G-ABC123", late).events[0].params,
    ga4(ctx({}, click), "G-ZZZ999", soon).events[0].params,
    ga4(ctx({}, click), undefined, soon).events[0].params,
  ]) {
    assert.equal("session_id" in params, false);
    assert.equal("engagement_time_msec" in params, false);
  }
});

test("GA4: purchase keeps its transaction id", () => {
  assert.equal(ga4(ctx({ purchaseId: "INV-9" }, undefined, "purchase"), "G-ABC123").events[0].params.transaction_id, "INV-9");
});

// ---- Meta ------------------------------------------------------------------

type MetaEvent = {
  event_source_url?: string;
  user_data: { fbc?: string; fbp?: string; client_user_agent?: string; external_id?: string[]; ph?: string[] };
};
const meta = (c: SendContext) => (buildMetaPayload({ pixelId: "1" }, c).data[0] as MetaEvent);

test("Meta: fbc carries the click time in milliseconds", () => {
  assert.equal(meta(ctx({ fbclid: "IwAR0abcdefgh" })).user_data.fbc, `fb.1.${CREATED.getTime()}.IwAR0abcdefgh`);
  const clickedAt = new Date("2026-11-19T10:00:00.000Z");
  assert.equal(
    meta(ctx({ fbclid: "IwAR0abcdefgh" }, { clickedAt })).user_data.fbc,
    `fb.1.${clickedAt.getTime()}.IwAR0abcdefgh`
  );
});

test("Meta: the _fbc cookie is used when it is the same click, or the lead has none", () => {
  const cookie = "fb.1.1795000000000.IwAR0abcdefgh";
  assert.equal(meta(ctx({ fbclid: "IwAR0abcdefgh" }, { fbc: cookie })).user_data.fbc, cookie);
  assert.equal(meta(ctx({}, { fbc: cookie })).user_data.fbc, cookie);
  assert.equal(meta(ctx()).user_data.fbc, undefined);
});

test("Meta: fbp, user agent and page url come from the click", () => {
  const e = meta(
    ctx({}, { fbp: "fb.1.1795000000000.123456", userAgent: "Mozilla/5.0", landingUrl: "https://shop.example/p?utm_source=fb" })
  );
  assert.equal(e.user_data.fbp, "fb.1.1795000000000.123456");
  assert.equal(e.user_data.client_user_agent, "Mozilla/5.0");
  assert.equal(e.event_source_url, "https://shop.example/p?utm_source=fb");
  // not a web address: left out
  assert.equal(meta(ctx({}, { landingUrl: "javascript:alert(1)" })).event_source_url, undefined);
});

test("Meta: no click signals adds nothing", () => {
  const e = JSON.parse(JSON.stringify(meta(ctx()))) as MetaEvent & Record<string, unknown>;
  assert.equal("event_source_url" in e, false);
  assert.deepEqual(Object.keys(e.user_data), ["external_id"]);
});

// ---- TikTok ----------------------------------------------------------------

type TiktokEvent = {
  user: { ttclid?: string; ttp?: string; user_agent?: string; external_id?: string[] };
  page?: { url: string; referrer?: string };
};
const tiktok = (c: SendContext) => (buildTiktokPayload({ pixelId: "1" }, c).data[0] as TiktokEvent);

test("TikTok: ttp, user agent and page come from the click", () => {
  const e = tiktok(
    ctx({ ttclid: "E.C.P.abc" }, {
      ttp: "2Xb5sHKqV_abc-123",
      userAgent: "Mozilla/5.0",
      landingUrl: "https://shop.example/p",
      referrer: "https://www.tiktok.com/",
    })
  );
  assert.equal(e.user.ttclid, "E.C.P.abc");
  assert.equal(e.user.ttp, "2Xb5sHKqV_abc-123");
  assert.equal(e.user.user_agent, "Mozilla/5.0");
  assert.deepEqual(e.page, { url: "https://shop.example/p", referrer: "https://www.tiktok.com/" });
});

test("TikTok: no click signals adds nothing", () => {
  const e = JSON.parse(JSON.stringify(tiktok(ctx()))) as TiktokEvent & Record<string, unknown>;
  assert.equal("page" in e, false);
  assert.deepEqual(Object.keys(e.user), ["external_id"]);
});

// ---- LINE Ads / Snapchat / Google Ads ---------------------------------------

const LINE_UID = "U" + "0123456789abcdef".repeat(2);
const LINE_BROWSER_ID = "0b7e1c2a-4d5f-4a6b-8c7d-9e0f1a2b3c4d";

test("LINE Ads: body is an array; line_uid only with channelId; click_id and browser_id from the click", () => {
  const click = { lineClickId: "ldtag_abc-12345", lineBrowserId: LINE_BROWSER_ID };
  const withCh = buildLineAdsPayload({ channelId: "2001234567" }, ctx({ lineUserId: LINE_UID } as never, click));
  assert.ok(Array.isArray(withCh));
  assert.equal(withCh[0].event.event_name, "generate_lead");
  assert.equal(withCh[0].user.line_uid, LINE_UID);
  assert.equal(withCh[0].user.external_id, "lead1");
  assert.equal(withCh[0].user.click_id, "ldtag_abc-12345");
  assert.equal(withCh[0].user.browser_id, LINE_BROWSER_ID);
  assert.deepEqual(withCh[0].custom, { value: 100, currency: "THB" });
  const noCh = buildLineAdsPayload({}, ctx({ lineUserId: LINE_UID } as never));
  assert.equal(noCh[0].user.line_uid, undefined);
  assert.equal(noCh[0].user.click_id, undefined);
  assert.equal(noCh[0].user.browser_id, undefined);
  assert.equal(lineEventName("ซื้อ สินค้า!"), "Conversion");
});

test("LINE Ads: a field that does not fit LINE's schema is left out, not sent", () => {
  // One malformed field makes LINE reject the whole request.
  const click = { lineClickId: "has.dot~and=eq", lineBrowserId: "not-a-uuid" };
  const p = buildLineAdsPayload({ channelId: "2001234567" }, ctx({ lineUserId: "Uabc" } as never, click));
  assert.equal(p[0].user.line_uid, undefined);
  assert.equal(p[0].user.click_id, undefined);
  assert.equal(p[0].user.browser_id, undefined);
  assert.equal(p[0].user.external_id, "lead1");
  const lower = buildLineAdsPayload({}, { ...ctx(), currency: "thb" });
  assert.deepEqual(lower[0].custom, { value: 100, currency: "THB" });
  const negative = buildLineAdsPayload({}, { ...ctx(), value: -5 });
  assert.equal(negative[0].custom, undefined);
});

test("LINE Ads: deduplication key fits the schema, is stable, and differs per event name", () => {
  const shape = /^[0-9a-zA-Z_-]{1,256}$/;
  const thai = lineDedupKey("lead1", "ซื้อสินค้า");
  assert.match(thai, shape);
  assert.equal(thai, lineDedupKey("lead1", "ซื้อสินค้า"));
  assert.notEqual(thai, lineDedupKey("lead1", "จองคิว"));
  assert.notEqual(thai, lineDedupKey("lead2", "ซื้อสินค้า"));
  assert.match(buildLineAdsPayload({}, ctx())[0].event.deduplication_key, shape);
});

test("LINE Ads: sends to the v1 events endpoint with tag headers", async () => {
  const calls = await captureFetch(() => sendLineAds({ tagId: "tag-1", accessToken: "tok", channelId: "2001234567" }, ctx()));
  assert.equal(calls[0].url, "https://conversion-api.tr.line.me/v1/tag-1/events");
  assert.equal(calls[0].headers["X-Line-TagAccessToken"], "tok");
  assert.equal(calls[0].headers["X-Line-ChannelID"], "2001234567");
  assert.ok(Array.isArray(JSON.parse(calls[0].body)));
});

const MSCLKID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";
const MSCLKID_BARE = "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d";

test("Microsoft: msclkid is sent as 32 hex characters, marsos data provider, hashed external id", () => {
  const ok = buildMicrosoftPayload({ conversionName: "Lead" }, ctx({ msclkid: MSCLKID } as never));
  assert.equal(ok.data[0].userData.msclkid, MSCLKID_BARE);
  assert.equal(ok.data[0].eventName, "Lead");
  assert.equal(ok.dataProvider, "marsos");
  assert.match(String(ok.data[0].userData.externalId), /^[0-9a-f]{64}$/);
  // The value on a real landing URL has no hyphens and may be upper case.
  assert.equal(cleanMsclkid(MSCLKID_BARE.toUpperCase()), MSCLKID_BARE);
  assert.equal(cleanMsclkid("not-a-uuid"), undefined);
  assert.equal(cleanMsclkid(MSCLKID_BARE.slice(1)), undefined);
  assert.equal(buildMicrosoftPayload({}, ctx({ msclkid: "not-a-uuid" } as never)).data[0].userData.msclkid, undefined);
});

test("Microsoft: legacy credentials without the new keys fail, never mock", async () => {
  const r = await sendMicrosoft({ customerId: "1", developerToken: "d", accessToken: "a" }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.mock, false);
  assert.match(String(r.error), /UET Tag ID/);
  const mock = await sendMicrosoft({}, ctx());
  assert.equal(mock.mock, true);
});

test("Microsoft: no identifier fails without calling the API", async () => {
  let called = false;
  const calls = await captureFetch(() => sendMicrosoft({ tagId: "123456", apiToken: "t" }, ctx({ lineUserId: null })), () => { called = true; });
  assert.equal(called, false);
  assert.equal(calls.length, 0);
  const r = await sendMicrosoft({ tagId: "123456", apiToken: "t" }, ctx({ lineUserId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.mock, false);
});

test("X: no twclid fails; payload has no hashed_external_id", async () => {
  const noClick = buildXPayload({ pixelId: "o1abc" }, ctx());
  assert.deepEqual(noClick.conversions[0].identifiers, []);
  const r = await sendX({ pixelId: "o1abc", accessToken: "t" }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.mock, false);
  const withClick = buildXPayload({ pixelId: "o1abc" }, ctx({ twclid: "tw123" } as never));
  assert.deepEqual(withClick.conversions[0].identifiers, [{ twclid: "tw123" }]);
  assert.equal(JSON.stringify(withClick).includes("hashed_external_id"), false);
});

test("Snapchat: access token goes in the query string, not a bearer header", async () => {
  const calls = await captureFetch(() => sendSnapchat({ pixelId: "px 1", accessToken: "a/b c" }, ctx({ scclid: "sc1" } as never)));
  assert.equal(calls[0].url, "https://tr.snapchat.com/v3/px%201/events?access_token=a%2Fb%20c");
  assert.equal(calls[0].headers.authorization, undefined);
});

test("Snapchat: WEB with page url, sc_cookie1 and user agent; OFFLINE without a url", () => {
  const web = buildSnapchatPayload({} as never, ctx({}, { scid: "a1b2c3d4-e5f6", userAgent: "u".repeat(900), landingUrl: "https://shop.example/p?x=1" }));
  const ev = web.data[0];
  assert.equal(ev.action_source, "WEB");
  assert.equal(ev.event_source_url, "https://shop.example/p?x=1");
  assert.equal(ev.user_data.sc_cookie1, "a1b2c3d4-e5f6");
  assert.equal(ev.user_data.client_user_agent?.length, 500);
  const off = buildSnapchatPayload({} as never, ctx({}, { landingUrl: "javascript:alert(1)" })).data[0];
  assert.equal(off.action_source, "OFFLINE");
  assert.equal(off.event_source_url, undefined);
  assert.equal(buildSnapchatPayload({} as never, ctx()).data[0].action_source, "OFFLINE");
});

test("Google Ads: gclid beats gbraid beats wbraid, and only one is present", () => {
  const conv = (l: Partial<Lead>, c?: ClickSignals) =>
    buildGoogleAdsPayload({} as never, ctx(l, c)).conversions[0] as Record<string, unknown>;
  const all = { gbraid: "gbraid-value-1", wbraid: "wbraid-value-1" };
  const a = conv({ gclid: "G1" } as Partial<Lead>, all);
  assert.equal(a.gclid, "G1");
  assert.equal("gbraid" in a || "wbraid" in a, false);
  const b = conv({}, all);
  assert.equal(b.gbraid, "gbraid-value-1");
  assert.equal("gclid" in b || "wbraid" in b, false);
  const c = conv({}, { wbraid: "wbraid-value-1" });
  assert.equal(c.wbraid, "wbraid-value-1");
  assert.equal("gclid" in c || "gbraid" in c, false);
});
