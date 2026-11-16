/** Run: npx tsx src/lib/backlink-management/quota-server.test.ts */
import assert from "node:assert/strict";
import { parseQuotaTab } from "./quota-sheet";
import {
  QuotaError, mayGrow, newPackageStartRow, packageUpdates, planBlockGrowth, planSlot, readPackageInput, readReservationInput,
  readSlotInput, reservationClearUpdates, slotUpdates, standardHeaderUpdate, mergePackageRequests, isBlankGrid,
  findOverwrites, assertOverwritesApproved, readConfirmOverwrite,
  MERGE_SKIPPED_MSG, blockLastRow, matchPackages, packageCellsHaveData, packageFingerprint,
} from "./quota-write";
import { FakeSheetsPort, FAKE_HEADER } from "./quota-fake-port";

let n = 0;
async function t(name: string, fn: () => void | Promise<void>) { await fn(); n++; console.log("ok -", name); }

const TAB = "Pkg A";
const COLS = { type: 0, website: 1, price: 2, unit: 3, start: 4, expire: 5, linkUrl: 6, publishedDate: 7, client: 8, status: 9, remark: 10 };

/** แท็บ 2 แพ็กเกจ: A = 3 แถว (ใช้ 1), B = 2 แถว (สุดท้าย) */
function sample(): FakeSheetsPort {
  const p = new FakeSheetsPort();
  p.addTab(TAB, [
    FAKE_HEADER,
    ["Guest", "a.com", "฿1000", 3, "", "", "http://x/1", "", "Acme", "Published", ""],
    [],
    [],
    ["PR", "b.com", "฿500", 2, "", ""],
    [],
  ], 6);
  return p;
}
async function parse(p: FakeSheetsPort) {
  const rows = (await p.readTabs("id", [TAB]))[TAB];
  const parsed = parseQuotaTab(TAB, rows);
  assert.ok(parsed);
  return parsed;
}

async function main() {
  await t("slotUpdates: modes + only provided fields", () => {
    const u = slotUpdates(TAB, COLS, 5, { linkUrl: "http://a", publishedDate: "2026-11-03", client: "C", status: "On Process", remark: "" });
    assert.equal(u.length, 5);
    const by = Object.fromEntries(u.map((x) => [x.range, x]));
    assert.equal(by["'Pkg A'!G5"].mode, "RAW");
    assert.equal(by["'Pkg A'!H5"].mode, "USER_ENTERED");
    assert.deepEqual(by["'Pkg A'!H5"].values, [["3 November 2026"]]);
    assert.deepEqual(by["'Pkg A'!K5"].values, [[""]]);
    assert.equal(slotUpdates(TAB, COLS, 5, { client: "x" }).length, 1);
    assert.deepEqual(slotUpdates(TAB, COLS, 5, { publishedDate: "" })[0].values, [[""]]);
  });
  await t("packageUpdates: units number, short dates, null clears", () => {
    const u = packageUpdates(TAB, COLS, 2, { units: 5, startDate: "2026-11-01", expireDate: "", type: "Guest" });
    const by = Object.fromEntries(u.map((x) => [x.range, x]));
    assert.deepEqual(by["'Pkg A'!D2"].values, [[5]]);
    assert.equal(by["'Pkg A'!D2"].mode, "RAW");
    assert.deepEqual(by["'Pkg A'!E2"].values, [["1 Nov 2026"]]);
    assert.equal(by["'Pkg A'!E2"].mode, "USER_ENTERED");
    assert.deepEqual(by["'Pkg A'!F2"].values, [[""]]);
    assert.deepEqual(packageUpdates(TAB, COLS, 2, { units: null })[0].values, [[""]]);
  });
  await t("bad date -> 400; missing column -> 400 with header name", () => {
    assert.throws(() => slotUpdates(TAB, COLS, 5, { publishedDate: "03/11/2026" }), (e) => e instanceof QuotaError && e.status === 400);
    const { remark: _r, ...noRemark } = COLS; void _r;
    assert.throws(() => slotUpdates(TAB, noRemark, 5, { remark: "x" }), (e) => e instanceof QuotaError && e.status === 400 && e.message === "ชีทนี้ไม่มีคอลัมน์ REMARK");
    assert.equal(reservationClearUpdates(TAB, noRemark, 5).length, 3);
  });
  await t("readers reject wrong types and trim/cap", () => {
    assert.throws(() => readSlotInput({ linkUrl: 5 }), QuotaError);
    assert.throws(() => readPackageInput({ units: "5" }), QuotaError);
    assert.equal(readPackageInput({ units: null }).units, null);
    assert.equal(readSlotInput({ remark: "  hi  " }).remark, "hi");
    assert.equal(readSlotInput({ remark: "x".repeat(5000) }).remark?.length, 2000);
    assert.throws(() => readReservationInput({ slotIndex: -1 }), QuotaError);
    assert.deepEqual(readSlotInput(null), {});
  });
  await t("new package start row / header", async () => {
    const parsed = await parse(sample());
    assert.equal(newPackageStartRow(parsed.headerRow, parsed.packages), 7);
    assert.equal(newPackageStartRow(1, []), 2);
    const h = standardHeaderUpdate(TAB);
    assert.equal(h.update.range, "'Pkg A'!A1:K1");
    assert.equal(h.update.values[0][5], "EXP.");
    assert.equal(h.columns.remark, 10);
    assert.ok(isBlankGrid([[], ["", null]]));
    assert.ok(!isBlankGrid([[], ["x"]]));
  });
  await t("planSlot: middle package insert row targets next package", async () => {
    const parsed = await parse(sample());
    const [a, b] = parsed.packages;
    assert.equal(a.slots.length, 3);
    assert.equal(planSlot(a, b, 1, 6)?.row, 3);
    assert.equal(planSlot(a, b, 3, 6), null); // เต็ม Unit แล้ว
    assert.equal(mayGrow(b, true), false);
    // ขยาย Unit ของ A เป็น 4 แล้ว (จำลอง) -> ต้องแทรกก่อนแพ็กเกจ B (แถว 5 -> index 4)
    const grown = { ...a, units: 4 };
    assert.deepEqual(planSlot(grown, b, 3, 6), { row: 5, appendRows: 0, insertAt0: 4 });
    assert.equal(planSlot(a, b, 9, 6), null);
  });
  await t("planSlot: last package beyond grid appends rows", async () => {
    const parsed = await parse(sample());
    const b = parsed.packages[1];
    assert.deepEqual(planSlot(b, null, 1, 5), { row: 6, appendRows: 1, insertAt0: null });
    assert.deepEqual(planSlot({ ...b, units: null }, null, 2, 6), { row: 7, appendRows: 1, insertAt0: null });
  });
  await t("planBlockGrowth", async () => {
    const parsed = await parse(sample());
    const [a, b] = parsed.packages;
    assert.deepEqual(planBlockGrowth(a, b, 6, 5), { appendRows: 0, insertAt0: 4, insertCount: 2, newRowCount: 5 });
    assert.deepEqual(planBlockGrowth(b, null, 6, 4), { appendRows: 2, insertAt0: null, insertCount: 0, newRowCount: 4 });
    assert.equal(planBlockGrowth(a, b, 6, 2).insertCount, 0);
  });
  await t("mergePackageRequests: 6 columns, none for 1 row", () => {
    const r = mergePackageRequests(100, COLS, 7, 4) as { mergeCells: { range: { startRowIndex: number; endRowIndex: number }; mergeType: string } }[];
    assert.equal(r.length, 6);
    assert.equal(r[0].mergeCells.range.startRowIndex, 6);
    assert.equal(r[0].mergeCells.range.endRowIndex, 10);
    assert.equal(r[0].mergeCells.mergeType, "MERGE_ALL");
    assert.equal(mergePackageRequests(100, COLS, 7, 1).length, 0);
  });
  await t("fake port: A1 writes, insert/append rows, other requests recorded", async () => {
    const p = sample();
    await p.writeCells("id", [{ range: "'Pkg A'!I3", values: [["Beta"]], mode: "RAW" }]);
    assert.equal(p.cell(TAB, 3, 8), "Beta");
    await p.batchUpdate("id", [{ insertDimension: { range: { sheetId: p.tab(TAB).sheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, inheritFromBefore: true } }]);
    assert.equal(p.tab(TAB).rowCount, 7);
    assert.equal(p.cell(TAB, 6, 0), "PR"); // แพ็กเกจ B ถูกดันลง 1 แถว
    await p.batchUpdate("id", [{ appendDimension: { sheetId: p.tab(TAB).sheetId, dimension: "ROWS", length: 3 } }, { mergeCells: {} }]);
    assert.equal(p.tab(TAB).rowCount, 10);
    assert.equal(p.other.length, 1);
    const q = parseQuotaTab(TAB, (await p.readTabs("id", [TAB]))[TAB]);
    assert.equal(q?.packages[1].rowNumber, 6);
  });
  const rawRows = async (p: FakeSheetsPort) => (await p.readTabs("id", [TAB]))[TAB];
  const cellUpd = (range: string, v: string | number) => ({ range, values: [[v]], mode: "RAW" as const });
  const serial = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;

  await t("findOverwrites: changing a filled cell is detected", async () => {
    const rows = await rawRows(sample());
    const o = findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I2", "Beta")]);
    assert.equal(o.length, 1);
    assert.equal(o[0].cell, "I2");
    assert.equal(o[0].tabTitle, TAB);
    assert.equal(o[0].oldValue, "Acme");
    assert.equal(o[0].newValue, "Beta");
    assert.equal(o[0].header, "Clients");
    assert.ok(o[0].key.includes("Acme") && o[0].key.includes("Beta"));
  });
  await t("findOverwrites: same value -> none", async () => {
    const rows = await rawRows(sample());
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I2", "Acme")]), []);
  });
  await t("findOverwrites: filling a blank cell -> none", async () => {
    const rows = await rawRows(sample());
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I3", "Beta"), cellUpd("'Pkg A'!K2", "note")]), []);
  });
  await t("findOverwrites: clearing a filled cell -> overwrite with empty newValue", async () => {
    const rows = await rawRows(sample());
    const o = findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I2", "")]);
    assert.equal(o.length, 1);
    assert.equal(o[0].newValue, "");
    assert.equal(o[0].oldValue, "Acme");
  });
  await t("findOverwrites: date column compares by calendar day", async () => {
    const rows = await rawRows(sample());
    rows[1][7] = serial(2026, 11, 3); // Published Date เป็นเลข serial
    const same = findOverwrites(TAB, COLS, rows, [{ range: "'Pkg A'!H2", values: [["3 November 2026"]], mode: "USER_ENTERED" }]);
    assert.deepEqual(same, []);
    const diff = findOverwrites(TAB, COLS, rows, [{ range: "'Pkg A'!H2", values: [["4 November 2026"]], mode: "USER_ENTERED" }]);
    assert.equal(diff.length, 1);
    assert.equal(diff[0].cell, "H2");
    rows[1][4] = serial(2026, 11, 1); // Start
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [{ range: "'Pkg A'!E2", values: [["1 Nov 2026"]], mode: "USER_ENTERED" }]), []);
  });
  await t("findOverwrites: unit compared numerically", async () => {
    const rows = await rawRows(sample());
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!D2", 3)]), []);
    const o = findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!D2", 5)]);
    assert.equal(o.length, 1);
    assert.equal(o[0].oldValue, "3");
    assert.equal(o[0].newValue, "5");
  });
  await t("findOverwrites: multi-cell range is skipped", async () => {
    const rows = await rawRows(sample());
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [standardHeaderUpdate(TAB).update]), []);
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [{ range: "'Pkg A'!A1:K1", values: [["x"]], mode: "RAW" }]), []);
  });
  await t("assertOverwritesApproved: empty / approved / partial / stale", async () => {
    const rows = await rawRows(sample());
    assertOverwritesApproved([], undefined);
    assertOverwritesApproved([], []);
    const list = findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I2", "Beta"), cellUpd("'Pkg A'!D2", 9)]);
    assert.equal(list.length, 2);
    assert.throws(() => assertOverwritesApproved(list, undefined), (e) => e instanceof QuotaError && e.status === 409 && e.overwrites?.length === 2);
    assert.throws(() => assertOverwritesApproved(list, []), (e) => e instanceof QuotaError && e.status === 409);
    assertOverwritesApproved(list, list.map((o) => o.key));
    assert.throws(() => assertOverwritesApproved(list, [list[0].key]), (e) => e instanceof QuotaError && e.status === 409 && e.overwrites === list);
    // key เก่า (คำนวณจากค่าเดิมอีกค่า) ต้องใช้ไม่ได้
    rows[1][8] = "Changed";
    const fresh = findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I2", "Beta")]);
    assert.notEqual(fresh[0].key, list[0].key);
    assert.throws(() => assertOverwritesApproved(fresh, [list[0].key]), (e) => e instanceof QuotaError && e.status === 409 && e.overwrites?.[0].oldValue === "Changed");
  });
  await t("readConfirmOverwrite: non-array, mixed types, cap 500", () => {
    assert.deepEqual(readConfirmOverwrite(undefined), []);
    assert.deepEqual(readConfirmOverwrite("a"), []);
    assert.deepEqual(readConfirmOverwrite({ 0: "a" }), []);
    assert.deepEqual(readConfirmOverwrite(["a", 1, null, "b", {}, ["c"]]), ["a", "b"]);
    assert.equal(readConfirmOverwrite(Array.from({ length: 600 }, (_, i) => `k${i}`)).length, 500);
  });

  // ── ตัวตนของแพ็กเกจ (ลายนิ้วมือ + จับคู่ cache กับชีท) ──
  await t("packageFingerprint: type/website/price/dates only — not position, not units", async () => {
    const [a, b] = (await parse(sample())).packages;
    const fa = packageFingerprint(a);
    assert.equal(packageFingerprint({ ...a, rowNumber: 99, rowCount: 7, ordinal: 5, key: "x#5", units: 40, unitText: "40", slots: [] }), fa);
    assert.notEqual(packageFingerprint(b), fa);
    assert.notEqual(packageFingerprint({ ...a, type: "Guest2" }), fa);
    assert.notEqual(packageFingerprint({ ...a, websiteText: "z.com" }), fa);
    assert.notEqual(packageFingerprint({ ...a, priceText: "฿1" }), fa);
    assert.notEqual(packageFingerprint({ ...a, startDate: "2026-11-01" }), fa);
    assert.notEqual(packageFingerprint({ ...a, expireDate: "2027-11-01" }), fa);
    assert.equal(packageFingerprint({ ...a, type: `  ${a.type} ` }), fa); // เว้นวรรคหัวท้ายไม่นับ
    // ข้อมูล cache ที่พัง/ว่าง ไม่ throw
    assert.equal(packageFingerprint(null), packageFingerprint({}));
    assert.equal(packageFingerprint("junk"), packageFingerprint(undefined));
  });
  await t("matchPackages: a package inserted above keeps the old rows (matched by fingerprint)", () => {
    const old = [{ key: "T#1", fingerprint: "A" }, { key: "T#2", fingerprint: "B" }];
    const fresh = [{ key: "T#1", fingerprint: "X" }, { key: "T#2", fingerprint: "A" }, { key: "T#3", fingerprint: "B" }];
    const m = matchPackages(old, fresh);
    assert.deepEqual(m.pairs.slice().sort((x, y) => x[0] - y[0]), [[0, 1], [1, 2]]);
    assert.deepEqual(m.unmatchedOld, []);
    assert.deepEqual(m.unmatchedNew, [0]);
  });
  await t("matchPackages: swapped keys, removed package, edit in place, identical twins", () => {
    // สลับตำแหน่งกัน
    const swap = matchPackages([{ key: "T#1", fingerprint: "A" }, { key: "T#2", fingerprint: "B" }], [{ key: "T#1", fingerprint: "B" }, { key: "T#2", fingerprint: "A" }]);
    assert.deepEqual(swap.pairs.slice().sort((x, y) => x[0] - y[0]), [[0, 1], [1, 0]]);
    // ก้อนแรกถูกลบ: ก้อนถัดไปเลื่อนขึ้น ก้อนที่หายไม่ถูกจับคู่ด้วย key
    const removed = matchPackages([{ key: "T#1", fingerprint: "A" }, { key: "T#2", fingerprint: "B" }, { key: "T#3", fingerprint: "C" }], [{ key: "T#1", fingerprint: "B" }, { key: "T#2", fingerprint: "C" }]);
    assert.deepEqual(removed.pairs.slice().sort((x, y) => x[0] - y[0]), [[1, 0], [2, 1]]);
    assert.deepEqual(removed.unmatchedOld, [0]);
    assert.deepEqual(removed.unmatchedNew, []);
    // แก้ข้อมูลแพ็กเกจที่เดิม: จับคู่ด้วย key
    const edited = matchPackages([{ key: "T#1", fingerprint: "A" }, { key: "T#2", fingerprint: "B" }], [{ key: "T#1", fingerprint: "A2" }, { key: "T#2", fingerprint: "B" }]);
    assert.deepEqual(edited.pairs.slice().sort((x, y) => x[0] - y[0]), [[0, 0], [1, 1]]);
    // ลายนิ้วมือซ้ำกัน 2 ก้อน: key เดิมมาก่อน
    const twins = matchPackages([{ key: "T#1", fingerprint: "A" }, { key: "T#2", fingerprint: "A" }], [{ key: "T#1", fingerprint: "A" }, { key: "T#2", fingerprint: "A" }]);
    assert.deepEqual(twins.pairs.slice().sort((x, y) => x[0] - y[0]), [[0, 0], [1, 1]]);
  });
  await t("matchPackages: a stale row is never adopted by key alone, but comes back by fingerprint", () => {
    const notAdopted = matchPackages([{ key: "T#1", fingerprint: "A", stale: true }], [{ key: "T#1", fingerprint: "Z" }]);
    assert.deepEqual(notAdopted.pairs, []);
    assert.deepEqual(notAdopted.unmatchedOld, [0]);
    assert.deepEqual(notAdopted.unmatchedNew, [0]);
    const back = matchPackages([{ key: "~stale~abc", fingerprint: "A", stale: true }], [{ key: "T#2", fingerprint: "A" }]);
    assert.deepEqual(back.pairs, [[0, 0]]);
  });

  // ── แพ็กเกจสุดท้ายที่ไม่ระบุ Unit และยังไม่มีช่องถูกใช้ ──
  await t("newPackageStartRow / planBlockGrowth: empty-unit last package still occupies its own row", async () => {
    const p = new FakeSheetsPort();
    p.addTab(TAB, [
      FAKE_HEADER,
      ["Guest", "a.com", "฿1000", 3, "", "", "http://x/1", "", "Acme", "Published", ""],
      [],
      [],
      ["PR", "b.com", "฿500", "", "", ""],
    ], 5);
    const parsed = await parse(p);
    const last = parsed.packages[1];
    assert.equal(last.rowNumber, 5);
    assert.equal(last.rowCount, 0);
    assert.equal(last.slots.length, 0);
    assert.equal(blockLastRow(last), 5);
    assert.equal(newPackageStartRow(parsed.headerRow, parsed.packages), 6); // เดิมได้ 5 = เขียนทับแถวของแพ็กเกจ PR
    // ตั้ง Unit = 2 ให้ก้อนนี้: ต้องต่อท้าย 1 แถว (แถว 5-6) ไม่ใช่ 0
    assert.deepEqual(planBlockGrowth(last, null, 5, 2), { appendRows: 1, insertAt0: null, insertCount: 0, newRowCount: 2 });
    // ก้อนกลางที่ rowCount/slots เป็น 0 (ข้อมูล cache เก่า) นับว่ามี 1 แถว
    assert.equal(planBlockGrowth({ ...parsed.packages[0], rowCount: 0, slots: [] }, last, 5, 3).insertCount, 2);
  });

  // ── สูตรในเซลล์ ──
  await t("fake port: FORMULA render returns formula text; writing a value drops the formula; inserts shift formulas", async () => {
    const p = sample();
    p.setFormula(TAB, 3, 8, '=IF(1=2,"x","")', "");
    p.setFormula(TAB, 3, 10, "=A2", "Guest");
    const values = (await p.readTabs("id", [TAB]))[TAB];
    const formulas = (await p.readTabs("id", [TAB], { render: "FORMULA" }))[TAB];
    assert.ok(!values[2][8]);
    assert.equal(values[2][10], "Guest");
    assert.equal(formulas[2][8], '=IF(1=2,"x","")');
    assert.equal(formulas[2][10], "=A2");
    assert.equal(formulas[1][8], "Acme"); // เซลล์ที่ไม่ใช่สูตร ได้ค่าปกติ
    assert.equal(p.reads, 2);
    await p.batchUpdate("id", [{ insertDimension: { range: { sheetId: p.tab(TAB).sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, inheritFromBefore: true } }]);
    assert.equal(p.formula(TAB, 4, 8), '=IF(1=2,"x","")');
    await p.writeCells("id", [{ range: "'Pkg A'!I4", values: [["Beta"]], mode: "RAW" }]);
    assert.equal(p.formula(TAB, 4, 8), undefined);
    assert.equal(p.formula(TAB, 4, 10), "=A2");
  });
  await t("findOverwrites: a formula cell always needs confirmation, even when it shows blank or the same value", async () => {
    const p = sample();
    p.setFormula(TAB, 3, 8, '=IF(1=2,"x","")', "");
    p.setFormula(TAB, 2, 9, '="Published"', "Published");
    const rows = await rawRows(p);
    const formulas = (await p.readTabs("id", [TAB], { render: "FORMULA" }))[TAB];
    // ไม่ส่งตารางสูตร = พฤติกรรมเดิม (เซลล์ที่แสดงว่าง ไม่ต้องยืนยัน)
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I3", "Beta")]), []);
    const o = findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I3", "Beta")], formulas);
    assert.equal(o.length, 1);
    assert.equal(o[0].cell, "I3");
    assert.equal(o[0].oldValue, '=IF(1=2,"x","")');
    assert.equal(o[0].newValue, "Beta");
    assert.ok(o[0].key.includes('=IF(1=2,"x","")'));
    // ค่าที่แสดงเท่ากับค่าใหม่ ก็ยังต้องยืนยัน เพราะสูตรจะหาย
    const same = findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!J2", "Published")], formulas);
    assert.equal(same.length, 1);
    assert.equal(same[0].oldValue, '="Published"');
    // สูตรเปลี่ยน = key เปลี่ยน (คำยืนยันเก่าใช้ไม่ได้)
    p.setFormula(TAB, 3, 8, "=A2", "Guest");
    const o2 = findOverwrites(TAB, COLS, await rawRows(p), [cellUpd("'Pkg A'!I3", "Beta")], (await p.readTabs("id", [TAB], { render: "FORMULA" }))[TAB]);
    assert.notEqual(o2[0].key, o[0].key);
    assert.throws(() => assertOverwritesApproved(o2, [o[0].key]), (e) => e instanceof QuotaError && e.status === 409);
    // เซลล์ธรรมดาในตารางสูตร ทำงานเหมือนเดิม
    assert.deepEqual(findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I2", "Acme"), cellUpd("'Pkg A'!K3", "note")], formulas), []);
    assert.equal(findOverwrites(TAB, COLS, rows, [cellUpd("'Pkg A'!I2", "Other")], formulas)[0].oldValue, "Acme");
  });
  await t("packageCellsHaveData: values or formulas in package columns of rows 2..n block the merge", async () => {
    const p = sample();
    const rows = await rawRows(p);
    assert.equal(packageCellsHaveData(COLS, 3, 4, rows), false);
    assert.equal(packageCellsHaveData(COLS, 3, 2, rows), false); // ช่วงว่าง (ก้อน 1 แถว)
    assert.equal(packageCellsHaveData(COLS, 30, 40, rows), false); // เลยตารางที่อ่านมา
    assert.equal(packageCellsHaveData(COLS, 2, 4, rows), true); // แถวหัวของแพ็กเกจเองมีข้อมูล
    // ข้อมูลในคอลัมน์ช่อง (G-K) ไม่นับ
    p.tab(TAB).grid[2][8] = "Beta";
    assert.equal(packageCellsHaveData(COLS, 3, 4, await rawRows(p)), false);
    // สูตรที่ผลว่างในคอลัมน์แพ็กเกจ: ค่าอย่างเดียวมองไม่เห็น ต้องดูตารางสูตร
    p.setFormula(TAB, 4, 2, '=IF(1=2,"x","")', "");
    const v = await rawRows(p);
    const f = (await p.readTabs("id", [TAB], { render: "FORMULA" }))[TAB];
    assert.equal(packageCellsHaveData(COLS, 3, 4, v), false);
    assert.equal(packageCellsHaveData(COLS, 3, 4, v, f), true);
    assert.equal(packageCellsHaveData(COLS, 3, 3, v, f), false);
    assert.ok(MERGE_SKIPPED_MSG.startsWith("ไม่ได้รวมเซลล์ของแพ็กเกจ"));
  });
  console.log(`\n${n} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
