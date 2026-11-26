import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { loadClickSignals, saveBrowserIds } from "./clickSignalService";

// These tests write clicks and their browser ids, so they only run against the local dev
// database. Against anything else they are skipped: a test run must never write to a real
// database.
const LOCAL = /@(127\.0\.0\.1|localhost):/.test(process.env.DATABASE_URL ?? "");
const opts = { skip: LOCAL ? false : "needs the local dev database" };

/** False until scripts/sql/add-line-tracking-click-browser-ids.sql has been run on this database. */
async function tableExists(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ t: string | null }[]>(
    `SELECT to_regclass('"line_tracking"."lt_click_browser_ids"')::text AS t`
  );
  return !!rows[0]?.t;
}

async function withProject(run: (projectId: string, clickId: string) => Promise<void>) {
  const tag = randomUUID().slice(0, 8);
  const agency = await prisma.ltWorkspace.create({ data: { name: `test ${tag}` } });
  const project = await prisma.ltProject.create({
    data: { agencyId: agency.id, name: `test ${tag}`, clientName: "test", slug: `test-${tag}`, businessType: "OTHER" },
  });
  const clickId = `clk_test_${tag}`;
  await prisma.adClick.create({
    data: { projectId: project.id, clickId, userAgent: "Mozilla/5.0", landingUrl: "https://shop.example/p" },
  });
  try {
    await run(project.id, clickId);
  } finally {
    // Cascades to the project, its clicks and their browser ids.
    await prisma.ltWorkspace.delete({ where: { id: agency.id } });
  }
}

test("loadClickSignals: the click row alone, and nothing for an unknown id", opts, async () => {
  await withProject(async (_projectId, clickId) => {
    const signals = await loadClickSignals([clickId, clickId, null, "clk_does_not_exist"]);
    assert.equal(signals.size, 1);
    const s = signals.get(clickId)!;
    assert.equal(s.userAgent, "Mozilla/5.0");
    assert.equal(s.landingUrl, "https://shop.example/p");
    assert.ok(s.clickedAt instanceof Date);
  });
  assert.equal((await loadClickSignals([])).size, 0);
});

test("saveBrowserIds: fills the GA client id on the click row, with or without the table", opts, async () => {
  await withProject(async (projectId, clickId) => {
    await saveBrowserIds(projectId, clickId, { gaClientId: "1234567890.1700000000" });
    assert.equal((await loadClickSignals([clickId])).get(clickId)?.gaClientId, "1234567890.1700000000");
  });
});

test("saveBrowserIds: a click of another project is left alone", opts, async () => {
  await withProject(async (_projectId, clickId) => {
    await saveBrowserIds("some-other-project", clickId, { gaClientId: "9.9", fbp: "fb.1.1795000000000.1" });
    const s = (await loadClickSignals([clickId])).get(clickId)!;
    assert.equal(s.gaClientId, undefined);
    assert.equal(s.fbp, undefined);
  });
});

test("saveBrowserIds: stores, merges and reads back the browser ids", opts, async (t) => {
  if (!(await tableExists())) return t.skip("lt_click_browser_ids not created on this database");
  await withProject(async (projectId, clickId) => {
    await saveBrowserIds(projectId, clickId, { fbp: "fb.1.1795000000000.1", gaSessions: { ABC123: "1795000000" } }, { trusted: true });
    await saveBrowserIds(projectId, clickId, {
      gaClientId: "1234567890.1700000000",
      ttp: "2Xb5sHKqV_abc-123",
      gaSessions: { ABC123: "1795000900" },
    });
    const s = (await loadClickSignals([clickId])).get(clickId)!;
    assert.equal(s.fbp, "fb.1.1795000000000.1");
    assert.equal(s.ttp, "2Xb5sHKqV_abc-123");
    assert.equal(s.gaClientId, "1234567890.1700000000");
    assert.deepEqual(s.gaSessions, { ABC123: "1795000900" });
    assert.equal(s.userAgent, "Mozilla/5.0");
  });
});

test("saveBrowserIds: nothing to store means nothing is written", opts, async (t) => {
  if (!(await tableExists())) return t.skip("lt_click_browser_ids not created on this database");
  await withProject(async (projectId, clickId) => {
    await saveBrowserIds(projectId, clickId, {});
    assert.equal(await prisma.ltClickBrowserIds.count({ where: { clickId } }), 0);
  });
});

test("saveBrowserIds: a click older than 90 days gets no new ids from the public endpoint", opts, async () => {
  await withProject(async (projectId, clickId) => {
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    await prisma.adClick.update({ where: { clickId }, data: { createdAt: old } });
    await saveBrowserIds(projectId, clickId, { gaClientId: "1234567890.1700000000", fbp: "fb.1.1795000000000.1" });
    const stale = (await loadClickSignals([clickId])).get(clickId)!;
    assert.equal(stale.gaClientId, undefined);
    assert.equal(stale.fbp, undefined);

    // Inside the window the same call is accepted.
    const recent = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
    await prisma.adClick.update({ where: { clickId }, data: { createdAt: recent } });
    await saveBrowserIds(projectId, clickId, { gaClientId: "1234567890.1700000000" });
    assert.equal((await loadClickSignals([clickId])).get(clickId)?.gaClientId, "1234567890.1700000000");
  });
});

test("saveBrowserIds: Google braid, LINE Tag and Snapchat ids are stored and read back", opts, async (t) => {
  if (!(await tableExists())) return t.skip("lt_click_browser_ids not created on this database");
  await withProject(async (projectId, clickId) => {
    await saveBrowserIds(
      projectId,
      clickId,
      { gbraid: "0AAAAAo_gbraid-123", wbraid: "0AAAAAo_wbraid-456", lineClickId: "ldtag.click-123" },
      { trusted: true }
    );
    await saveBrowserIds(projectId, clickId, {
      lineBrowserId: "0123456789abcdef-0123",
      scid: "a1b2c3d4-e5f6-7890",
    });
    const s = (await loadClickSignals([clickId])).get(clickId)!;
    assert.equal(s.gbraid, "0AAAAAo_gbraid-123");
    assert.equal(s.wbraid, "0AAAAAo_wbraid-456");
    assert.equal(s.lineClickId, "ldtag.click-123");
    assert.equal(s.lineBrowserId, "0123456789abcdef-0123");
    assert.equal(s.scid, "a1b2c3d4-e5f6-7890");
  });
});
