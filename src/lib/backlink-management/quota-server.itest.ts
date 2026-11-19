/**
 * ทดสอบรวมของโควต้า กับฐานข้อมูล LOCAL เท่านั้น (ชีทเป็นของจำลองในหน่วยความจำ ไม่ยิง Google)
 * Run: LOCAL='postgresql://postgres:localdev@127.0.0.1:15432/plans_seo_local?schema=plans_seo_pipeline' \
 *      DATABASE_URL="$LOCAL" DIRECT_URL="$LOCAL" npx tsx src/lib/backlink-management/quota-server.itest.ts
 */
import assert from "node:assert/strict";
import { FakeSheetsPort, FAKE_HEADER } from "./quota-fake-port";

const TAB = "Pkg A";
let n = 0;
function ok(name: string) { n++; console.log("ok -", name); }

/** รันคำสั่งเขียน ถ้าโดน 409 ขอยืนยันเขียนทับ ให้ยืนยันทุกเซลล์ที่ระบบรายงานแล้วรันซ้ำ (ใช้เฉพาะขั้นที่ตั้งใจเขียนทับของเดิม) */
async function confirmed<T, D extends object>(deps: D, run: (d: D & { confirmOverwrite?: string[] }) => Promise<T>): Promise<T> {
  const { QuotaError } = await import("./quota-write");
  try {
    return await run(deps);
  } catch (e) {
    if (e instanceof QuotaError && e.status === 409 && e.overwrites?.length) {
      return await run({ ...deps, confirmOverwrite: e.overwrites.map((o) => o.key) });
    }
    throw e;
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("127.0.0.1")) {
    console.error("ปฏิเสธ: DATABASE_URL ไม่ใช่ฐานข้อมูล local (127.0.0.1) — ไม่รันเพื่อกันแตะข้อมูลจริง");
    process.exit(1);
  }
  const { prisma } = await import("@/lib/prisma");
  const q = await import("./quota-server");

  const stamp = Date.now();
  const orgId = `itest-quota-${stamp}`;
  const userId = `itest-user-${stamp}`;
  const port = new FakeSheetsPort();
  const deps = { port, serviceEmail: "svc@example.test" };
  port.addTab(TAB, [
    FAKE_HEADER,
    ["Guest", "a.com", "฿1000", 3, "", "", "http://x/1", "", "Acme", "Published", ""],
    [], [],
    ["PR", "b.com", "฿500", 2, "", ""],
    [],
  ], 6);
  port.addTab("MarsOS Log", [["x"]]);
  const sheetId = "S".repeat(30);
  const ctx = { orgId, userId, role: "ADMIN", userName: "itest" };

  try {
    await prisma.organization.create({ data: { id: orgId, name: "itest quota", slug: orgId } });
    await prisma.user.create({ data: { id: userId, email: `${userId}@itest.local`, name: "ผู้ทดสอบ", organizationId: orgId } });

    // 1) add source (+pull)
    const added = await q.addSource(ctx, { url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, label: "ชีทเทส" }, deps);
    assert.equal(added.sources.length, 1);
    assert.equal(added.sources[0].packageCount, 2);
    assert.deepEqual(added.sources[0].tabs, [TAB]); // MarsOS Log ไม่ใช่แท็บโควต้า
    await assert.rejects(() => q.addSource(ctx, { url: sheetId }, deps), (e) => e instanceof q.QuotaError && e.status === 409);
    await assert.rejects(() => q.addSource(ctx, { url: "nope" }, deps), (e) => e instanceof q.QuotaError && e.status === 400);
    ok("add source + pull (skips MarsOS tab), duplicate 409, bad link 400");
    const sourceId = added.sources[0].id;

    // 2) view totals
    let view = await q.loadQuotaView(ctx, deps);
    assert.equal(view.packages.length, 2);
    assert.equal(view.totals.bought, 5);
    assert.equal(view.totals.used, 1);
    assert.equal(view.totals.published, 1);
    assert.equal(view.totals.remaining, 4);
    assert.equal(view.totals.usable, 4);
    assert.deepEqual(view.clientOptions, ["Acme"]);
    assert.equal(view.canManage, true);
    ok("view totals");
    const pkgA = () => view.packages.find((p) => p.ordinal === 1)!;
    const pkgB = () => view.packages.find((p) => p.ordinal === 2)!;

    // 3) update slot (+ failed write leaves DB untouched)
    port.failWrites = { code: 403, message: "forbidden" };
    await assert.rejects(() => q.updateSlot(ctx, pkgA().id, 1, { client: "Beta" }, deps), (e) => e instanceof q.QuotaError && e.message.includes("svc@example.test"));
    port.failWrites = null;
    view = await q.loadQuotaView(ctx, deps);
    assert.equal(pkgA().slots[1].client, "");
    const r3 = await q.updateSlot(ctx, pkgA().id, 1, { linkUrl: "http://x/2", client: "Beta", status: "On Process", publishedDate: "2026-11-03" }, deps);
    view = r3.view;
    assert.equal(pkgA().used, 2);
    assert.equal(port.cell(TAB, 3, 8), "Beta");
    assert.equal(port.cell(TAB, 3, 7), "3 November 2026");
    assert.deepEqual(view.clientOptions, ["Acme", "Beta"]);
    await assert.rejects(() => q.updateSlot(ctx, pkgA().id, 3, { client: "x" }, deps), (e) => e instanceof q.QuotaError && e.status === 400);
    ok("update slot (403 maps to share-with message, nothing saved), then written");

    // 4) update package units: last package B 2 -> 4 (append), middle package A 3 -> 5 (insert 2 rows)
    await assert.rejects(() => q.updatePackage(ctx, pkgA().id, { units: 1 }, deps), (e) => e instanceof q.QuotaError && e.message === "ลด Unit ต่ำกว่าจำนวนที่ใช้ไปแล้วไม่ได้");
    view = (await confirmed(deps, (d) => q.updatePackage(ctx, pkgB().id, { units: 4 }, d))).view;
    assert.equal(pkgB().units, 4);
    assert.ok(port.tab(TAB).rowCount >= 8);
    view = (await confirmed(deps, (d) => q.updatePackage(ctx, pkgA().id, { units: 5 }, d))).view;
    assert.equal(pkgA().units, 5);
    assert.equal(pkgA().slots.length, 5);
    assert.equal(pkgB().rowNumber, 7); // ถูกดันลง 2 แถว
    assert.equal(pkgB().units, 4);
    assert.ok(port.other.length >= 6, "re-merge requests recorded");
    ok("update package units: append for last, insert + re-merge for middle");

    // 5) create package
    const startRow = pkgB().rowNumber + 4;
    view = (await q.createPackage(ctx, { sourceId, tabTitle: TAB, type: "New", websiteText: "c.com", units: 2, expireDate: "2027-01-31" }, deps)).view;
    assert.equal(view.packages.length, 3);
    const pkgC = view.packages.find((p) => p.ordinal === 3)!;
    assert.equal(pkgC.rowNumber, startRow);
    assert.equal(pkgC.units, 2);
    assert.equal(pkgC.expireText.length > 0, true);
    await assert.rejects(() => q.createPackage(ctx, { sourceId, tabTitle: "MarsOS Log", units: 2 }, deps), (e) => e instanceof q.QuotaError && e.status === 400);
    ok("create package at end of last block");

    // 6) reservation (first free slot of A = index 2) + cancel
    const rsv = await q.createReservation(ctx, { packageId: pkgA().id, reservedById: userId, client: "Gamma", website: "a.com" }, deps);
    view = rsv.view;
    assert.equal(pkgA().slots[2].reservation?.reservedByName, "ผู้ทดสอบ");
    assert.equal(port.cell(TAB, 4, 8), "Gamma");
    assert.equal(port.cell(TAB, 4, 9), "On Process");
    assert.equal(pkgA().reserved, 1);
    await assert.rejects(() => q.createReservation(ctx, { packageId: pkgA().id, reservedById: userId, client: "" }, deps), (e) => e instanceof q.QuotaError && e.message === "ต้องระบุ Clients");
    await assert.rejects(() => q.createReservation(ctx, { packageId: pkgA().id, reservedById: "nobody", client: "X" }, deps), (e) => e instanceof q.QuotaError && e.status === 400);
    await assert.rejects(() => q.createReservation(ctx, { packageId: pkgA().id, reservedById: userId, client: "X", slotIndex: 0 }, deps), (e) => e instanceof q.QuotaError && e.status === 409);
    const resId = pkgA().slots[2].reservation!.id;
    view = (await q.updateReservation(ctx, resId, { note: "โน้ต" }, deps)).view;
    assert.equal(pkgA().slots[2].reservation?.note, "โน้ต");
    view = (await confirmed(deps, (d) => q.cancelReservation(ctx, resId, d))).view;
    assert.equal(pkgA().slots[2].reservation, null);
    assert.equal(port.cell(TAB, 4, 8), "");
    assert.equal(pkgA().used, 2);
    ok("create / update / cancel reservation");

    // 7) reservation that has a link cannot be cancelled
    view = (await q.createReservation(ctx, { packageId: pkgA().id, reservedById: userId, client: "Delta" }, deps)).view;
    const res2 = pkgA().slots[2].reservation!.id;
    await q.updateSlot(ctx, pkgA().id, 2, { linkUrl: "http://x/3" }, deps);
    await assert.rejects(() => q.cancelReservation(ctx, res2, deps), (e) => e instanceof q.QuotaError && e.message.startsWith("ช่องนี้มีลิงก์แล้ว"));
    await confirmed(deps, (d) => q.updateSlot(ctx, pkgA().id, 2, { linkUrl: "", client: "", status: "" }, d));
    ok("cancel blocked when link exists");

    // 8) reservation on package C, then the sheet is edited behind the app's back (package C vanishes)
    const STALE_MSG = "ไม่พบแพ็กเกจนี้ในชีทแล้ว — โหลดใหม่";
    const staff = { ...ctx, role: "SEO_SPECIALIST" };
    const byId = (id: string) => view.packages.find((p) => p.id === id)!;
    view = (await q.createReservation(ctx, { packageId: pkgC.id, reservedById: userId, client: "Omega" }, deps)).view;
    const resC = byId(pkgC.id).slots[0].reservation!.id;
    // ช่อง A#2 ถูกล้างในชีทแล้ว แต่การจองเพิ่งสร้าง (< 60 วินาที) จึงยังไม่ถูกเก็บกวาด
    assert.equal(await prisma.blmQuotaReservation.count({ where: { organizationId: orgId } }), 2);
    await prisma.blmQuotaReservation.update({ where: { id: res2 }, data: { createdAt: new Date(Date.now() - 2 * 60_000) } });
    await q.pullSource(orgId, sourceId, deps);
    assert.equal(await prisma.blmQuotaReservation.count({ where: { organizationId: orgId } }), 1);
    ok("reservation on a cleared slot survives the 60 s grace, then is swept");

    const tab = port.tab(TAB);
    const savedC = tab.grid.slice(startRow - 1).map((r) => [...r]);
    const clearC = () => { for (let r = startRow - 1; r < tab.grid.length; r++) tab.grid[r] = []; };
    clearC();
    await q.pullSource(orgId, sourceId, deps);
    view = await q.loadQuotaView(ctx, deps);
    assert.equal(view.packages.length, 3); // ยังแสดงอยู่ แต่ติดป้ายไม่พบในชีท
    assert.equal(byId(pkgC.id).stale, true);
    assert.equal(pkgA().stale, false);
    assert.equal(await prisma.blmQuotaReservation.count({ where: { organizationId: orgId, packageId: pkgC.id } }), 1);
    assert.equal(view.sources[0].packageCount, 2);
    assert.equal(view.totals.bought, pkgA().units! + pkgB().units!); // ไม่นับแพ็กเกจที่หายจากชีท
    ok("vanished package becomes stale, keeps its reservation, totals exclude it");

    {
      const w0 = port.writes.length;
      const isStale = (e: unknown) => e instanceof q.QuotaError && e.status === 409 && e.message === STALE_MSG && !e.overwrites?.length;
      await assert.rejects(() => q.updateSlot(ctx, pkgC.id, 0, { remark: "x" }, deps), isStale);
      await assert.rejects(() => q.updatePackage(ctx, pkgC.id, { units: 3 }, deps), isStale);
      await assert.rejects(() => q.createReservation(ctx, { packageId: pkgC.id, reservedById: userId, client: "X" }, deps), isStale);
      await assert.rejects(() => q.cancelReservation(ctx, resC, deps), isStale);
      await assert.rejects(() => q.updateReservation(ctx, resC, { note: "n" }, deps), isStale);
      assert.equal(port.writes.length, w0);
      await assert.rejects(() => q.removeStalePackage(staff, pkgC.id, deps), (e) => e instanceof q.QuotaError && e.status === 403);
      await assert.rejects(() => q.removeStalePackage(ctx, pkgA().id, deps), (e) => e instanceof q.QuotaError && e.status === 400);
      await assert.rejects(() => q.removeStalePackage(ctx, "no-such-package", deps), (e) => e instanceof q.QuotaError && e.status === 404);
      assert.equal(await prisma.blmQuotaPackage.count({ where: { organizationId: orgId } }), 3);
      ok("every write on a stale package is refused (409, no overwrite prompt); remove is manager-only and stale-only");

      // แพ็กเกจกลับมาในชีท: แถวเดิมใน DB กลับมาใช้ได้ การจองยังอยู่
      savedC.forEach((r, i) => { tab.grid[startRow - 1 + i] = [...r]; });
      await q.pullSource(orgId, sourceId, deps);
      view = await q.loadQuotaView(ctx, deps);
      assert.equal(byId(pkgC.id).stale, false);
      assert.equal(byId(pkgC.id).ordinal, 3);
      assert.equal(byId(pkgC.id).slots[0].reservation?.id, resC);
      assert.equal(view.sources[0].packageCount, 3);
      ok("package that reappears is live again with the same id and reservation");

      // หายอีกครั้ง แล้วผู้จัดการลบออกจากระบบ (DB เท่านั้น)
      clearC();
      await q.pullSource(orgId, sourceId, deps);
      const w1 = port.writes.length;
      view = (await q.removeStalePackage(ctx, pkgC.id, deps)).view;
      assert.equal(view.packages.length, 2);
      assert.equal(await prisma.blmQuotaPackage.count({ where: { organizationId: orgId } }), 2);
      assert.equal(await prisma.blmQuotaReservation.count({ where: { organizationId: orgId, packageId: pkgC.id } }), 0);
      assert.equal(await prisma.blmQuotaReservation.count({ where: { organizationId: orgId } }), 0);
      assert.equal(port.writes.length, w1);
      ok("manager removes a stale package (and its reservations) without touching the sheet");
    }

    // 8b) overwrite confirmation guard
    {
      const { QuotaError } = await import("./quota-write");
      view = await q.loadQuotaView(ctx, deps);
      const snap = () => ({ writes: port.writes.length, other: port.other.length, rows: port.tab(TAB).rowCount });
      const is409 = (e: unknown): e is InstanceType<typeof QuotaError> => e instanceof QuotaError && e.status === 409 && !!e.overwrites?.length;
      const catch409 = async (run: () => Promise<unknown>) => {
        try { await run(); } catch (e) { if (is409(e)) return e; throw e; }
        assert.fail("expected 409 overwrite confirmation");
      };
      assert.equal(port.cell(TAB, 3, 8), "Beta");

      // (a) no confirmation -> 409, nothing written; with keys -> written
      let s0 = snap();
      const e1 = await catch409(() => q.updateSlot(ctx, pkgA().id, 1, { client: "Zeta" }, deps));
      assert.equal(e1.overwrites!.length, 1);
      assert.equal(e1.overwrites![0].cell, "I3");
      assert.equal(e1.overwrites![0].oldValue, "Beta");
      assert.equal(e1.overwrites![0].newValue, "Zeta");
      assert.deepEqual(snap(), s0);
      assert.equal(port.cell(TAB, 3, 8), "Beta");
      await assert.rejects(() => q.updateSlot(ctx, pkgA().id, 1, { client: "Zeta" }, { ...deps, confirmOverwrite: [] }), (e) => is409(e));
      assert.deepEqual(snap(), s0);
      await q.updateSlot(ctx, pkgA().id, 1, { client: "Zeta" }, { ...deps, confirmOverwrite: e1.overwrites!.map((o) => o.key) });
      assert.equal(port.cell(TAB, 3, 8), "Zeta");

      // (b) stale approval: sheet changed behind our back after the 409
      const e2 = await catch409(() => q.updateSlot(ctx, pkgA().id, 1, { client: "Eta" }, deps));
      port.tab(TAB).grid[2][8] = "Mutated";
      s0 = snap();
      const e3 = await catch409(() => q.updateSlot(ctx, pkgA().id, 1, { client: "Eta" }, { ...deps, confirmOverwrite: e2.overwrites!.map((o) => o.key) }));
      assert.equal(e3.overwrites![0].oldValue, "Mutated");
      assert.notEqual(e3.overwrites![0].key, e2.overwrites![0].key);
      assert.deepEqual(snap(), s0);
      assert.equal(port.cell(TAB, 3, 8), "Mutated");
      await q.updateSlot(ctx, pkgA().id, 1, { client: "Eta" }, { ...deps, confirmOverwrite: e3.overwrites!.map((o) => o.key) });
      assert.equal(port.cell(TAB, 3, 8), "Eta");

      // (c) empty cell and identical value need no confirmation
      assert.ok(!port.cell(TAB, 4, 8));
      await q.updateSlot(ctx, pkgA().id, 2, { client: "Fill" }, deps);
      assert.equal(port.cell(TAB, 4, 8), "Fill");
      s0 = snap();
      await q.updateSlot(ctx, pkgA().id, 1, { client: "Eta" }, deps);
      assert.equal(port.cell(TAB, 3, 8), "Eta");
      assert.ok(port.writes.length > s0.writes); // เขียนจริง แต่ไม่ต้องยืนยัน

      // (d) cancelReservation on filled cells: 409 first, then with keys
      view = (await q.createReservation(ctx, { packageId: pkgA().id, reservedById: userId, client: "Kappa" }, deps)).view;
      const slotIdx = pkgA().slots.findIndex((x) => x.reservation);
      assert.ok(slotIdx >= 0);
      const rid = pkgA().slots[slotIdx].reservation!.id;
      const rowOf = pkgA().rowNumber + slotIdx;
      assert.equal(port.cell(TAB, rowOf, 8), "Kappa");
      s0 = snap();
      const e4 = await catch409(() => q.cancelReservation(ctx, rid, deps));
      assert.ok(e4.overwrites!.some((o) => o.newValue === "" && o.oldValue === "Kappa"));
      assert.deepEqual(snap(), s0);
      assert.equal(port.cell(TAB, rowOf, 8), "Kappa");
      view = (await q.cancelReservation(ctx, rid, { ...deps, confirmOverwrite: e4.overwrites!.map((o) => o.key) })).view;
      assert.equal(port.cell(TAB, rowOf, 8), "");
      assert.equal(pkgA().slots[slotIdx].reservation, null);

      // (e) raising units on the middle package: 409 before any structural batchUpdate
      const unitsBefore = pkgA().units!;
      s0 = snap();
      const e5 = await catch409(() => q.updatePackage(ctx, pkgA().id, { units: unitsBefore + 1 }, deps));
      assert.ok(e5.overwrites!.some((o) => o.header === "Unit" && o.oldValue === String(unitsBefore)));
      assert.deepEqual(snap(), s0);
      view = (await q.updatePackage(ctx, pkgA().id, { units: unitsBefore + 1 }, { ...deps, confirmOverwrite: e5.overwrites!.map((o) => o.key) })).view;
      assert.equal(pkgA().units, unitsBefore + 1);
      assert.ok(port.tab(TAB).rowCount > s0.rows);
      ok("overwrite confirmation: 409 without keys writes nothing, keys apply, stale keys rejected, blank/identical need none");
    }

    // 8c) สิทธิ์: เพิ่ม/แก้แพ็กเกจได้เฉพาะ Admin / SEO Manager — แก้ช่องยังทำได้ทุกคน
    {
      const w0 = port.writes.length;
      await assert.rejects(() => q.createPackage(staff, { sourceId, tabTitle: TAB, type: "Nope", units: 1 }, deps), (e) => e instanceof q.QuotaError && e.status === 403);
      await assert.rejects(() => q.updatePackage(staff, pkgA().id, { units: 9 }, deps), (e) => e instanceof q.QuotaError && e.status === 403);
      assert.equal(port.writes.length, w0);
      assert.equal((await q.loadQuotaView(staff, deps)).canManage, false);
      view = (await q.updateSlot(staff, pkgA().id, 2, { remark: "staff ok" }, deps)).view;
      assert.equal(port.cell(TAB, pkgA().rowNumber + 2, 10), "staff ok");
      ok("package create / edit need a manager (403); slot edits stay open");
    }

    const CHANGED_MSG = "ข้อมูลแพ็กเกจในชีทเปลี่ยนไปจากที่แสดง — โหลดใหม่แล้วลองอีกครั้ง";
    const isChanged = (e: unknown) => e instanceof q.QuotaError && e.status === 409 && e.message === CHANGED_MSG && !e.overwrites?.length;
    const idA = pkgA().id;
    const idB = pkgB().id;

    // 8d) แพ็กเกจถูกแก้ในชีทหลังหน้าจอโหลด: ลายนิ้วมือไม่ตรง = 409 ธรรมดา ไม่เขียน แล้ว cache ตามชีท
    {
      const w0 = port.writes.length;
      tab.grid[pkgA().rowNumber - 1][0] = "Guest2";
      await assert.rejects(() => q.updateSlot(ctx, idA, 3, { client: "Late" }, deps), isChanged);
      assert.equal(port.writes.length, w0);
      view = await q.loadQuotaView(ctx, deps);
      assert.equal(byId(idA).type, "Guest2");
      assert.equal(byId(idA).ordinal, 1);
      view = (await confirmed(deps, (d) => q.updateSlot(ctx, idA, 2, { remark: "after reload" }, d))).view;
      assert.equal(port.cell(TAB, byId(idA).rowNumber + 2, 10), "after reload");
      ok("package edited in the sheet: 409 without overwrite prompt, nothing written, cache follows the sheet");
    }

    // 8e) มีคนแทรกแพ็กเกจไว้ด้านบน: แพ็กเกจเดิมเลื่อนลำดับ แต่ id และการจองอยู่ครบ
    {
      view = (await q.createReservation(ctx, { packageId: idB, reservedById: userId, client: "Moved" }, deps)).view;
      const resB = byId(idB).slots[0].reservation!.id;
      const rowA = byId(idA).rowNumber;
      const rowB = byId(idB).rowNumber;
      await port.batchUpdate("x", [{ insertDimension: { range: { sheetId: tab.sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, inheritFromBefore: false } }]);
      tab.grid[1] = ["Top", "t.com", "฿1", 1, "", ""];
      const w0 = port.writes.length;
      // หน้าจอยังถือ id ของ A (ลำดับ 1 เดิม) — ตอนนี้ลำดับ 1 ในชีทคือ Top ห้ามเขียนลงผิดแพ็กเกจ
      await assert.rejects(() => q.updateSlot(ctx, idA, 3, { client: "Late" }, deps), isChanged);
      assert.equal(port.writes.length, w0);
      view = await q.loadQuotaView(ctx, deps);
      assert.equal(view.packages.length, 3);
      assert.equal(byId(idA).ordinal, 2);
      assert.equal(byId(idA).rowNumber, rowA + 1);
      assert.equal(byId(idB).ordinal, 3);
      assert.equal(byId(idB).rowNumber, rowB + 1);
      assert.equal(byId(idB).slots[0].reservation?.id, resB);
      const top = view.packages.find((p) => p.ordinal === 1)!;
      assert.equal(top.type, "Top");
      view = (await q.updateSlot(ctx, idB, 1, { client: "Lower" }, deps)).view;
      assert.equal(port.cell(TAB, rowB + 2, 8), "Lower"); // แถวใหม่ของ B ช่อง 1
      ok("package inserted above: old ids keep their reservations, writes land on the moved rows");

      // ลบแถวที่แทรกออก: A/B กลับไปลำดับ 1/2 (สลับ key ผ่าน key ชั่วคราว) ส่วน Top กลายเป็น stale
      tab.grid.splice(1, 1);
      if (tab.formulas.length > 1) tab.formulas.splice(1, 1);
      tab.rowCount--;
      await q.pullSource(orgId, sourceId, deps);
      view = await q.loadQuotaView(ctx, deps);
      assert.equal(byId(idA).ordinal, 1);
      assert.equal(byId(idB).ordinal, 2);
      assert.equal(byId(idB).rowNumber, rowB);
      assert.equal(byId(idB).slots[0].reservation?.id, resB);
      assert.equal(byId(top.id).stale, true);
      view = (await q.removeStalePackage(ctx, top.id, deps)).view;
      assert.equal(view.packages.length, 2);
      assert.equal(await prisma.blmQuotaReservation.count({ where: { id: resB } }), 1);
      ok("row removed again: keys swap back, the vanished package is stale and can be removed");
    }

    // 8f) สองคนจองช่องเดียวกันพร้อมกัน: คนที่สองได้ 409 และชีทถูกเขียนครั้งเดียว
    {
      const rowB = byId(idB).rowNumber;
      const free = byId(idB).slots.findIndex((x) => !x.used);
      assert.equal(free, 2);
      const w0 = port.writes.length;
      const race: { second?: Promise<unknown> } = {};
      port.beforeWrite = async () => {
        port.beforeWrite = null;
        race.second = q.createReservation(ctx, { packageId: idB, reservedById: userId, client: "R2" }, deps).then(() => null, (e: unknown) => e);
        await race.second;
      };
      view = (await q.createReservation(ctx, { packageId: idB, reservedById: userId, client: "R1" }, deps)).view;
      const lost = await race.second;
      assert.ok(lost instanceof q.QuotaError, "second claim must fail");
      assert.equal(lost.status, 409);
      assert.equal(lost.message, "ช่องนี้เพิ่งถูกจอง — โหลดใหม่แล้วลองอีกครั้ง");
      assert.ok(!lost.overwrites?.length);
      assert.equal(port.cell(TAB, rowB + free, 8), "R1");
      const mine = port.writes.slice(w0);
      assert.ok(!mine.some((w) => JSON.stringify(w.values).includes("R2")));
      assert.equal(mine.filter((w) => JSON.stringify(w.values).includes("R1")).length, 1);
      assert.equal(await prisma.blmQuotaReservation.count({ where: { packageId: idB, slotIndex: free } }), 1);
      assert.equal(byId(idB).slots[free].client, "R1");
      assert.ok(byId(idB).slots[free].reservation);
      ok("reservation race: the second claim gets 409 and the sheet is written once");
    }

    // 8g) เขียนชีทไม่สำเร็จ: แถวจองใน DB ถูกลบ ช่องยังจองใหม่ได้ทันที
    {
      const rowB = byId(idB).rowNumber;
      const c0 = await prisma.blmQuotaReservation.count({ where: { packageId: idB } });
      port.failWrites = { code: 500, message: "boom" };
      await assert.rejects(() => q.createReservation(ctx, { packageId: idB, reservedById: userId, client: "Fail" }, deps), (e) => e instanceof q.QuotaError);
      port.failWrites = null;
      assert.equal(await prisma.blmQuotaReservation.count({ where: { packageId: idB } }), c0);
      assert.ok(!port.cell(TAB, rowB + 3, 8));
      view = (await q.createReservation(ctx, { packageId: idB, reservedById: userId, client: "Retry" }, deps)).view;
      assert.equal(port.cell(TAB, rowB + 3, 8), "Retry");
      assert.equal(await prisma.blmQuotaReservation.count({ where: { packageId: idB } }), c0 + 1);
      ok("sheet write failure removes the DB claim; the slot can be reserved again");
    }

    // 8h) เซลล์ที่เป็นสูตร (แสดงว่าง) ต้องถามยืนยันก่อนเขียนทับ
    {
      const FORMULA = '=IF(1=2,"x","")';
      const free = byId(idA).slots.findIndex((x) => !x.used);
      assert.ok(free >= 0);
      const row = byId(idA).rowNumber + free;
      port.setFormula(TAB, row, 8, FORMULA, "");
      const c0 = await prisma.blmQuotaReservation.count({ where: { packageId: idA } });
      const w0 = port.writes.length;
      await assert.rejects(
        () => q.createReservation(ctx, { packageId: idA, reservedById: userId, client: "Formula" }, deps),
        (e) => e instanceof q.QuotaError && e.status === 409 && !!e.overwrites?.some((o) => o.oldValue === FORMULA && o.newValue === "Formula"),
      );
      assert.equal(port.writes.length, w0);
      assert.equal(await prisma.blmQuotaReservation.count({ where: { packageId: idA } }), c0); // ถามก่อนจอง ไม่ทิ้งแถวจองค้าง
      assert.equal(port.formula(TAB, row, 8), FORMULA);
      view = (await confirmed(deps, (d) => q.createReservation(ctx, { packageId: idA, reservedById: userId, client: "Formula" }, d))).view;
      assert.equal(port.cell(TAB, row, 8), "Formula");
      assert.equal(port.formula(TAB, row, 8), undefined);
      assert.equal(await prisma.blmQuotaReservation.count({ where: { packageId: idA } }), c0 + 1);
      ok("formula cell triggers the overwrite prompt before any claim or write");
    }

    // 8i) แถวถัดไปของแพ็กเกจมีข้อมูล (สูตร) ในคอลัมน์แพ็กเกจ: เพิ่มแถวได้ แต่ไม่รวมเซลล์ทับ
    {
      const { MERGE_SKIPPED_MSG } = await import("./quota-write");
      const units = byId(idA).units!;
      const rowB = byId(idB).rowNumber;
      port.setFormula(TAB, byId(idA).rowNumber + 1, 0, '=IF(1=2,"x","")', "");
      const o0 = port.other.length;
      const r = await confirmed(deps, (d) => q.updatePackage(ctx, idA, { units: units + 1 }, d));
      view = r.view;
      assert.equal(r.warning, MERGE_SKIPPED_MSG);
      assert.ok(!port.other.slice(o0).some((x) => "mergeCells" in x));
      assert.equal(byId(idA).units, units + 1);
      assert.equal(byId(idB).rowNumber, rowB + 1);
      assert.equal(port.formula(TAB, byId(idA).rowNumber + 1, 0), '=IF(1=2,"x","")');
      ok("merge skipped (with warning) when the block's other rows hold data");
    }

    // 8j) แท็บถูกลบ/เปลี่ยนชื่อในชีท: 404 ก่อนอ่านค่าใด ๆ
    {
      const realGet = port.getSpreadsheet.bind(port);
      port.getSpreadsheet = async () => { const s = await realGet(); return { ...s, tabs: s.tabs.filter((t) => t.title !== TAB) }; };
      const reads0 = port.reads;
      const w0 = port.writes.length;
      await assert.rejects(() => q.updateSlot(ctx, idA, 0, { remark: "x" }, deps), (e) => e instanceof q.QuotaError && e.status === 404 && e.message === "ไม่พบแท็บนี้ในชีทแล้ว — ดึงข้อมูลชีทใหม่");
      port.getSpreadsheet = realGet;
      assert.equal(port.reads, reads0);
      assert.equal(port.writes.length, w0);
      ok("missing tab gives 404 without reading or writing");
    }

    // 8k) คำขอ backlink จองโควต้า: วางแผน (อ่านอย่างเดียว) → transaction เดียว (คำขอ + แถวจอง) → เขียนชีท → อัปเดตสำเนา
    {
      const { quotaOptionsForProject } = await import("./quota-request");
      const project = { id: `itest-proj-${stamp}`, name: "Clicx Bank", clientName: "Clicx" };
      const TARGET = "https://clicx.test/page";
      const requests = () => prisma.blmRequest.count({ where: { organizationId: orgId } });
      const reservations = () => prisma.blmQuotaReservation.count({ where: { organizationId: orgId } });
      /** สร้างคำขอ + จองช่องใน transaction เดียว แบบเดียวกับ route ของคำขอ */
      const submit = (plan: Awaited<ReturnType<typeof q.planRequestQuota>>, targetUrl = TARGET) =>
        prisma.$transaction(async (tx) => {
          const r = await tx.blmRequest.create({
            data: { organizationId: orgId, projectId: project.id, targetUrl, budgetPeriod: "2026-11", requestedById: userId },
            select: { id: true },
          });
          const claimId = await q.claimRequestQuota(tx, ctx, plan, { id: r.id, targetUrl });
          return { id: r.id, claimId };
        });

      view = await q.loadQuotaView(ctx, deps);
      const openSlots = () => byId(idA).slots.filter((x) => !x.used && !x.reservation).map((x) => x.index);
      const [free, nextFree] = openSlots();
      assert.ok(free !== undefined && nextFree !== undefined, "package A needs two free slots for this step");
      const rowA = byId(idA).rowNumber;
      const w0 = port.writes.length;
      const c0 = await reservations();

      // (a) วางแผน: ระบบเลือกช่องว่างช่องแรก กำหนด Clients / เว็บเอง — ยังไม่เขียนอะไรทั้ง DB และชีท
      const plan = await q.planRequestQuota(ctx, { packageId: idA, project, website: "A.COM" }, deps);
      assert.equal(plan.slotIndex, free);
      assert.equal(plan.client, "Clicx");
      assert.equal(plan.website, "a.com");
      assert.equal(plan.pricePerLink, byId(idA).pricePerLink);
      assert.ok(typeof plan.pricePerLink === "number" && plan.pricePerLink > 0);
      assert.equal(plan.tabTitle, TAB);
      assert.deepEqual(plan.project, { id: project.id, name: project.name });
      assert.equal(port.writes.length, w0);
      assert.equal(await reservations(), c0);

      // (b) สร้างคำขอ + จอง: แถวจองมี marker ของคำขอ ผู้จอง = ผู้ส่งคำขอ ; ชีทยังไม่ถูกเขียนจนกว่าจะถึงขั้นเขียน
      const made = await submit(plan);
      assert.equal(port.writes.length, w0);
      assert.equal(await reservations(), c0 + 1);
      assert.ok(!port.cell(TAB, rowA + free, 8));

      // (c) คำขอที่สองเข้ามาระหว่างที่คำขอแรกยังไม่ได้เขียนชีท: ระบบข้ามช่องที่กำลังจอง ไปช่องถัดไป
      const plan2 = await q.planRequestQuota(ctx, { packageId: idA, project, website: "" }, deps);
      assert.equal(plan2.slotIndex, nextFree);
      assert.equal(plan2.website, "a.com"); // ไม่ระบุเว็บ = เว็บแรกของแพ็กเกจ

      assert.equal(await q.writeRequestQuota(plan, deps), undefined);
      assert.equal(port.cell(TAB, rowA + free, 8), "Clicx");
      assert.equal(port.cell(TAB, rowA + free, 9), "On Process");
      assert.ok(!port.cell(TAB, rowA + nextFree, 8));
      assert.equal(await q.refreshRequestQuota(ctx, plan, deps), undefined);
      view = await q.loadQuotaView(ctx, deps);
      const booked = byId(idA).slots[free];
      assert.equal(booked.client, "Clicx");
      assert.equal(booked.status, "On Process");
      assert.equal(booked.reservation?.id, made.claimId);
      assert.equal(booked.reservation?.projectId, project.id);
      assert.equal(booked.reservation?.projectName, project.name);
      assert.equal(booked.reservation?.reservedById, userId);
      assert.equal(booked.reservation?.website, "a.com");
      assert.equal(booked.reservation?.note, `[คำขอ ${made.id}] ${TARGET}`);
      // ช่องที่คำขอจองแล้วไม่ถูกเสนอให้คำขออื่นซ้ำ
      assert.ok(!quotaOptionsForProject(view.packages, project, { free: true }).some((o) => o.packageId === idA && o.slotIndex === free));
      ok("request booking: plan is read-only, claim joins the request transaction, sheet + view show the booked slot");

      // (d) สองคำขอวางแผนได้ช่องเดียวกัน (ก่อนมีใครจอง): คนที่สองชน unique → 409 และคำขอของเขาถูก rollback
      const p1 = await q.planRequestQuota(ctx, { packageId: idA, project, website: "a.com" }, deps);
      const p2 = await q.planRequestQuota(ctx, { packageId: idA, project, website: "a.com" }, deps);
      assert.equal(p1.slotIndex, nextFree);
      assert.equal(p2.slotIndex, nextFree);
      const first = await submit(p1, "https://clicx.test/first");
      const r0 = await requests();
      const lost = await submit(p2, "https://clicx.test/second").then(() => null, (e: unknown) => q.requestQuotaClaimError(e));
      assert.ok(lost instanceof q.QuotaError, "second request must lose the slot");
      assert.equal(lost.status, 409);
      assert.equal(lost.message, "ช่องนี้เพิ่งถูกจอง — โหลดใหม่แล้วลองอีกครั้ง");
      assert.equal(await requests(), r0);
      assert.equal(await prisma.blmRequest.count({ where: { organizationId: orgId, targetUrl: "https://clicx.test/second" } }), 0);
      const plain = new Error("x");
      assert.equal(q.requestQuotaClaimError(plain), plain);
      ok("request booking race: the second request gets 409 and its row is rolled back");

      // (e) เขียนชีทไม่สำเร็จ: throw QuotaError ชีทไม่เปลี่ยน — route เป็นคนลบคำขอ + แถวจอง แล้วช่องจองใหม่ได้
      const wBefore = port.writes.length;
      port.failWrites = { code: 500, message: "boom" };
      await assert.rejects(() => q.writeRequestQuota(p1, deps), (e) => e instanceof q.QuotaError);
      port.failWrites = null;
      assert.equal(port.writes.length, wBefore);
      assert.ok(!port.cell(TAB, rowA + nextFree, 8));
      await prisma.blmQuotaReservation.deleteMany({ where: { id: first.claimId } });
      await prisma.blmRequest.deleteMany({ where: { id: first.id } });
      const retry = await q.planRequestQuota(ctx, { packageId: idA, project, website: "a.com" }, deps);
      assert.equal(retry.slotIndex, nextFree);
      ok("request booking: a failed sheet write changes nothing in the sheet; the slot can be planned again");

      // (f) แพ็กเกจเต็ม / โปรเจกต์ไม่มีชื่อลูกค้า / แพ็กเกจไม่มีจริง
      assert.ok(byId(idB).slots.every((x) => x.used) && byId(idB).slots.length === byId(idB).units, "package B is expected to be full here");
      await assert.rejects(() => q.planRequestQuota(ctx, { packageId: idB, project, website: "" }, deps), (e) => e instanceof q.QuotaError && e.status === 400 && e.message === "โควต้าแพ็กเกจนี้เต็มแล้ว");
      await assert.rejects(
        () => q.planRequestQuota(ctx, { packageId: idA, project: { id: "x", name: " ", clientName: "" }, website: "" }, deps),
        (e) => e instanceof q.QuotaError && e.status === 400 && e.message === "โปรเจกต์ไม่มีชื่อลูกค้าให้ใส่ในคอลัมน์ Clients",
      );
      await assert.rejects(() => q.planRequestQuota(ctx, { packageId: "nope", project, website: "" }, deps), (e) => e instanceof q.QuotaError && e.status === 404);
      ok("request booking: full package 400, project without a client name 400, unknown package 404");

      // (g) ชื่อลูกค้าที่มีในชีทอยู่แล้ว ใช้ตัวสะกดเดิมของชีท (เฉพาะที่ตรงกับโปรเจกต์พอดี)
      const sameClient = await q.planRequestQuota(ctx, { packageId: idA, project: { id: "p-acme", name: "ACME", clientName: "" }, website: "" }, deps);
      assert.equal(sameClient.client, "Acme");

      // (h) ลบคำขอ: marker หายจากหมายเหตุของแถวจอง (ช่องยังจองอยู่) — marker ของคำขออื่นไม่ถูกแตะ
      const other = await prisma.blmQuotaReservation.create({
        data: { organizationId: orgId, packageId: idB, slotIndex: 90, reservedById: userId, note: `[คำขอ ${made.id}x] keep`, createdById: userId },
        select: { id: true },
      });
      await q.clearRequestMarker(orgId, made.id);
      assert.equal((await prisma.blmQuotaReservation.findUnique({ where: { id: made.claimId } }))?.note, TARGET);
      assert.equal((await prisma.blmQuotaReservation.findUnique({ where: { id: other.id } }))?.note, `[คำขอ ${made.id}x] keep`);
      await q.clearRequestMarker(orgId, "no-such-request"); // ไม่ throw
      await prisma.blmQuotaReservation.deleteMany({ where: { id: other.id } });
      view = await q.loadQuotaView(ctx, deps);
      assert.deepEqual(quotaOptionsForProject(view.packages, project).filter((o) => o.packageId === idA && o.slotIndex === free).map((o) => o.kind), ["reserved"]);
      assert.equal(port.cell(TAB, rowA + free, 8), "Clicx");
      ok("request deleted: its marker is cleared, the slot stays booked and is offered again");

      await prisma.blmRequest.deleteMany({ where: { organizationId: orgId } });
    }

    // 9) pull failure keeps cache + records lastError
    const before = await prisma.blmQuotaPackage.count({ where: { organizationId: orgId } });
    const real = port.getSpreadsheet.bind(port);
    port.getSpreadsheet = async () => { throw { code: 403, message: "no" }; };
    await assert.rejects(() => q.pullSource(orgId, sourceId, deps), (e) => e instanceof q.QuotaError);
    port.getSpreadsheet = real;
    assert.equal(await prisma.blmQuotaPackage.count({ where: { organizationId: orgId } }), before);
    const src = await prisma.blmSheetSource.findFirst({ where: { id: sourceId } });
    assert.ok(src && src.lastError.includes("svc@example.test"));
    await q.pullStaleSources(orgId, { maxAgeMs: 0, budgetMs: 5000, force: true }, deps);
    assert.equal((await prisma.blmSheetSource.findFirst({ where: { id: sourceId } }))?.lastError, "");
    ok("pull failure keeps cache and stores Thai lastError; pullStaleSources recovers");

    // 10) remove source
    const gone = await q.removeSource(ctx, sourceId, deps);
    assert.equal(gone.sources.length, 0);
    assert.equal(await prisma.blmQuotaPackage.count({ where: { organizationId: orgId } }), 0);
    assert.equal(await prisma.blmQuotaReservation.count({ where: { organizationId: orgId } }), 0);
    await assert.rejects(() => q.removeSource(ctx, sourceId, deps), (e) => e instanceof q.QuotaError && e.status === 404);
    ok("remove source (DB only)");
    console.log(`\n${n} passed`);
  } finally {
    await prisma.blmRequest.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.blmQuotaReservation.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.blmQuotaPackage.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.blmSheetSource.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
