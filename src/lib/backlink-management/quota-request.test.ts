/** Run: npx tsx src/lib/backlink-management/quota-request.test.ts */
import assert from "node:assert/strict";
import { cleanVendorDomain, clientMatchesProject, isOnProcessStatus, normalizeClientName, quotaNoteLine, quotaOptionsForProject, withQuotaNote } from "./quota-request";
import type { QuotaPackageView, QuotaSlotView } from "./quota-types";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

function slot(index: number, over: Partial<QuotaSlotView> = {}): QuotaSlotView {
  const base = { index, row: 10 + index, linkUrl: "", publishedDate: null, publishedText: "", client: "", status: "", remark: "", reservation: null };
  const s = { ...base, ...over } as QuotaSlotView;
  s.used = over.used ?? !!(s.linkUrl || s.client || s.status || s.remark || s.reservation);
  s.published = over.published ?? (s.used && /publish/i.test(s.status));
  return s;
}

function pkg(id: string, slots: QuotaSlotView[], over: Partial<QuotaPackageView> = {}): QuotaPackageView {
  return {
    id, sourceId: "src", sourceTitle: "Backlink Quota", spreadsheetUrl: "", tabTitle: "2026", ordinal: 1, key: id,
    rowNumber: 5, rowCount: slots.length, type: "Guest Post", websiteText: "terrabkk.com", vendorName: "TerraBKK",
    websites: ["terrabkk.com"], priceText: "15,000THB (3,000/Link)", totalPrice: 15000, pricePerLink: 3000,
    unitText: "5", units: 5, startDate: null, startText: "", expireDate: "2027-01-31", expireText: "",
    expired: false, stale: false, used: 0, published: 0, inProcess: 0, reserved: 0, remaining: 5, usable: 5,
    slots, ...over,
  } as QuotaPackageView;
}

const OP = { status: "On Process" };
const resv = (projectId: string, website = "") => ({ id: "r1", reservedById: "u", reservedByName: "U", website, projectId, projectName: "", note: "", createdAt: "" });
const clicx = { id: "p1", name: "Clicx Bank", clientName: "Clicx" };

t("normalize ignores case, spaces and punctuation", () => {
  assert.equal(normalizeClientName(" Clicx-Bank. "), "clicxbank");
  assert.equal(normalizeClientName(null), "");
});

t("client match: equal, containment, short names do not leak", () => {
  assert.ok(clientMatchesProject("clicx bank", clicx));
  assert.ok(clientMatchesProject("CLICX", clicx));
  assert.ok(clientMatchesProject("Clicx Bank (SEO)", clicx));
  assert.ok(!clientMatchesProject("Terra", clicx));
  assert.ok(!clientMatchesProject("", clicx));
  assert.ok(!clientMatchesProject("AB", { id: "x", name: "ABC Co", clientName: "" }));
});

t("no project or no packages -> empty", () => {
  assert.deepEqual(quotaOptionsForProject([], clicx), []);
  assert.deepEqual(quotaOptionsForProject(undefined, clicx), []);
  assert.deepEqual(quotaOptionsForProject([pkg("a", [slot(0)])], null), []);
});

t("unbound package is not offered", () => {
  assert.deepEqual(quotaOptionsForProject([pkg("a", [slot(0, { client: "Other Co", ...OP }), slot(1)])], clicx), []);
});

t("On Process status: any case or spacing, In Process too", () => {
  assert.ok(isOnProcessStatus("On Process"));
  assert.ok(isOnProcessStatus(" on  process "));
  assert.ok(isOnProcessStatus("ON-PROCESS"));
  assert.ok(isOnProcessStatus("In Process"));
  assert.ok(!isOnProcessStatus("Published"));
  assert.ok(!isOnProcessStatus(""));
  assert.ok(!isOnProcessStatus(null));
});

t("only On Process slots: reservation first, then sheet-named; no free slots", () => {
  const p = pkg("a", [
    slot(0, { client: "Clicx Bank", ...OP }),
    slot(1, { reservation: resv("p1", "dailynews.co.th"), ...OP }),
    slot(2),
    slot(3),
  ]);
  const o = quotaOptionsForProject([p], clicx);
  assert.deepEqual(o.map((x) => [x.kind, x.slotIndex]), [["reserved", 1], ["sheet", 0]]);
  assert.equal(o[0].website, "dailynews.co.th");
  assert.equal(o[1].website, "terrabkk.com");
  assert.equal(o[0].pricePerLink, 3000);
  assert.equal(o[0].key, "a:1");
});

t("slots without On Process are not offered (blank, Done, Published, link set)", () => {
  const p = pkg("a", [
    slot(0, { client: "Clicx", linkUrl: "https://x.com/a", ...OP }),
    slot(1, { client: "Clicx", status: "Published" }),
    slot(2, { client: "Clicx", status: "Done" }),
    slot(3, { reservation: resv("p1") }),
    slot(4, { client: "Clicx" }),
    slot(5),
  ]);
  assert.deepEqual(quotaOptionsForProject([p], clicx), []);
});

t("expired or stale packages are not offered", () => {
  const bind = () => [slot(0, { reservation: resv("p1"), ...OP }), slot(1)];
  assert.deepEqual(quotaOptionsForProject([pkg("a", bind(), { expired: true })], clicx), []);
  assert.deepEqual(quotaOptionsForProject([pkg("a", bind(), { stale: true })], clicx), []);
  assert.deepEqual(quotaOptionsForProject([pkg("a", bind(), { usable: 0 })], clicx).map((x) => x.kind), ["reserved"]);
});

t("reservation for another project does not bind", () => {
  const p = pkg("a", [slot(0, { reservation: resv("p2"), ...OP }), slot(1)]);
  assert.deepEqual(quotaOptionsForProject([p], clicx), []);
});

t("unknown price -> null, website falls back to vendor name", () => {
  const p = pkg("a", [slot(0, { reservation: resv("p1"), ...OP })], { pricePerLink: null, websites: [] });
  const [o] = quotaOptionsForProject([p], clicx);
  assert.equal(o.pricePerLink, null);
  assert.equal(o.website, "TerraBKK");
});

t("note line names site, sheet and slot", () => {
  const p = pkg("a", [slot(0, { reservation: resv("p1", "dailynews.co.th"), ...OP }), slot(1, { client: "Clicx", ...OP })]);
  const [r, f] = quotaOptionsForProject([p], clicx);
  assert.equal(quotaNoteLine(r), "[โควต้า] dailynews.co.th · Backlink Quota / 2026 · ช่องที่ 1");
  assert.equal(quotaNoteLine(f), "[โควต้า] terrabkk.com · Backlink Quota / 2026 · ช่องที่ 2");
});

t("cleanVendorDomain: one line, trimmed, capped, non-strings dropped", () => {
  assert.equal(cleanVendorDomain("  dailynews.co.th \n"), "dailynews.co.th");
  assert.equal(cleanVendorDomain("a\u0000b\tc"), "a b c");
  assert.equal(cleanVendorDomain("x".repeat(300)).length, 200);
  assert.equal(cleanVendorDomain(42), "");
  assert.equal(cleanVendorDomain(null), "");
});

t("withQuotaNote replaces or drops only the quota line", () => {
  assert.equal(withQuotaNote("", "[โควต้า] a"), "[โควต้า] a");
  assert.equal(withQuotaNote("ส่งด่วน", "[โควต้า] a"), "ส่งด่วน\n[โควต้า] a");
  assert.equal(withQuotaNote("ส่งด่วน\n[โควต้า] a\n", "[โควต้า] b"), "ส่งด่วน\n[โควต้า] b");
  assert.equal(withQuotaNote("ส่งด่วน\n[โควต้า] a", null), "ส่งด่วน");
  assert.equal(withQuotaNote("  บรรทัดแรก\nบรรทัดสอง", null), "  บรรทัดแรก\nบรรทัดสอง");
});

console.log(`\n${n} passed`);
