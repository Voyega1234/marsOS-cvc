import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asBodyObject,
  coerceTrackBody,
  isPlausibleClickId,
  browserIdsFromStored,
  cleanFbc,
  absoluteHttpUrl,
  cleanFbp,
  cleanGaClientId,
  cleanGoogleBraid,
  cleanLineBrowserId,
  cleanLineClickId,
  cleanScid,
  cleanTtp,
  fbcFor,
  gaSessionFor,
  hasBrowserIds,
  mergeBrowserIds,
  parseGaSessionCookie,
  parseGaSessions,
  readBrowserIds,
} from "./browserIds";

test("cleanGaClientId: bare id and whole cookie value", () => {
  assert.equal(cleanGaClientId("1234567890.1700000000"), "1234567890.1700000000");
  assert.equal(cleanGaClientId("GA1.1.1234567890.1700000000"), "1234567890.1700000000");
  assert.equal(cleanGaClientId("GA1.2.1234567890.1700000000"), "1234567890.1700000000");
});

test("cleanGaClientId: rejects anything else", () => {
  for (const bad of ["", "lead.abc", "1234567890", "a.b", "1.2.3", "<script>", 42, null, undefined]) {
    assert.equal(cleanGaClientId(bad), undefined, String(bad));
  }
});

test("parseGaSessionCookie: GS1 format", () => {
  assert.equal(parseGaSessionCookie("GS1.1.1700000000.5.1.1700000100.60.0.0"), "1700000000");
});

test("parseGaSessionCookie: GS2 format", () => {
  assert.equal(parseGaSessionCookie("GS2.1.s1746825440$o1$g0$t1746825440$j60$l0$h0"), "1746825440");
  // field order is not guaranteed
  assert.equal(parseGaSessionCookie("GS2.1.o3$s1746825440$g1"), "1746825440");
});

test("parseGaSessionCookie: rejects unknown or broken values", () => {
  for (const bad of ["", "GS3.1.1700000000", "GS1.1.abc", "GS2.1.o1$g0", "GS1.1.12", "x".repeat(400), 1, null]) {
    assert.equal(parseGaSessionCookie(bad), undefined, String(bad).slice(0, 20));
  }
});

test("parseGaSessions: several streams, bad entries dropped", () => {
  assert.deepEqual(
    parseGaSessions(
      "abc123xyz:GS1.1.1700000000.5.1.1700000100.60.0.0~DEF456:GS2.1.s1746825440$o1~bad~X:GS1.1.1700000000~OK99:nope"
    ),
    { ABC123XYZ: "1700000000", DEF456: "1746825440" }
  );
  assert.equal(parseGaSessions(""), undefined);
  assert.equal(parseGaSessions("nothing here"), undefined);
  assert.equal(parseGaSessions(undefined), undefined);
});

test("parseGaSessions: no more than five streams", () => {
  const raw = Array.from({ length: 9 }, (_, i) => `STREAM${i}:GS1.1.170000000${i}.1`).join("~");
  assert.equal(Object.keys(parseGaSessions(raw) ?? {}).length, 5);
});

test("cleanFbp / cleanFbc / cleanTtp", () => {
  assert.equal(cleanFbp("fb.1.1596403881668.1116446470"), "fb.1.1596403881668.1116446470");
  assert.equal(cleanFbp("fb.1.abc.123"), undefined);
  assert.equal(cleanFbp("1596403881668.1116446470"), undefined);

  assert.equal(cleanFbc("fb.1.1554763741205.AbCdEfGhIjKl_mn-OP"), "fb.1.1554763741205.AbCdEfGhIjKl_mn-OP");
  assert.equal(cleanFbc("fb.1.1554763741205.{{fbclid}}"), undefined);
  assert.equal(cleanFbc("fb.1.1554763741205.short"), undefined);

  assert.equal(cleanTtp("2Xb5sHKqV_abc-123.def"), "2Xb5sHKqV_abc-123.def");
  assert.equal(cleanTtp("short"), undefined);
  assert.equal(cleanTtp("has space in it"), undefined);
});

test("readBrowserIds: keeps only the fields that pass", () => {
  const input: Record<string, string> = {
    ga_client_id: "1234567890.1700000000",
    ga_sessions: "ABC123:GS1.1.1700000000.1",
    fbp: "not-an-fbp",
    ttp: "2Xb5sHKqV_abc-123",
  };
  const ids = readBrowserIds((name) => input[name]);
  assert.deepEqual(ids, {
    gaClientId: "1234567890.1700000000",
    gaSessions: { ABC123: "1700000000" },
    ttp: "2Xb5sHKqV_abc-123",
  });
  assert.equal(hasBrowserIds(ids), true);
  assert.equal(hasBrowserIds(readBrowserIds(() => undefined)), false);
});

test("mergeBrowserIds: newer wins, missing fields kept, sessions merged per stream", () => {
  assert.deepEqual(
    mergeBrowserIds(
      { gaClientId: "1.1", fbp: "fb.1.1596403881668.1", gaSessions: { A123: "1700000000", B123: "1700000001" } },
      { gaClientId: "2.2", gaSessions: { A123: "1700009999" } }
    ),
    { gaClientId: "2.2", fbp: "fb.1.1596403881668.1", gaSessions: { A123: "1700009999", B123: "1700000001" } }
  );
});

test("browserIdsFromStored: re-validates stored JSON", () => {
  assert.deepEqual(
    browserIdsFromStored({
      gaClientId: "1234567890.1700000000",
      gaSessions: { ABC123: "1700000000", "bad key": "1700000000", OK12: "nope" },
      fbp: "junk",
      extra: "ignored",
    }),
    { gaClientId: "1234567890.1700000000", gaSessions: { ABC123: "1700000000" } }
  );
  assert.deepEqual(browserIdsFromStored(null), {});
  assert.deepEqual(browserIdsFromStored("text"), {});
});

test("gaSessionFor: the stream of this measurement id, inside 24 hours only", () => {
  const start = 1_700_000_000;
  const sessions = { ABC123: String(start) };
  const at = (seconds: number) => new Date((start + seconds) * 1000);

  assert.equal(gaSessionFor(sessions, "G-ABC123", at(60)), String(start));
  assert.equal(gaSessionFor(sessions, "g-abc123", at(60)), String(start));
  assert.equal(gaSessionFor(sessions, "G-ABC123", at(24 * 3600)), String(start));
  assert.equal(gaSessionFor(sessions, "G-ABC123", at(24 * 3600 + 1)), undefined);
  // a session id from the future is not believable
  assert.equal(gaSessionFor(sessions, "G-ABC123", at(-10)), undefined);
  // another stream's session must never be sent to this one
  assert.equal(gaSessionFor(sessions, "G-OTHER99", at(60)), undefined);
  assert.equal(gaSessionFor(undefined, "G-ABC123", at(60)), undefined);
  assert.equal(gaSessionFor(sessions, undefined, at(60)), undefined);
});

test("fbcFor: cookie when it matches, built in milliseconds otherwise", () => {
  const clickTime = new Date(1_700_000_000_123);
  const cookie = "fb.1.1699999999000.IwAR0abcdefgh";

  assert.equal(fbcFor("IwAR0abcdefgh", cookie, clickTime), cookie);
  assert.equal(fbcFor("IwAR0abcdefgh", undefined, clickTime), "fb.1.1700000000123.IwAR0abcdefgh");
  // the lead came in on a newer ad click than the one in the cookie
  assert.equal(fbcFor("IwAR0newclick", cookie, clickTime), "fb.1.1700000000123.IwAR0newclick");
  // no click id on the lead: an earlier ad click remembered by the browser still counts
  assert.equal(fbcFor(null, cookie, clickTime), cookie);
  assert.equal(fbcFor(null, undefined, clickTime), undefined);
});

const BRAID = "EAIaIQobChMI_abc-DEF123";
const LINE_CLICK = "ldtag.abc_123-XYZ";
const LINE_BROWSER = "0b7e1c2a-4d5f-4a6b-8c9d-1234567890ab";

test("new cleaners accept the documented shapes", () => {
  assert.equal(cleanGoogleBraid(BRAID), BRAID);
  assert.equal(cleanLineClickId(LINE_CLICK), LINE_CLICK);
  assert.equal(cleanLineBrowserId(LINE_BROWSER), LINE_BROWSER);
  assert.equal(cleanScid("a1b2c3d4-e5f6_7890"), "a1b2c3d4-e5f6_7890");
});

test("braid and LINE id limits match the shared id shapes", () => {
  assert.equal(cleanGoogleBraid("a".repeat(8)), "a".repeat(8));
  assert.equal(cleanGoogleBraid("a".repeat(512)), "a".repeat(512));
  assert.equal(cleanGoogleBraid("a".repeat(7)), undefined);
  assert.equal(cleanLineClickId("ab=="), "ab==");
  assert.equal(cleanLineClickId("a~b.c-d"), "a~b.c-d");
  assert.equal(cleanLineBrowserId("a.b_"), "a.b_");
  assert.equal(cleanLineBrowserId("x".repeat(128)), "x".repeat(128));
});

test("absoluteHttpUrl accepts only absolute http(s) URLs with a host", () => {
  assert.equal(absoluteHttpUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  for (const bad of ["/relative", "javascript:alert(1)", "ftp://example.com", "https://", "", null, undefined, "https://e.com/" + "a".repeat(2000)]) {
    assert.equal(absoluteHttpUrl(bad), undefined, String(bad));
  }
});

test("new cleaners reject short, long and unsafe values", () => {
  for (const bad of ["", "short", "has space 12345", "<script>alert(1)</script>", "a".repeat(513), 42, null, undefined]) {
    assert.equal(cleanGoogleBraid(bad), undefined, String(bad));
  }
  for (const bad of ["", "abc", "a b c d e f g h", "x".repeat(513), null]) {
    assert.equal(cleanLineClickId(bad), undefined, String(bad));
  }
  for (const bad of ["abc", "x".repeat(129), "has space 0123", "a/b/c/d", null]) {
    assert.equal(cleanLineBrowserId(bad), undefined, String(bad));
  }
  for (const bad of ["short", "x".repeat(129), "a.b.c.d.e.f.g.h", null]) {
    assert.equal(cleanScid(bad), undefined, String(bad));
  }
});

test("readBrowserIds / hasBrowserIds / fromStored handle the five new fields", () => {
  const wire: Record<string, string> = {
    gbraid: BRAID, wbraid: BRAID, line_click_id: LINE_CLICK, line_browser_id: LINE_BROWSER, scid: "a1b2c3d4-e5f6",
  };
  const ids = readBrowserIds((n) => wire[n]);
  assert.deepEqual(ids, {
    gbraid: BRAID, wbraid: BRAID, lineClickId: LINE_CLICK, lineBrowserId: LINE_BROWSER, scid: "a1b2c3d4-e5f6",
  });
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    assert.equal(hasBrowserIds({ [key]: ids[key] }), true, key);
  }
  assert.deepEqual(readBrowserIds(() => "<bad>"), {});
  assert.deepEqual(browserIdsFromStored(JSON.parse(JSON.stringify({ ...ids, scid: "bad!" }))), {
    gbraid: BRAID, wbraid: BRAID, lineClickId: LINE_CLICK, lineBrowserId: LINE_BROWSER,
  });
});

test("mergeBrowserIds: a new field joins, an older one is kept", () => {
  assert.deepEqual(mergeBrowserIds({ gbraid: BRAID }, { scid: "a1b2c3d4" }), { gbraid: BRAID, scid: "a1b2c3d4" });
});

test("isPlausibleClickId rejects template leftovers and whitespace", () => {
  for (const ok of ["Cj0KCQ_abc-123", "IwAR0abc.def", "E.C.P.abc"]) assert.equal(isPlausibleClickId(ok), true, ok);
  for (const bad of ["{gclid}", "a b", "abc%7Bx", "[gclid]", "x]y", "a\tb"]) assert.equal(isPlausibleClickId(bad), false, bad);
});

test("asBodyObject treats non-objects as empty", () => {
  for (const v of [null, undefined, "x", 5, true, [1, 2]]) assert.deepEqual(asBodyObject(v), {});
  assert.deepEqual(asBodyObject({ a: 1 }), { a: 1 });
});

test("coerceTrackBody keeps valid strings, trimmed", () => {
  assert.deepEqual(coerceTrackBody({ utm_source: " google ", landing_url: "https://x.test/a" }), {
    utm_source: "google",
    landing_url: "https://x.test/a",
  });
});

test("coerceTrackBody drops non-string, empty and over-cap values without truncating", () => {
  const out = coerceTrackBody({
    utm_source: 5,
    utm_medium: { a: 1 },
    utm_campaign: ["x"],
    utm_term: "   ",
    content: "a".repeat(1001),
    utm_content: "b".repeat(1000),
    landing_url: "https://x.test/" + "a".repeat(1985),
    referrer: "https://x.test/" + "a".repeat(2000),
  });
  assert.deepEqual(Object.keys(out).sort(), ["landing_url", "utm_content"]);
  assert.equal(out.utm_content.length, 1000);
});

test("coerceTrackBody drops malformed click ids per platform and keeps valid ones", () => {
  for (const f of ["gclid", "fbclid", "ttclid", "msclkid", "twclid", "scclid"]) {
    assert.deepEqual(coerceTrackBody({ [f]: "{" + f + "}" }), {}, f);
    assert.deepEqual(coerceTrackBody({ [f]: "a b" }), {}, f);
    assert.deepEqual(coerceTrackBody({ [f]: "ab%20c" }), {}, f);
    assert.deepEqual(coerceTrackBody({ [f]: "Valid_id-123" }), { [f]: "Valid_id-123" }, f);
  }
});

test("coerceTrackBody on a non-object body is empty", () => {
  assert.deepEqual(coerceTrackBody("text"), {});
  assert.deepEqual(coerceTrackBody(null), {});
  assert.deepEqual(coerceTrackBody([{ utm_source: "x" }]), {});
});
