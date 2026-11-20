import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseLineTracking, isLineTrackingAdmin } from "./access";
import { isClientApiAllowed, isClientPageAllowed } from "../client-access";

test("every team role may use LINE Tracking", () => {
  for (const role of ["ADMIN", "USER", "SEO_MANAGER", "SEO_PLANNER", "WRITER", "REVIEWER", "PUBLISHER"]) {
    assert.equal(canUseLineTracking(role), true, role);
  }
});

test("a customer account (CLIENT) and a missing role never get in", () => {
  assert.equal(canUseLineTracking("CLIENT"), false);
  assert.equal(canUseLineTracking("client"), false);
  assert.equal(canUseLineTracking(" CLIENT "), false);
  assert.equal(canUseLineTracking(""), false);
  assert.equal(canUseLineTracking("   "), false);
  assert.equal(canUseLineTracking(null), false);
  assert.equal(canUseLineTracking(undefined), false);
});

test("maintenance inside the module stays with ADMIN", () => {
  assert.equal(isLineTrackingAdmin("ADMIN"), true);
  for (const role of ["CLIENT", "WRITER", "SEO_MANAGER", "admin", "", null, undefined]) {
    assert.equal(isLineTrackingAdmin(role), false, String(role));
  }
});

// MarsOS gives a CLIENT session only on the paths in src/lib/client-access.ts.
// None of the module's staff pages or APIs may ever be on that list.
test("the CLIENT allowlist of MarsOS has no LINE Tracking page or API", () => {
  for (const page of [
    "/line-tracking",
    "/line-tracking/projects/abc",
    "/line-tracking/projects/abc/leads",
    "/line-tracking/projects/abc/settings",
  ]) {
    assert.equal(isClientPageAllowed(page), false, page);
  }
  for (const api of [
    "/api/line-tracking/looker/summary",
    "/api/line-tracking/looker/leads",
    "/api/conversions/process",
    "/api/webhooks/line/abc",
    "/api/track/abc",
    "/api/liff/abc",
  ]) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(isClientApiAllowed(api, method), false, `${method} ${api}`);
    }
  }
});
