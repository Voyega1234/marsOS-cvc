import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEAD_EXPORT_HEADERS,
  attachmentDisposition,
  csvCell,
  leadExportFilename,
  leadsCsv,
  lineStage,
  type LeadExportRow,
} from "./leadExportCsv";

const lead = (over: Partial<LeadExportRow> = {}): LeadExportRow => ({
  createdAt: new Date("2026-11-01T03:04:05.000Z"),
  fullName: "สมชาย ใจดี",
  displayName: "Somchai",
  phone: "0812345678",
  channelGroup: "Paid Search",
  source: "google",
  campaign: "Brand",
  keyword: "cctv",
  status: "NEW",
  value: 1500,
  currency: "THB",
  slipAmount: null,
  salesOwner: null,
  conversionState: "PENDING",
  lineUser: { displayName: "Somchai LINE", friendStatus: "FRIEND", lastMessageAt: null },
  ...over,
});

test("plain cells are written as they are", () => {
  assert.equal(csvCell("Somchai"), "Somchai");
  assert.equal(csvCell(1500), "1500");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("commas, quotes and line breaks are quoted", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("line1\rline2"), '"line1\rline2"');
});

test("a value a spreadsheet would run as a formula gets a leading apostrophe", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
  assert.equal(csvCell("=^_^="), "'=^_^=");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
  assert.equal(csvCell("-2+3+cmd"), "'-2+3+cmd");
  assert.equal(csvCell("\t=1+1"), "'\t=1+1");
});

test("phone numbers and negative numbers keep their sign", () => {
  assert.equal(csvCell("+66812345678"), "+66812345678");
  assert.equal(csvCell("+66 81-234-5678"), "+66 81-234-5678");
  assert.equal(csvCell(-250), "-250");
  assert.equal(csvCell("-250.50"), "-250.50");
});

test("line stage follows the LINE user", () => {
  assert.equal(lineStage(null), "");
  assert.equal(lineStage({ displayName: null, friendStatus: "FRIEND", lastMessageAt: null }), "added");
  assert.equal(lineStage({ displayName: null, friendStatus: "FRIEND", lastMessageAt: new Date() }), "messaged");
  assert.equal(lineStage({ displayName: null, friendStatus: "BLOCKED", lastMessageAt: new Date() }), "blocked");
});

test("the file starts with a BOM and the header row, one line per lead", () => {
  const csv = leadsCsv([lead(), lead({ displayName: null, fullName: null, phone: null, slipAmount: 900, salesOwner: "Aom" })]);
  const lines = csv.split("\n");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].slice(1), LEAD_EXPORT_HEADERS.join(","));
  assert.equal(lines[1], "2026-11-01T03:04:05.000Z,สมชาย ใจดี,Somchai,0812345678,Paid Search,google,Brand,cctv,NEW,1500,THB,,,PENDING,added");
  // No lead display name: the LINE profile name is used.
  assert.equal(lines[2], "2026-11-01T03:04:05.000Z,,Somchai LINE,,Paid Search,google,Brand,cctv,NEW,1500,THB,900,Aom,PENDING,added");
});

test("no leads gives the header row only", () => {
  assert.equal(leadsCsv([]), "\uFEFF" + LEAD_EXPORT_HEADERS.join(","));
});

test("the file name carries the project slug, the channel when one is picked, and the day", () => {
  const day = new Date("2026-11-18T10:00:00.000Z");
  assert.equal(leadExportFilename("kowa-cctv", null, day), "kowa-cctv-leads-2026-11-18.csv");
  assert.equal(leadExportFilename("kowa-cctv", "Paid Search", day), "kowa-cctv-leads-paid-search-2026-11-18.csv");
});

test("a Thai project slug still makes a header value the server accepts", () => {
  const name = leadExportFilename("คลินิก-abc", null, new Date("2026-11-18T10:00:00.000Z"));
  // The raw name is refused as a header value: this is what the download would have hit.
  assert.throws(() => new Headers({ "content-disposition": `attachment; filename="${name}"` }));

  const value = attachmentDisposition(name);
  assert.doesNotThrow(() => new Headers({ "content-disposition": value }));
  assert.equal(
    value,
    `attachment; filename="______-abc-leads-2026-11-18.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
});

test("an ASCII file name is passed through, quotes and backslashes are not", () => {
  assert.equal(
    attachmentDisposition("kowa-cctv-leads-2026-11-18.csv"),
    `attachment; filename="kowa-cctv-leads-2026-11-18.csv"; filename*=UTF-8''kowa-cctv-leads-2026-11-18.csv`,
  );
  assert.ok(attachmentDisposition('a"b\\c.csv').startsWith('attachment; filename="a_b_c.csv"'));
});
