/** Run: npx tsx src/lib/backlink-management/workflow.test.ts */
import assert from "node:assert/strict";
import { resolveAction } from "./workflow";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }
const ok = (r: ReturnType<typeof resolveAction>, to: string) => { assert.ok(r.ok); if (r.ok) assert.equal(r.toStatus, to); };
const bad = (r: ReturnType<typeof resolveAction>) => { assert.ok(!r.ok); if (!r.ok) assert.ok(r.error.length > 0); };

t("approve", () => {
  ok(resolveAction("approve", { status: "REQUESTED" }, "ADMIN"), "APPROVED");
  ok(resolveAction("approve", { status: "REQUESTED" }, "SEO_MANAGER"), "APPROVED");
  bad(resolveAction("approve", { status: "REQUESTED" }, "WRITER"));
  bad(resolveAction("approve", { status: "APPROVED" }, "ADMIN"));
});
t("reject needs reason", () => {
  bad(resolveAction("reject", { status: "REQUESTED" }, "ADMIN"));
  ok(resolveAction("reject", { status: "REQUESTED", reason: "แพง" }, "ADMIN"), "REJECTED");
  ok(resolveAction("reject", { status: "REQUESTED" }, "ADMIN", { reason: "แพง" }), "REJECTED");
});
t("start/publish", () => {
  ok(resolveAction("start", { status: "APPROVED" }, "WRITER"), "IN_PROGRESS");
  bad(resolveAction("start", { status: "REQUESTED" }, "WRITER"));
  bad(resolveAction("publish", { status: "APPROVED" }, "WRITER"));
  bad(resolveAction("publish", { status: "APPROVED", liveUrl: "ftp://x.com" }, "WRITER"));
  ok(resolveAction("publish", { status: "APPROVED", liveUrl: "https://a.com/p" }, "WRITER"), "PUBLISHED");
  ok(resolveAction("publish", { status: "IN_PROGRESS" }, "WRITER", { liveUrl: "http://a.com" }), "PUBLISHED");
  bad(resolveAction("publish", { status: "REQUESTED", liveUrl: "https://a.com" }, "WRITER"));
});
t("cancel/resubmit", () => {
  for (const s of ["REQUESTED", "APPROVED", "IN_PROGRESS"]) ok(resolveAction("cancel", { status: s }, "WRITER"), "CANCELLED");
  bad(resolveAction("cancel", { status: "PUBLISHED" }, "WRITER"));
  ok(resolveAction("resubmit", { status: "REJECTED" }, "WRITER"), "REQUESTED");
  ok(resolveAction("resubmit", { status: "CANCELLED" }, "WRITER"), "REQUESTED");
  bad(resolveAction("resubmit", { status: "APPROVED" }, "WRITER"));
});
t("markLost/markVerified", () => {
  ok(resolveAction("markLost", { status: "PUBLISHED" }, "ADMIN"), "LOST");
  ok(resolveAction("markLost", { status: "VERIFIED" }, "SEO_MANAGER"), "LOST");
  bad(resolveAction("markLost", { status: "PUBLISHED" }, "WRITER"));
  ok(resolveAction("markVerified", { status: "LOST" }, "ADMIN"), "VERIFIED");
  ok(resolveAction("markVerified", { status: "PUBLISHED" }, "ADMIN"), "VERIFIED");
  bad(resolveAction("markVerified", { status: "VERIFIED" }, "ADMIN"));
});
t("unknown action", () => bad(resolveAction("nuke", { status: "REQUESTED" }, "ADMIN")));
console.log(`${n} passed`);
