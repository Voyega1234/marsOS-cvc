import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATFORMS } from "@/lib/line-tracking/platforms";
import { CC_LOST_EVENT, ccPlatformsForStatus } from "./convertCakeConversions";

test("LOST goes to every platform as the custom lost event", () => {
  const out = ccPlatformsForStatus("LOST", {});
  assert.equal(Object.keys(out).length, PLATFORMS.length);
  assert.ok(Object.values(out).every((c) => c.enabled && c.eventName === CC_LOST_EVENT));
});

test("every platform is on even when the rule turned it off; rule event names win", () => {
  const out = ccPlatformsForStatus("CONTACTED", { meta: { enabled: false, eventName: "MyContact" } });
  assert.deepEqual(out.meta, { enabled: true, eventName: "MyContact" });
  assert.deepEqual(out.ga4, { enabled: true, eventName: "contact" });
  assert.equal(Object.keys(out).length, PLATFORMS.length);
});
