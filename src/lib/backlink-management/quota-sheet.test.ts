/** Run: npx tsx src/lib/backlink-management/quota-sheet.test.ts */
import assert from "node:assert/strict";
import {
  a1Range,
  columnLetter,
  findQuotaHeader,
  formatQuotaDate,
  isQuotaTabCandidate,
  packageStats,
  parsePriceText,
  parseQuotaTab,
  parseSheetDate,
  parseUnits,
  parseWebsiteText,
} from "./quota-sheet";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }

const HEAD = ["Type", "Website", "Price / Link", "Unit", "Start", "EXP.", "Link URL", "Published Date", "Clients", "Status", "REMARK"];
const WEB = "Nectar\nwww.bltbangkok.com (TH-EN)\nwww.businesstoday.co (TH-EN)\nwww.thepassport.travel (TH-EN)\nwww.swinggolfthailand.co (TH-EN)\nwww.huahintoday.com (EN Only)";

const example: unknown[][] = [
  HEAD,
  ["News", WEB, "80,000 THB\n2,666/Link", 30, "1 Nov 2026", "1 Nov 2027",
    "https://www.businesstoday.co/special-content/03/11/2026/x", "3 November 2026", "CVC", "Published", "seo agency"],
  ["", "", "", "", "", "", "", "", "", "On Process", ""],
  ["", "", "", "", "", "", "", "", "Radiance Skin", "On Process", "Moles Removal"],
];

// ── findQuotaHeader ──
t("header exact", () => {
  const h = findQuotaHeader([HEAD]);
  assert.ok(h);
  assert.equal(h.headerRow, 1);
  assert.deepEqual(h.columns, {
    type: 0, website: 1, price: 2, unit: 3, start: 4, expire: 5,
    linkUrl: 6, publishedDate: 7, client: 8, status: 9, remark: 10,
  });
});
t("header reordered", () => {
  const h = findQuotaHeader([["Status", "Clients", "Link URL", "Type", "Website", "Price / Link", "Unit", "Start", "EXP."]]);
  assert.ok(h);
  assert.equal(h.columns.status, 0);
  assert.equal(h.columns.client, 1);
  assert.equal(h.columns.linkUrl, 2);
  assert.equal(h.columns.type, 3);
  assert.equal(h.columns.expire, 8);
});
t("header on row 3", () => {
  const h = findQuotaHeader([["title"], [], HEAD]);
  assert.equal(h?.headerRow, 3);
});
t("header too few matches -> null", () => {
  assert.equal(findQuotaHeader([["Type", "Website", "Price", "Unit", "Start"]]), null);
  assert.equal(findQuotaHeader([]), null);
});
t("header beyond row 10 ignored", () => {
  const rows: unknown[][] = Array.from({ length: 10 }, () => []);
  rows.push(HEAD);
  assert.equal(findQuotaHeader(rows), null);
});
t("Price / Link is price, Link URL is linkUrl", () => {
  const h = findQuotaHeader([HEAD]);
  assert.equal(h?.columns.price, 2);
  assert.equal(h?.columns.linkUrl, 6);
});
t("plain 'Link' header becomes linkUrl", () => {
  const h = findQuotaHeader([["Type", "Website", "Price", "Unit", "Start", "EXP.", "Link", "Date", "Client", "Status", "Note"]]);
  assert.equal(h?.columns.linkUrl, 6);
  assert.equal(h?.columns.publishedDate, 7);
  assert.equal(h?.columns.remark, 10);
});

// ── parseQuotaTab: example ──
t("example package", () => {
  const tab = parseQuotaTab("Tab1", example)!;
  assert.equal(tab.packages.length, 1);
  const p = tab.packages[0];
  assert.equal(p.key, "Tab1#1");
  assert.equal(p.ordinal, 1);
  assert.equal(p.rowNumber, 2);
  assert.equal(p.type, "News");
  assert.equal(p.vendorName, "Nectar");
  assert.equal(p.websites.length, 5);
  assert.equal(p.units, 30);
  assert.equal(p.totalPrice, 80000);
  assert.equal(p.pricePerLink, 2666);
  assert.equal(p.startDate, "2026-11-01");
  assert.equal(p.expireDate, "2027-11-01");
  assert.equal(p.slots.length, 30);
  assert.equal(p.rowCount, 30);
  p.slots.forEach((s, i) => { assert.equal(s.index, i); assert.equal(s.row, 2 + i); });
  assert.equal(p.slots[0].publishedDate, "2026-11-03");
  assert.equal(p.slots[0].published, true);
  assert.equal(p.slots[1].used, true);
  assert.equal(p.slots[1].published, false);
  assert.equal(p.slots[3].used, false);
  assert.equal(p.slots[29].used, false);
});
t("example stats", () => {
  const p = parseQuotaTab("Tab1", example)!.packages[0];
  const s = packageStats(p, "2026-11-16");
  assert.deepEqual(s, { expired: false, used: 3, published: 1, inProcess: 2, reserved: 0, remaining: 27, usable: 27 });
});

t("two packages back to back", () => {
  const rows: unknown[][] = [
    HEAD,
    ["News", "A\na.com", "1000", 3, "1 Jan 2026", "1 Jan 2027", "u1", "", "C", "Published", ""],
    [],
    [],
    ["Blog", "B\nb.com", "500", "", "", "", "", "", "D", "On Process", ""],
    [],
  ];
  const tab = parseQuotaTab("T", rows)!;
  assert.equal(tab.packages.length, 2);
  const [a, b] = tab.packages;
  assert.equal(a.rowCount, 3);
  assert.equal(a.slots.length, 3);
  assert.equal(a.units, 3);
  assert.equal(b.rowNumber, 5);
  assert.equal(b.units, null); // แพ็กเกจสุดท้าย Unit ว่าง => ไม่รู้
  assert.equal(b.slots.length, 1);
  assert.equal(b.rowCount, 1);
});
t("middle package blank Unit -> rowsUntilNext", () => {
  const rows: unknown[][] = [
    HEAD,
    ["News", "A\na.com", "", "", "", "", "u1"],
    [],
    [],
    ["Blog", "B\nb.com", "", 2],
  ];
  const a = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(a.units, 3);
  assert.equal(a.rowCount, 3);
  assert.equal(a.slots.length, 3);
});
t("middle package with more used rows than units", () => {
  const rows: unknown[][] = [
    HEAD,
    ["News", "A\na.com", "", 1, "", "", "u1"],
    ["", "", "", "", "", "", "u2"],
    ["", "", "", "", "", "", "u3"],
    ["Blog", "B\nb.com", "", 5],
  ];
  const a = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(a.units, 1);
  assert.equal(a.slots.length, 3);
  assert.equal(a.rowCount, 3);
  assert.equal(packageStats(a, "2026-01-01").remaining, 0);
});
t("middle package fewer units than rows keeps units slots", () => {
  const rows: unknown[][] = [HEAD, ["News", "", "", 2], [], [], ["Blog", "", "", 1]];
  const a = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(a.slots.length, 2);
  assert.equal(a.rowCount, 3);
});
t("last package unknown units", () => {
  const rows: unknown[][] = [
    HEAD,
    ["News", "A\na.com", "", "", "", "", "u1"],
    ["", "", "", "", "", "", "", "", "", "On Process"],
    [],
  ];
  const p = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(p.units, null);
  assert.equal(p.slots.length, 2);
  assert.equal(p.rowCount, 2);
  assert.equal(packageStats(p, "2026-01-01").remaining, null);
  assert.equal(packageStats(p, "2026-01-01").usable, null);
});
t("last package units known generates empty slots with consecutive rows", () => {
  const rows: unknown[][] = [HEAD, ["News", "", "", 5, "", "", "u1"]];
  const p = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(p.slots.length, 5);
  assert.deepEqual(p.slots.map((s) => s.row), [2, 3, 4, 5, 6]);
  assert.equal(p.slots[4].used, false);
});
t("implicit package", () => {
  const rows: unknown[][] = [
    HEAD,
    ["", "", "", "", "", "", "u1", "", "C", "Published"],
    ["", "", "", "", "", "", "", "", "D", "On Process"],
  ];
  const tab = parseQuotaTab("Imp", rows)!;
  assert.equal(tab.packages.length, 1);
  const p = tab.packages[0];
  assert.equal(p.key, "Imp#1");
  assert.equal(p.rowNumber, 2);
  assert.equal(p.units, null);
  assert.equal(p.type, "");
  assert.equal(p.slots.length, 2);
  assert.equal(p.slots[0].published, true);
});
t("implicit package before a real package", () => {
  const rows: unknown[][] = [
    HEAD,
    ["", "", "", "", "", "", "u1"],
    ["News", "", "", 2],
  ];
  const tab = parseQuotaTab("T", rows)!;
  assert.equal(tab.packages.length, 2);
  assert.equal(tab.packages[0].units, 1);
  assert.equal(tab.packages[0].rowCount, 1);
  assert.equal(tab.packages[1].ordinal, 2);
  assert.equal(tab.packages[1].rowNumber, 3);
});
t("header only -> no packages", () => {
  assert.deepEqual(parseQuotaTab("T", [HEAD])!.packages, []);
  assert.deepEqual(parseQuotaTab("T", [HEAD, [], ["", ""]])!.packages, []);
});
t("no header -> null", () => {
  assert.equal(parseQuotaTab("T", [["a", "b"]]), null);
});
t("remark-only row counts as used", () => {
  const rows: unknown[][] = [HEAD, ["News", "", "", 3], ["", "", "", "", "", "", "", "", "", "", "just note"]];
  const p = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(p.slots[1].used, true);
  assert.equal(p.slots[1].published, false);
  assert.equal(packageStats(p, "2026-01-01").used, 1);
});
t("ragged rows / undefined cells", () => {
  const rows: unknown[][] = [HEAD, ["News", undefined, undefined, 2], ["", "", "", undefined, undefined, undefined, "u"]];
  const p = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(p.slots.length, 2);
  assert.equal(p.slots[1].linkUrl, "u");
  assert.equal(p.websiteText, "");
});
t("reordered columns parse", () => {
  const rows: unknown[][] = [
    ["Status", "Clients", "Link URL", "Type", "Website", "Price / Link", "Unit", "Start", "EXP."],
    ["Published", "C", "u", "News", "V\nv.com", "100", 2, "", ""],
  ];
  const p = parseQuotaTab("T", rows)!.packages[0];
  assert.equal(p.type, "News");
  assert.equal(p.slots[0].status, "Published");
  assert.equal(p.slots[0].published, true);
});

// ── dates ──
t("date serial 46327", () => {
  assert.deepEqual(parseSheetDate(46327), { iso: "2026-11-01", text: "1 Nov 2026" });
});
t("date ISO and slash-year-first", () => {
  assert.equal(parseSheetDate("2026-11-03").iso, "2026-11-03");
  assert.equal(parseSheetDate("2026/1/5").iso, "2026-01-05");
});
t("date English month names", () => {
  assert.equal(parseSheetDate("3 November 2026").iso, "2026-11-03");
  assert.equal(parseSheetDate("1 Nov 2026").iso, "2026-11-01");
  assert.equal(parseSheetDate("1 nov. 2026").iso, "2026-11-01");
  assert.equal(parseSheetDate("3 Nov, 2026").iso, "2026-11-03");
  assert.equal(parseSheetDate("3 Nov, 2026").text, "3 Nov, 2026");
});
t("date Thai month, Buddhist year", () => {
  assert.equal(parseSheetDate("3 พฤศจิกายน 2569").iso, "2026-11-03");
  assert.equal(parseSheetDate("3 พ.ย. 2569").iso, "2026-11-03");
  assert.equal(parseSheetDate("15 ม.ค. 2569").iso, "2026-01-15");
});
t("date numeric day-first", () => {
  assert.equal(parseSheetDate("3/11/2026").iso, "2026-11-03");
  assert.equal(parseSheetDate("3-11-2026").iso, "2026-11-03");
  assert.equal(parseSheetDate("3.11.2026").iso, "2026-11-03");
  assert.equal(parseSheetDate("3/11/2569").iso, "2026-11-03");
  assert.equal(parseSheetDate("3/11/26").iso, "2026-11-03");
});
t("date invalid / empty / garbage", () => {
  assert.deepEqual(parseSheetDate("31/2/2026"), { iso: null, text: "31/2/2026" });
  assert.deepEqual(parseSheetDate("soon"), { iso: null, text: "soon" });
  assert.deepEqual(parseSheetDate(""), { iso: null, text: "" });
  assert.deepEqual(parseSheetDate(null), { iso: null, text: "" });
  assert.deepEqual(parseSheetDate(undefined), { iso: null, text: "" });
  assert.equal(parseSheetDate(5).iso, null);
});
t("serial with fraction ignores fraction", () => {
  assert.equal(parseSheetDate(46327.75).iso, "2026-11-01");
});
t("formatQuotaDate", () => {
  assert.equal(formatQuotaDate("2026-11-01", "short"), "1 Nov 2026");
  assert.equal(formatQuotaDate("2026-11-03", "long"), "3 November 2026");
  assert.equal(formatQuotaDate("bad", "short"), "bad");
  assert.equal(formatQuotaDate("2026-02-31", "long"), "2026-02-31");
});

// ── price ──
t("price total + per link", () => {
  assert.deepEqual(parsePriceText("80,000 THB\n2,666/Link", 30), { text: "80,000 THB\n2,666/Link", totalPrice: 80000, pricePerLink: 2666 });
});
t("price variants", () => {
  assert.equal(parsePriceText("2,666 / link", null).pricePerLink, 2666);
  assert.equal(parsePriceText("2,666 per link", null).totalPrice, null);
  assert.equal(parsePriceText("1,500 ต่อลิงก์", null).pricePerLink, 1500);
  assert.equal(parsePriceText("1,500/ลิงก์", null).pricePerLink, 1500);
  assert.equal(parsePriceText("12.5/LINK", null).pricePerLink, 12.5);
});
t("price pure number derives per link", () => {
  assert.deepEqual(parsePriceText(80000, 30), { text: "80000", totalPrice: 80000, pricePerLink: 2667 });
  assert.deepEqual(parsePriceText(80000, null), { text: "80000", totalPrice: 80000, pricePerLink: null });
});
t("price per link derives total", () => {
  assert.equal(parsePriceText("500/link", 10).totalPrice, 5000);
  assert.equal(parsePriceText("500/link", 0).totalPrice, null);
});
t("price nothing", () => {
  assert.deepEqual(parsePriceText("", 5), { text: "", totalPrice: null, pricePerLink: null });
  assert.deepEqual(parsePriceText("TBD", 5), { text: "TBD", totalPrice: null, pricePerLink: null });
  assert.equal(parsePriceText(null, null).totalPrice, null);
});

// ── website ──
t("website full", () => {
  const w = parseWebsiteText(WEB);
  assert.equal(w.vendorName, "Nectar");
  assert.equal(w.websites[0], "www.bltbangkok.com (TH-EN)");
  assert.equal(w.websites.length, 5);
});
t("website variants", () => {
  assert.deepEqual(parseWebsiteText("example.com"), { text: "example.com", vendorName: "", websites: ["example.com"] });
  assert.deepEqual(parseWebsiteText("Vendor only"), { text: "Vendor only", vendorName: "Vendor only", websites: [] });
  assert.deepEqual(parseWebsiteText("  \n A \r\n\n b.co \n"), { text: "A \r\n\n b.co", vendorName: "A", websites: ["b.co"] });
  assert.deepEqual(parseWebsiteText(null), { text: "", vendorName: "", websites: [] });
});

// ── units ──
t("parseUnits", () => {
  assert.equal(parseUnits(30), 30);
  assert.equal(parseUnits(30.9), 30);
  assert.equal(parseUnits("30"), 30);
  assert.equal(parseUnits("30 links"), 30);
  assert.equal(parseUnits("30 ลิงก์"), 30);
  assert.equal(parseUnits(0), null);
  assert.equal(parseUnits("0"), null);
  assert.equal(parseUnits(""), null);
  assert.equal(parseUnits("abc"), null);
  assert.equal(parseUnits(null), null);
});

// ── A1 ──
t("a1Range quoting", () => {
  assert.equal(a1Range("My Tab", 6, 5), "'My Tab'!G5");
  assert.equal(a1Range("My Tab", 6, 5, 10, 7), "'My Tab'!G5:K7");
  assert.equal(a1Range("It's", 0, 1), "'It''s'!A1");
  assert.equal(a1Range("T", 6, 5, 10), "'T'!G5:K5");
  assert.equal(a1Range("T", 6, 5, undefined, 9), "'T'!G5:G9");
});
t("columnLetter", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(27), "AB");
  assert.equal(columnLetter(701), "ZZ");
  assert.equal(columnLetter(702), "AAA");
});

// ── packageStats ──
t("stats expired", () => {
  const p = parseQuotaTab("T", [HEAD, ["News", "", "", 5, "1 Jan 2025", "1 Jan 2026", "u"]])!.packages[0];
  const s = packageStats(p, "2026-11-16");
  assert.equal(s.expired, true);
  assert.equal(s.remaining, 4);
  assert.equal(s.usable, 0);
  assert.equal(packageStats(p, "2026-01-01").expired, false);
});
t("stats reserved", () => {
  const rows: unknown[][] = [
    HEAD,
    ["News", "", "", 5, "", "", "", "", "C", "On Process"],
    ["", "", "", "", "", "", "", "", "D", "On Process"],
    ["", "", "", "", "", "", "https://x", "", "E", "On Process"],
  ];
  const p = parseQuotaTab("T", rows)!.packages[0];
  const s = packageStats(p, "2026-01-01", new Set([0, 1, 2, 3]));
  assert.equal(s.used, 3);
  assert.equal(s.reserved, 2); // ช่อง 2 มีลิงก์แล้ว, ช่อง 3 ไม่ถูกใช้
  assert.equal(packageStats(p, "2026-01-01").reserved, 0);
});
t("stats unknown units", () => {
  const p = parseQuotaTab("T", [HEAD, ["News", "", "", "", "", "", "u"]])!.packages[0];
  const s = packageStats(p, "2026-01-01");
  assert.equal(s.remaining, null);
  assert.equal(s.usable, null);
});

t("last package with empty unit and no used slot: rowCount 0, no slots (still owns its row)", () => {
  const rows: unknown[][] = [
    HEAD,
    ["News", "a.com", "", 2, "", "", "https://x", "", "C", "Published"],
    [],
    ["PR", "b.com", "500", "", "", ""],
  ];
  const parsed = parseQuotaTab("T", rows)!;
  assert.equal(parsed.packages.length, 2);
  const last = parsed.packages[1];
  assert.equal(last.rowNumber, 4);
  assert.equal(last.units, null);
  assert.equal(last.rowCount, 0);
  assert.equal(last.slots.length, 0);
  // ผู้เรียกที่หาแถวสุดท้ายของก้อนต้องนับอย่างน้อย 1 แถว (ดู blockLastRow ใน quota-write.ts)
  assert.equal(last.rowNumber + Math.max(last.rowCount, last.slots.length, 1) - 1, 4);
});

// ── candidate ──
t("isQuotaTabCandidate", () => {
  assert.equal(isQuotaTabCandidate("MarsOS Log"), false);
  assert.equal(isQuotaTabCandidate("  marsos-data"), false);
  assert.equal(isQuotaTabCandidate(""), false);
  assert.equal(isQuotaTabCandidate("   "), false);
  assert.equal(isQuotaTabCandidate("Nectar"), true);
});

console.log(`\n${n} tests passed`);
