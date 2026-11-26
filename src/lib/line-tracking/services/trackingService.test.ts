import { test } from "node:test";
import assert from "node:assert/strict";
import { extractParams } from "./trackingService";

test("extractParams reads gbraid, wbraid, ldtag_cl as browser ids", () => {
  const p = extractParams(new URLSearchParams("gbraid=abcdefgh12&wbraid=WBRAID_12345&ldtag_cl=lineclick-1&utm_source=x"));
  assert.deepEqual(p.browserIds, { gbraid: "abcdefgh12", wbraid: "WBRAID_12345", lineClickId: "lineclick-1" });
  assert.equal(p.source, "x");
});

test("extractParams maps ScCid to scclid", () => {
  assert.equal(extractParams(new URLSearchParams("ScCid=snapclick123")).scclid, "snapclick123");
});

test("extractParams drops malformed or templated ids", () => {
  const p = extractParams(
    new URLSearchParams("gclid=a%20b&fbclid=%7Bfbclid%7D&ttclid=x%25y&gbraid=short&wbraid=[wbraid]&ldtag_cl=a b&ga_client_id=1.2")
  );
  assert.equal(p.gclid, undefined);
  assert.equal(p.fbclid, undefined);
  assert.equal(p.ttclid, undefined);
  assert.deepEqual(p.browserIds, {});
  assert.equal(p.gaClientId, "1.2");
});

test("extractParams keeps the last plausible value of a repeated click id", () => {
  assert.equal(extractParams(new URLSearchParams("gclid=real_one&gclid={gclid}")).gclid, "real_one");
});
