/** Run: npx tsx src/lib/backlink-management/quota-request.test.ts */
import assert from "node:assert/strict";
import {
  cleanVendorDomain, clientMatchesProject, hasRequestMarker, isOnProcessStatus, normalizeClientName, quotaNoteLine, quotaOptionsForProject,
  requestIdFromNote, requestMarker, requestReservationNote, sheetClientForProject, stripRequestMarker, withQuotaNote,
} from "./quota-request";
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

// ───────────────────────── free room (a request books the slot on submit) ─────────────────────────

t("free room is offered only when asked for", () => {
  const p = pkg("a", [slot(0, { client: "Other", ...OP }), slot(1)]);
  assert.deepEqual(quotaOptionsForProject([p], clicx), []);
  const free = quotaOptionsForProject([p], clicx, { free: true });
  assert.deepEqual(free.map((x) => [x.kind, x.key, x.slotIndex, x.website]), [["free", "a:new:0", null, "terrabkk.com"]]);
  assert.equal(free[0].pricePerLink, 3000);
});

t("free room: one option per website, duplicates dropped, fallback site when the package lists none", () => {
  const many = pkg("a", [slot(0)], { websites: ["a.com", "A.com", " b.com ", ""] });
  assert.deepEqual(quotaOptionsForProject([many], clicx, { free: true }).map((x) => [x.key, x.website]), [["a:new:0", "a.com"], ["a:new:1", "b.com"]]);
  const none = pkg("b", [slot(0)], { websites: [] });
  assert.deepEqual(quotaOptionsForProject([none], clicx, { free: true }).map((x) => [x.key, x.website]), [["b:new:0", "TerraBKK"]]);
  const nameless = pkg("c", [slot(0)], { websites: [], vendorName: "", websiteText: "" });
  assert.deepEqual(quotaOptionsForProject([nameless], clicx, { free: true }), []);
});

t("free room: expired, stale and full packages are not offered", () => {
  const cfg = { free: true };
  assert.deepEqual(quotaOptionsForProject([pkg("a", [slot(0)], { expired: true })], clicx, cfg), []);
  assert.deepEqual(quotaOptionsForProject([pkg("a", [slot(0)], { stale: true })], clicx, cfg), []);
  const full = pkg("a", [slot(0, { client: "X", ...OP }), slot(1, { client: "Y", ...OP })], { units: 2 });
  assert.deepEqual(quotaOptionsForProject([full], clicx, cfg), []);
  // every row used, but the unit count leaves room for one more row
  const grows = pkg("a", [slot(0, { client: "X", ...OP })], { units: 2 });
  assert.equal(quotaOptionsForProject([grows], clicx, cfg).length, 1);
  // a slot held by a reservation only (sheet row still blank) is not free
  const held = pkg("a", [slot(0, { reservation: resv("p2"), used: false })], { units: 1 });
  assert.deepEqual(quotaOptionsForProject([held], clicx, cfg), []);
});

t("free room: a package without a unit count grows only when it is the last in its tab", () => {
  const usedSlot = () => [slot(0, { client: "X", ...OP })];
  const first = pkg("a", usedSlot(), { units: null, ordinal: 1 });
  const last = pkg("b", usedSlot(), { units: null, ordinal: 2 });
  const otherTab = pkg("c", usedSlot(), { units: null, ordinal: 1, tabTitle: "2027" });
  assert.deepEqual(quotaOptionsForProject([first, last, otherTab], clicx, { free: true }).map((x) => x.packageId), ["b", "c"]);
  // a stale package below does not count as the last one
  const staleLast = pkg("d", usedSlot(), { units: null, ordinal: 3, stale: true });
  assert.deepEqual(quotaOptionsForProject([first, last, staleLast], clicx, { free: true }).map((x) => x.packageId), ["b"]);
});

t("booked slots come before free room", () => {
  const p = pkg("a", [slot(0, { reservation: resv("p1"), ...OP }), slot(1, { client: "Clicx", ...OP }), slot(2)]);
  assert.deepEqual(quotaOptionsForProject([p], clicx, { free: true }).map((x) => x.kind), ["reserved", "sheet", "free"]);
});

// ───────────────────────── request marker ─────────────────────────

t("request marker: build, read, strip", () => {
  assert.equal(requestMarker("req1"), "[คำขอ req1]");
  assert.equal(requestReservationNote("req1", " https://x.test/page "), "[คำขอ req1] https://x.test/page");
  assert.equal(requestReservationNote("req1", ""), "[คำขอ req1]");
  assert.equal(requestReservationNote("req1", "x".repeat(2000)).length, 1000);
  assert.equal(requestIdFromNote("[คำขอ req1] https://x.test"), "req1");
  assert.equal(requestIdFromNote("  [คำขอ req1]"), "req1");
  assert.equal(requestIdFromNote("ดู [คำขอ req1]"), null);
  assert.equal(requestIdFromNote("[คำขอ] x"), null);
  assert.equal(requestIdFromNote(""), null);
  assert.equal(requestIdFromNote(null), null);
  assert.equal(hasRequestMarker("[คำขอ req1] x"), true);
  assert.equal(hasRequestMarker("จองไว้ให้ Clicx"), false);
  assert.equal(stripRequestMarker("[คำขอ req1] https://x.test"), "https://x.test");
  assert.equal(stripRequestMarker("[คำขอ req1]"), "");
  assert.equal(stripRequestMarker("จองไว้"), "จองไว้");
});

t("a slot already taken by a request is not offered again (neither as reserved nor as sheet)", () => {
  const taken = { ...resv("p1"), note: "[คำขอ req1] https://x.test" };
  const p = pkg("a", [slot(0, { reservation: taken, client: "Clicx", ...OP }), slot(1, { reservation: resv("p1"), ...OP })]);
  assert.deepEqual(quotaOptionsForProject([p], clicx).map((x) => x.key), ["a:1"]);
  // the marker of a deleted request is gone: the slot is offered again
  const freed = { ...resv("p1"), note: stripRequestMarker(taken.note) };
  const p2 = pkg("a", [slot(0, { reservation: freed, client: "Clicx", ...OP })]);
  assert.deepEqual(quotaOptionsForProject([p2], clicx).map((x) => x.kind), ["reserved"]);
});

t("sheetClientForProject: reuse an existing spelling only on an exact match", () => {
  assert.equal(sheetClientForProject(clicx, ["Acme", " CLICX "]), "CLICX");
  assert.equal(sheetClientForProject(clicx, ["Clicx Bank"]), "Clicx Bank"); // equals the project name
  assert.equal(sheetClientForProject(clicx, ["Clicx Thailand"]), "Clicx"); // containment is not enough
  assert.equal(sheetClientForProject({ id: "p", name: "Solo" }, []), "Solo");
  assert.equal(sheetClientForProject({ id: "p", name: " ", clientName: null }, ["X"]), "");
});

t("note line for free room has no slot number yet", () => {
  const [o] = quotaOptionsForProject([pkg("a", [slot(0)])], clicx, { free: true });
  assert.equal(quotaNoteLine(o), "[โควต้า] terrabkk.com · Backlink Quota / 2026 · ช่องว่างใหม่");
  assert.equal(quotaNoteLine({ ...o, slotIndex: 2 }), "[โควต้า] terrabkk.com · Backlink Quota / 2026 · ช่องที่ 3");
});

console.log(`\n${n} passed`);
