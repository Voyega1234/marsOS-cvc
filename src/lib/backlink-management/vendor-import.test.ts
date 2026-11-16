/** Run: npx tsx src/lib/backlink-management/vendor-import.test.ts */
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { XlsxTooLargeError, checkXlsxArchive, readXlsxSheets } from "./vendor-import-xlsx";
import {
  MAX_CSV_CELL, MAX_CSV_COLS, MAX_CSV_ROWS, decodeCsvBytes,
  MAX_IMPORT_ROWS, csvToSheet, mapHeader, mergeImportRows, parseCsv, parseImportSheets, parsePrice, parseTraffic,
  rowsFromSheet, type ImportCell, type ImportSheet, type VendorImportRow,
} from "./vendor-import";
import { DEFAULT_PRICE_ORDER, PRICE_TYPES, hasDetailValue, pickDefaultPrice, vendorDetailData } from "./vendor-detail";
import { looksLikeDomain, normalizeDomain, safeHttpUrl } from "./domain";
import { buildSheetTables } from "./sheet-tables";

let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log("ok -", name); }
const asyncTests: { name: string; fn: () => Promise<void> }[] = [];
function ta(name: string, fn: () => Promise<void>) { asyncTests.push({ name, fn }); }

const sheet = (name: string, rows: string[][]): ImportSheet => ({ name, grid: rows.map((r) => r.map((c) => ({ text: c }))) });

t("parseCsv: quotes, commas, escaped quotes, newline in quotes, CRLF, BOM", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv('"a,b",c'), [["a,b", "c"]]);
  assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', "x"]]);
  assert.deepEqual(parseCsv('"line1\nline2",x\ny,z'), [["line1\nline2", "x"], ["y", "z"]]);
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("﻿Domain,DR\na.com,5"), [["Domain", "DR"], ["a.com", "5"]]);
  assert.deepEqual(parseCsv("a,,c"), [["a", "", "c"]]);
  assert.deepEqual(parseCsv(""), []);
  const s = csvToSheet("x,y\n1,2", "S");
  assert.equal(s.name, "S");
  assert.deepEqual(s.grid[1], [{ text: "1" }, { text: "2" }]);
});

t("parseTraffic", () => {
  assert.equal(parseTraffic("1234"), 1234);
  assert.equal(parseTraffic("1,234"), 1234);
  assert.equal(parseTraffic("1.2K"), 1200);
  assert.equal(parseTraffic("607k"), 607000);
  assert.equal(parseTraffic("3M"), 3_000_000);
  assert.equal(parseTraffic("23.3M"), 23_300_000);
  assert.equal(parseTraffic("1B"), 1_000_000_000);
  assert.equal(parseTraffic("3B"), null); // over the 2,000,000,000 cap
  assert.equal(parseTraffic("8000 - 15,000"), null);
  assert.equal(parseTraffic("38000 FB Only"), null);
  assert.equal(parseTraffic(""), null);
  assert.equal(parseTraffic("-"), null);
  assert.equal(parseTraffic("abc"), null);
});

t("parsePrice", () => {
  assert.deepEqual(parsePrice("1500"), { value: 1500, clean: true });
  assert.deepEqual(parsePrice("1,500"), { value: 1500, clean: true });
  assert.deepEqual(parsePrice("1,500.50"), { value: 1500.5, clean: true });
  assert.deepEqual(parsePrice("1500 บาท"), { value: 1500, clean: true });
  assert.deepEqual(parsePrice("฿1,500"), { value: 1500, clean: true });
  assert.deepEqual(parsePrice("8000 - 15,000"), { value: 8000, clean: false });
  assert.deepEqual(parsePrice("38000 FB Only"), { value: 38000, clean: false });
  assert.deepEqual(parsePrice("100,000\ninclude 5 web"), { value: 100000, clean: false });
  assert.deepEqual(parsePrice(""), { value: null, clean: true });
  assert.deepEqual(parsePrice("  "), { value: null, clean: true });
  assert.deepEqual(parsePrice("-"), { value: null, clean: true });
  assert.deepEqual(parsePrice("junk"), { value: null, clean: false });
  // Behaviour note: K/M suffixes are NOT supported for price (taken as the leading digits, flagged unclean)
  assert.deepEqual(parsePrice("1.2K"), { value: 1.2, clean: false });
});

t("mapHeader: English headers", () => {
  const headers = ["Domain", "Industry", "LAN", "DR", "UR", "Traffic", "Price (Only Backlink)", "Publisher write WEB", "Publisher write WEB+FB",
    "CVC write WEB", "CVC write WEB + FB", "PR", "Expiration", "Detail", "Rate Card", "Contact / Email", "Remark", "ID"];
  const m = mapHeader([headers.map((text) => ({ text }))]);
  assert.ok(m);
  assert.equal(m.headerRow, 0);
  const c = m.cols;
  assert.deepEqual(
    [c.domain, c.category, c.language, c.dr, c.ur, c.traffic, c.priceBacklink, c.pricePublisherWeb, c.pricePublisherWebFb,
      c.priceCvcWeb, c.priceCvcWebFb, c.pricePr, c.expiration, c.notes, c.rateCard, c.contact, c.remark, c.refId],
    headers.map((_, i) => i),
  );
});

t("mapHeader: Thai export headers", () => {
  const headers = ["โดเมน", "หมวด", "ภาษา", "UR", "Only Backlink", "Publisher write WEB", "Publisher write WEB+FB", "CVC write WEB",
    "CVC write WEB+FB", "PR", "หมายเหตุราคา", "อายุลิงก์", "Rate Card", "สถานะข้อมูล", "รหัสอ้างอิง"];
  const m = mapHeader([headers.map((text) => ({ text }))]);
  assert.ok(m);
  const c = m.cols;
  for (const v of [c.domain, c.category, c.language, c.ur, c.priceBacklink, c.pricePublisherWeb, c.pricePublisherWebFb, c.priceCvcWeb,
    c.priceCvcWebFb, c.pricePr, c.priceNote, c.expiration, c.rateCard, c.remark, c.refId]) assert.notEqual(v, undefined);
  assert.equal(c.priceNote, 10);
  assert.equal(c.refId, 14);
});

t("mapHeader: unknown headers do not map, no domain column = null, header found in rows 0-4 only", () => {
  const m = mapHeader([[{ text: "Domain" }, { text: "Totally Unknown" }, { text: "Another Mystery" }]]);
  assert.ok(m);
  assert.deepEqual(m.cols, { domain: 0 });
  const lt = mapHeader([[{ text: "Domain" }, { text: "Totally Unknown" }, { text: "ประเภทลิงก์" }]]);
  assert.ok(lt);
  assert.deepEqual(lt.cols, { domain: 0, linkType: 2 });
  assert.equal(mapHeader([[{ text: "Foo" }, { text: "Bar" }]]), null);
  const deep: ImportCell[][] = [...Array(5)].map(() => [{ text: "x" }]);
  deep.push([{ text: "Domain" }]);
  assert.equal(mapHeader(deep), null);
  assert.equal(mapHeader([]), null);
});

t("rowsFromSheet: header not on first row, skipped rows, blank rows ignored", () => {
  const s = sheet("Tech", [
    ["Vendor list 2026", ""],
    ["", ""],
    ["Domain", "DR", "Traffic", "Only Backlink"],
    ["https://www.Alpha.com/blog", "55.6", "1.2K", "1,500"],
    ["not a domain", "10", "", "100"],
    ["", "", "", ""],
    ["beta.co.th", "x", "-", "-"],
  ]);
  const res = rowsFromSheet(s);
  assert.ok(res);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].domain, "alpha.com");
  assert.equal(res.rows[0].siteUrl, "https://www.Alpha.com/blog");
  assert.equal(res.rows[0].domainRating, 56);
  assert.equal(res.rows[0].traffic, 1200);
  assert.equal(res.rows[0].priceBacklink, 1500);
  assert.equal(res.rows[0].price, 1500);
  assert.equal(res.rows[1].domain, "beta.co.th");
  assert.equal(res.rows[1].domainRating, null);
  assert.equal(res.rows[1].traffic, null);
  assert.equal(res.rows[1].price, 0);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].row, 5);
  assert.equal(res.skipped[0].sheet, "Tech");
  assert.equal(res.skipped[0].text, "not a domain");
  assert.equal(rowsFromSheet(sheet("none", [["a", "b"], ["1", "2"]])), null);
});

t("rowsFromSheet: hyperlink on domain cell", () => {
  const s: ImportSheet = {
    name: "S",
    grid: [
      [{ text: "Domain" }, { text: "Price" }],
      [{ text: "Click here", link: "https://www.linked-site.com/page" }, { text: "900" }],
      [{ text: "plain.com", link: "https://plain.com/x" }, { text: "10" }],
      [{ text: "Bad link", link: "javascript:alert(1)" }, { text: "10" }],
    ],
  };
  const res = rowsFromSheet(s)!;
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].domain, "linked-site.com");
  assert.equal(res.rows[0].siteUrl, "https://www.linked-site.com/page");
  assert.equal(res.rows[0].price, 900);
  assert.equal(res.rows[1].domain, "plain.com");
  assert.equal(res.rows[1].siteUrl, "https://plain.com/x");
  assert.equal(res.skipped.length, 1);
});

t("rowsFromSheet: no category column uses sheet name; with column uses cell (blank stays blank)", () => {
  const a = rowsFromSheet(sheet("Health", [["Domain"], ["a.com"]]))!;
  assert.equal(a.rows[0].category, "Health");
  const b = rowsFromSheet(sheet("Health", [["Domain", "Industry"], ["a.com", "Travel"], ["b.com", ""]]))!;
  assert.equal(b.rows[0].category, "Travel");
  assert.equal(b.rows[1].category, "");
});

t("rowsFromSheet: unclean price keeps text in priceNote; status/UR/language/contact", () => {
  const res = rowsFromSheet(sheet("S", [
    ["Domain", "LAN", "UR", "Only Backlink", "PR", "Remark", "Contact / Email", "Expiration"],
    ["a.com", "th", "150", "8000 - 15,000", "100,000\ninclude 5 web", "Outdated data", "bob@x.com", "-"],
    ["b.com", "en", "abc", "", "", "Updated", "", "1 year"],
  ]))!;
  const [a, b] = res.rows;
  assert.equal(a.priceBacklink, 8000);
  assert.equal(a.pricePr, 100000);
  assert.equal(a.priceNote, "Only Backlink: 8000 - 15,000 | PR: 100,000 include 5 web");
  assert.equal(a.urlRating, 100);
  assert.equal(a.language, "TH");
  assert.equal(a.dataStatus, "OUTDATED");
  assert.equal(a.contactChannel, "bob@x.com");
  assert.equal(a.expiration, "");
  assert.equal(b.urlRating, null);
  assert.equal(b.dataStatus, "UPDATED");
  assert.equal(b.expiration, "1 year");
});

function rollupWorkbook(): ImportSheet[] {
  return [
    sheet("All", [
      ["Domain", "Industry", "Traffic", "Only Backlink", "Contact / Email"],
      ["a.com", "Tech", "5000", "1000", "rollup@x.com"],
      ["b.com", "Health", "7000", "300", ""],
      ["c.com", "Tech", "900", "250", "c@x.com"],
    ]),
    sheet("Tech", [
      ["Domain", "Only Backlink", "Contact / Email", "Traffic"],
      ["a.com", "2000", "tech@x.com", ""],
    ]),
    sheet("Health", [
      ["Domain", "Only Backlink"],
      ["b.com", "350"],
      ["d.com", "400"],
    ]),
  ];
}

t("parseImportSheets: sub-sheets win over roll-up, roll-up fills blanks, conflicts reported", () => {
  const res = parseImportSheets(rollupWorkbook());
  const by = new Map(res.rows.map((r) => [r.domain, r]));
  assert.equal(res.rows.length, 4);
  const a = by.get("a.com")!;
  assert.equal(a.priceBacklink, 2000);
  assert.equal(a.price, 2000);
  assert.equal(a.contactChannel, "tech@x.com");
  assert.equal(a.traffic, 5000); // filled from roll-up
  assert.equal(a.category, "Tech");
  assert.equal(a.sheet, "Tech");
  const b = by.get("b.com")!;
  assert.equal(b.priceBacklink, 350);
  assert.equal(b.traffic, 7000);
  // only in roll-up -> still imported
  const c = by.get("c.com")!;
  assert.equal(c.priceBacklink, 250);
  assert.equal(c.category, "Tech");
  assert.equal(c.sheet, "All");
  assert.equal(by.get("d.com")!.priceBacklink, 400);

  const fields = res.conflicts.map((x) => `${x.domain}:${x.field}`).sort();
  assert.deepEqual(fields, ["a.com:contactChannel", "a.com:priceBacklink", "b.com:priceBacklink"]);
  const cp = res.conflicts.find((x) => x.domain === "a.com" && x.field === "priceBacklink")!;
  assert.equal(cp.kept, "2000");
  assert.equal(cp.other, "1000");
  assert.equal(cp.sheet, "All");
  assert.equal(res.truncated, false);
  assert.deepEqual(res.ignoredSheets, []);
});

t("parseImportSheets: sheets info (workbook order, rollup flag, count, added)", () => {
  const res = parseImportSheets(rollupWorkbook());
  assert.deepEqual(res.sheets, [
    { name: "All", count: 3, added: 1, rollup: true },
    { name: "Tech", count: 1, added: 1, rollup: false },
    { name: "Health", count: 2, added: 2, rollup: false },
  ]);
});

t("parseImportSheets: ignored sheets, skipped rows, empty sheet, truncation", () => {
  const res = parseImportSheets([
    sheet("Notes", [["hello", "world"]]),
    sheet("Empty", [["Domain"]]),
    sheet("Tech", [["Domain"], ["a.com"], ["bad"]]),
  ]);
  assert.deepEqual(res.ignoredSheets, ["Notes"]);
  assert.deepEqual(res.sheets.map((s) => s.name), ["Tech"]);
  assert.equal(res.skipped.length, 1);
  const big = [["Domain"], ...Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => [`site${i}.com`])];
  const r2 = parseImportSheets([sheet("Big", big)]);
  assert.equal(r2.truncated, true);
  assert.equal(r2.rows.length, MAX_IMPORT_ROWS);
});

function vrow(o: Partial<VendorImportRow>): VendorImportRow {
  return {
    domain: "x.com", siteUrl: "", category: "", price: 0, domainRating: null, traffic: null, contactName: "", contactChannel: "", notes: "",
    sheet: "S", language: "", urlRating: null, priceBacklink: null, pricePublisherWeb: null, pricePublisherWebFb: null, priceCvcWeb: null,
    priceCvcWebFb: null, pricePr: null, priceNote: "", expiration: "", rateCardUrl: "", dataStatus: "", refId: "", ...o,
  };
}

t("mergeImportRows: duplicate domain in one sheet merges to one row, first wins, blanks filled", () => {
  const res = parseImportSheets([sheet("S", [
    ["Domain", "DR", "Only Backlink", "Contact / Email"],
    ["dup.com", "", "500", ""],
    ["https://www.dup.com/", "40", "900", "me@x.com"],
  ])]);
  assert.equal(res.rows.length, 1);
  const r = res.rows[0];
  assert.equal(r.priceBacklink, 500);
  assert.equal(r.domainRating, 40);
  assert.equal(r.contactChannel, "me@x.com");
  assert.deepEqual(res.conflicts.map((c) => c.field), ["priceBacklink"]);

  const m = mergeImportRows([vrow({ domain: "z.com", price: 0 }), vrow({ domain: "z.com", pricePr: 70 })]);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].pricePr, 70);
  assert.equal(m.rows[0].price, 70); // empty price is recomputed from merged detail prices
  assert.equal(m.conflicts.length, 0);
});

t("mapHeader: domain aliases (domains, website, เว็บไซต์, เว็บ)", () => {
  for (const h of ["Domains", "Website", "เว็บไซต์", "เว็บ"]) {
    const m = mapHeader([[{ text: h }, { text: "DR" }]]);
    assert.ok(m, h);
    assert.equal(m.cols.domain, 0, h);
    assert.equal(m.cols.dr, 1, h);
  }
});

t("mergeImportRows: string prefix -> longer kept, no conflict (shorter first)", () => {
  const m = mergeImportRows([vrow({ domain: "p.com", notes: "Link" }), vrow({ domain: "p.com", notes: "Link\nhttps://example.com/x" })]);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].notes, "Link\nhttps://example.com/x");
  assert.equal(m.conflicts.length, 0);
});

t("mergeImportRows: string prefix -> longer kept, no conflict (longer first)", () => {
  const m = mergeImportRows([vrow({ domain: "p.com", notes: "Link\nhttps://example.com/x" }), vrow({ domain: "p.com", notes: "Link" })]);
  assert.equal(m.rows[0].notes, "Link\nhttps://example.com/x");
  assert.equal(m.conflicts.length, 0);
});

t("mergeImportRows: non-prefix strings -> first kept, one conflict", () => {
  const m = mergeImportRows([vrow({ domain: "p.com", notes: "abc" }), vrow({ domain: "p.com", notes: "xyz" })]);
  assert.equal(m.rows[0].notes, "abc");
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.conflicts[0].field, "notes");
  assert.equal(m.conflicts[0].kept, "abc");
  assert.equal(m.conflicts[0].other, "xyz");
});

t("pickDefaultPrice follows DEFAULT_PRICE_ORDER", () => {
  assert.deepEqual(DEFAULT_PRICE_ORDER, ["priceBacklink", "priceCvcWeb", "pricePublisherWeb", "priceCvcWebFb", "pricePublisherWebFb", "pricePr"]);
  assert.equal(pickDefaultPrice({}), 0);
  assert.equal(pickDefaultPrice({ pricePr: 9 }), 9);
  assert.equal(pickDefaultPrice({ pricePr: 9, pricePublisherWebFb: 8 }), 8);
  assert.equal(pickDefaultPrice({ pricePr: 9, pricePublisherWebFb: 8, priceCvcWebFb: 7 }), 7);
  assert.equal(pickDefaultPrice({ pricePublisherWeb: 6, priceCvcWebFb: 7 }), 6);
  assert.equal(pickDefaultPrice({ priceCvcWeb: 5, pricePublisherWeb: 6 }), 5);
  assert.equal(pickDefaultPrice({ priceBacklink: 4, priceCvcWeb: 5 }), 4);
  assert.equal(pickDefaultPrice({ priceBacklink: 0, priceCvcWeb: 5 }), 5);
  assert.equal(pickDefaultPrice({ priceBacklink: null, priceCvcWeb: NaN, pricePr: 1 }), 1);
  assert.equal(PRICE_TYPES.length, 6);
});

t("vendorDetailData returns only provided keys and sanitises", () => {
  assert.deepEqual(vendorDetailData({}), {});
  assert.deepEqual(vendorDetailData({ language: "  TH  " }), { language: "TH" });
  assert.equal(vendorDetailData({ urlRating: 250 }).urlRating, 100);
  assert.equal(vendorDetailData({ urlRating: "" }).urlRating, null);
  assert.equal(vendorDetailData({ priceBacklink: -5 }).priceBacklink, null);
  assert.equal(vendorDetailData({ priceBacklink: "abc" }).priceBacklink, null);
  assert.equal(vendorDetailData({ priceBacklink: "1200" }).priceBacklink, 1200);
  assert.equal(vendorDetailData({ rateCardUrl: "javascript:alert(1)" }).rateCardUrl, "");
  assert.equal(vendorDetailData({ rateCardUrl: "https://a.com/rc" }).rateCardUrl, "https://a.com/rc");
  assert.equal(vendorDetailData({ dataStatus: "BOGUS" }).dataStatus, "");
  assert.equal(vendorDetailData({ dataStatus: "UPDATED" }).dataStatus, "UPDATED");
  assert.equal(vendorDetailData({ refId: 123 }).refId, "123");
  assert.equal(vendorDetailData({ priceNote: "x".repeat(900) }).priceNote!.length, 500);
  assert.equal(vendorDetailData({ expiration: "x".repeat(900) }).expiration!.length, 300);
  assert.deepEqual(Object.keys(vendorDetailData({ language: "a", unknown: 1 })), ["language"]);
});

t("hasDetailValue", () => {
  assert.equal(hasDetailValue({}), false);
  assert.equal(hasDetailValue({ language: "", urlRating: null, priceNote: "" }), false);
  assert.equal(hasDetailValue({ language: "TH" }), true);
  assert.equal(hasDetailValue({ pricePr: 0 }), true);
  assert.equal(hasDetailValue({ urlRating: null, refId: "A1" }), true);
});

t("normalizeDomain / looksLikeDomain / safeHttpUrl", () => {
  assert.equal(normalizeDomain("  HTTPS://WWW.Example.COM/path?q=1#h "), "example.com");
  assert.equal(normalizeDomain("http://sub.example.com:8080/x"), "sub.example.com");
  assert.equal(normalizeDomain("example.com/"), "example.com");
  assert.equal(normalizeDomain("www.example.com"), "example.com");
  assert.equal(looksLikeDomain("example.com"), true);
  assert.equal(looksLikeDomain("a-b.co.th"), true);
  assert.equal(looksLikeDomain("localhost"), false);
  assert.equal(looksLikeDomain("has space.com"), false);
  assert.equal(looksLikeDomain("a.c"), false);
  assert.equal(looksLikeDomain("a.123"), false);
  assert.equal(looksLikeDomain(""), false);
  assert.equal(safeHttpUrl("https://a.com/x"), "https://a.com/x");
  assert.equal(safeHttpUrl("  http://a.com  "), "http://a.com");
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("data:text/html,x"), "");
  assert.equal(safeHttpUrl("ftp://a.com"), "");
  assert.equal(safeHttpUrl("a.com"), "");
  assert.equal(safeHttpUrl("https://"), "");
  assert.equal(safeHttpUrl(123), "");
  assert.equal(safeHttpUrl(null), "");
  assert.equal(safeHttpUrl("https://a.com/" + "x".repeat(1000)), "");
  assert.equal(safeHttpUrl("https://a.com/" + "x".repeat(50), 20), "");
});

t("round trip: sheet-tables vendor table -> rowsFromSheet / parseImportSheets", () => {
  const [, vt] = buildSheetTables({
    requests: [], budgets: [],
    vendors: [{
      domain: "round.com", siteUrl: "https://round.com/blog", category: "Finance", price: 500, currency: "THB", domainRating: 61, traffic: 12000,
      linkType: "dofollow", contactName: "Som", contactChannel: "som@round.com", notes: "good site", status: "ACTIVE",
      updatedAt: new Date("2026-11-01T00:00:00Z"),
      language: "th", urlRating: 45, priceBacklink: 500, pricePublisherWeb: 600, pricePublisherWebFb: 700, priceCvcWeb: 800,
      priceCvcWebFb: 900, pricePr: 1000, priceNote: "promo", expiration: "12 months", rateCardUrl: "https://round.com/rate",
      dataStatus: "UPDATED", refId: "REF-9",
    }],
  });
  const imp: ImportSheet = {
    name: "Vendors",
    grid: [vt.header, ...vt.rows].map((r) => r.map((v) => ({ text: String(v) }))),
  };
  const check = (r: VendorImportRow) => {
    assert.equal(r.domain, "round.com");
    assert.equal(r.siteUrl, "https://round.com/blog");
    assert.equal(r.category, "Finance");
    assert.equal(r.priceBacklink, 500);
    assert.equal(r.pricePublisherWeb, 600);
    assert.equal(r.pricePublisherWebFb, 700);
    assert.equal(r.priceCvcWeb, 800);
    assert.equal(r.priceCvcWebFb, 900);
    assert.equal(r.pricePr, 1000);
    assert.equal(r.price, 500);
    assert.equal(r.language, "TH");
    assert.equal(r.urlRating, 45);
    assert.equal(r.domainRating, 61);
    assert.equal(r.traffic, 12000);
    assert.equal(r.expiration, "12 months");
    assert.equal(r.rateCardUrl, "https://round.com/rate");
    assert.equal(r.dataStatus, "UPDATED");
    assert.equal(r.refId, "REF-9");
    assert.equal(r.contactName, "Som");
    assert.equal(r.contactChannel, "som@round.com");
    assert.equal(r.notes, "good site");
    assert.equal(r.priceNote, "promo");
  };
  const res = rowsFromSheet(imp)!;
  assert.equal(res.rows.length, 1);
  assert.equal(res.skipped.length, 0);
  check(res.rows[0]);
  const all = parseImportSheets([imp]);
  assert.equal(all.rows.length, 1);
  check(all.rows[0]);
  assert.equal(all.conflicts.length, 0);
});

t("parseCsv: caps rows, columns and cell length; normal input unchanged", () => {
  assert.equal(MAX_CSV_ROWS, 5000);
  assert.equal(MAX_CSV_COLS, 60);
  assert.equal(MAX_CSV_CELL, 5000);
  const many = Array.from({ length: MAX_CSV_ROWS + 50 }, (_, i) => `r${i},x`).join("\n");
  const rows = parseCsv(many);
  assert.equal(rows.length, MAX_CSV_ROWS);
  assert.deepEqual(rows[0], ["r0", "x"]);
  assert.deepEqual(rows[MAX_CSV_ROWS - 1], [`r${MAX_CSV_ROWS - 1}`, "x"]);
  const wide = parseCsv(Array.from({ length: 100 }, (_, i) => `c${i}`).join(","));
  assert.equal(wide.length, 1);
  assert.equal(wide[0].length, MAX_CSV_COLS);
  assert.equal(wide[0][MAX_CSV_COLS - 1], `c${MAX_CSV_COLS - 1}`);
  const big = "x".repeat(6000);
  assert.equal(parseCsv(`${big},b`)[0][0].length, MAX_CSV_CELL);
  assert.equal(parseCsv(`"${big}",b`)[0][0].length, MAX_CSV_CELL);
  assert.equal(parseCsv(`"${big}",b`)[0][1], "b");
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

t("decodeCsvBytes: UTF-8, windows-874 fallback, ArrayBuffer and Uint8Array", () => {
  const thai = "โดเมน";
  const utf8 = new TextEncoder().encode(thai);
  assert.equal(decodeCsvBytes(utf8), thai);
  const ab = utf8.buffer.slice(utf8.byteOffset, utf8.byteOffset + utf8.byteLength) as ArrayBuffer;
  assert.equal(decodeCsvBytes(ab), thai);
  const cp874 = Uint8Array.from([0xe2, 0xb4, 0xe0, 0xc1, 0xb9]);
  assert.equal(decodeCsvBytes(cp874), thai);
  const cpAb = cp874.buffer.slice(cp874.byteOffset, cp874.byteOffset + cp874.byteLength) as ArrayBuffer;
  assert.equal(decodeCsvBytes(cpAb), thai);
});

t("mapHeader: strong (Domain) vs weak (Website / Name) domain headers", () => {
  const map = (...hs: string[]) => mapHeader([hs.map((text) => ({ text }))])!;
  assert.equal(map("Name", "Domain").cols.domain, 1);
  const wd = map("Website", "Domain");
  assert.equal(wd.cols.domain, 1);
  assert.equal(wd.cols.siteUrl, 0);
  const wdu = map("Website", "Domain", "URL");
  assert.equal(wdu.cols.domain, 1);
  assert.equal(wdu.cols.siteUrl, 2);
  assert.equal(map("Name", "Website").cols.domain, 1);
  assert.equal(map("Name").cols.domain, 0);
  assert.equal(map("เว็บไซต์").cols.domain, 0);
});

t("mapHeader: status and link type headers", () => {
  for (const h of ["สถานะ", "Status"]) assert.equal(mapHeader([[{ text: "Domain" }, { text: h }]])!.cols.status, 1, h);
  for (const h of ["ประเภทลิงก์", "Link Type"]) assert.equal(mapHeader([[{ text: "Domain" }, { text: h }]])!.cols.linkType, 1, h);
});

t("rowsFromSheet: status / linkType normalised; unknown values give no key", () => {
  const res = rowsFromSheet(sheet("S", [
    ["Domain", "Status", "Link Type"],
    ["a.com", "ACTIVE", "Dofollow"],
    ["b.com", "inactive", "NOFOLLOW"],
    ["c.com", "Updated", "ugc"],
    ["d.com", "", ""],
  ]))!;
  const [a, b, c, d] = res.rows;
  assert.equal(a.status, "ACTIVE");
  assert.equal(a.linkType, "dofollow");
  assert.equal(b.status, "INACTIVE");
  assert.equal(b.linkType, "nofollow");
  for (const r of [c, d]) {
    assert.equal("status" in r, false);
    assert.equal("linkType" in r, false);
  }
});

t("rowsFromSheet: categoryInferred", () => {
  const a = rowsFromSheet(sheet("Webboard", [["Domain"], ["a.com"]]))!.rows[0];
  assert.equal(a.category, "Webboard");
  assert.equal(a.categoryInferred, true);
  const b = rowsFromSheet(sheet("Webboard", [["Domain", "Industry"], ["a.com", "Travel"], ["b.com", ""]]))!.rows;
  assert.equal(b[0].category, "Travel");
  assert.equal("categoryInferred" in b[0], false);
  assert.equal(b[1].category, "");
  assert.equal("categoryInferred" in b[1], false);
});

t("rowsFromSheet: priceInferred", () => {
  const a = rowsFromSheet(sheet("S", [["Domain", "Only Backlink"], ["a.com", "1500"]]))!.rows[0];
  assert.equal(a.price, 1500);
  assert.equal(a.priceInferred, true);
  const b = rowsFromSheet(sheet("S", [["Domain", "ราคา", "Only Backlink"], ["a.com", "", "1500"], ["b.com", "0", "1500"]]))!.rows;
  for (const r of b) { assert.equal(r.price, 1500); assert.equal(r.priceInferred, true); }
  const c = rowsFromSheet(sheet("S", [["Domain", "ราคา"], ["a.com", "2000"]]))!.rows[0];
  assert.equal(c.price, 2000);
  assert.equal("priceInferred" in c, false);
  const d = rowsFromSheet(sheet("S", [["Domain", "ราคา"], ["a.com", ""]]))!.rows[0];
  assert.equal(d.price, 0);
  assert.equal("priceInferred" in d, false);
});

t("mergeImportRows: inferred flags, status and linkType", () => {
  // (a) blank category filled by an inferred category -> flag follows
  let m = mergeImportRows([vrow({ domain: "m.com", category: "" }), vrow({ domain: "m.com", category: "Tech", categoryInferred: true })]);
  assert.equal(m.rows[0].category, "Tech");
  assert.equal(m.rows[0].categoryInferred, true);
  // (b) filled by an explicit category -> no flag
  m = mergeImportRows([vrow({ domain: "m.com", category: "" }), vrow({ domain: "m.com", category: "Tech" })]);
  assert.equal(m.rows[0].category, "Tech");
  assert.equal("categoryInferred" in m.rows[0], false);
  // (c) explicit price kept over inferred
  m = mergeImportRows([vrow({ domain: "m.com", price: 2000 }), vrow({ domain: "m.com", price: 1500, priceInferred: true })]);
  assert.equal(m.rows[0].price, 2000);
  assert.equal("priceInferred" in m.rows[0], false);
  // (d) price 0 filled from a later inferred row
  m = mergeImportRows([vrow({ domain: "m.com", price: 0 }), vrow({ domain: "m.com", price: 1500, priceBacklink: 1500, priceInferred: true })]);
  assert.equal(m.rows[0].price, 1500);
  assert.equal(m.rows[0].priceInferred, true);
  // (e) status / linkType filled from a later row
  m = mergeImportRows([vrow({ domain: "m.com" }), vrow({ domain: "m.com", status: "INACTIVE", linkType: "sponsored" })]);
  assert.equal(m.rows[0].status, "INACTIVE");
  assert.equal(m.rows[0].linkType, "sponsored");
});

async function xlsxBytes(rows: string[][], sheetName = "A"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

ta("checkXlsxArchive: small workbook ok, over limit throws, bad input throws", async () => {
  const small = await xlsxBytes([["Domain"]]);
  assert.ok(checkXlsxArchive(small) > 0);
  assert.ok(checkXlsxArchive(new Uint8Array(small)) > 0);
  assert.throws(() => checkXlsxArchive(small, 100), XlsxTooLargeError);

  const long = "abcdefghij".repeat(100);
  const bigRows = Array.from({ length: 3000 }, (_, i) => [`${i}-${long}`]); // unique per row: shared strings dedupe repeats
  const big = await xlsxBytes(bigRows);
  const unpacked = checkXlsxArchive(big);
  assert.ok(unpacked > 1_000_000);
  assert.throws(() => checkXlsxArchive(big, Math.floor(unpacked / 2)), XlsxTooLargeError);

  const junk = Buffer.from("not a zip at all, just text ".repeat(10));
  assert.throws(() => checkXlsxArchive(junk), (e: unknown) => e instanceof Error && !(e instanceof XlsxTooLargeError));
  assert.throws(() => checkXlsxArchive(Buffer.alloc(0)), Error);

  const patched = Buffer.from(small);
  let eocd = -1;
  for (let i = patched.length - 22; i >= 0; i--) {
    if (patched[i] === 0x50 && patched[i + 1] === 0x4b && patched[i + 2] === 0x05 && patched[i + 3] === 0x06) { eocd = i; break; }
  }
  assert.ok(eocd >= 0);
  patched.writeUInt16LE(0xffff, eocd + 10);
  assert.throws(() => checkXlsxArchive(patched), XlsxTooLargeError);
});

ta("readXlsxSheets: small workbook still read end to end", async () => {
  const buf = await xlsxBytes([["Domain"]]);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const res = await readXlsxSheets(ab);
  assert.equal(res.sheets.length, 1);
  assert.equal(res.sheets[0].name, "A");
  assert.equal(res.sheets[0].grid[0][0].text, "Domain");
});

(async () => {
  for (const { name, fn } of asyncTests) { await fn(); n++; console.log("ok -", name); }
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
