/**
 * ทดสอบรวมของ Asana sync กับฐานข้อมูล LOCAL เท่านั้น — Asana เป็นของจำลองในหน่วยความจำ (แทน fetch ทั้งตัว ไม่ยิงออกเน็ต)
 * Run: LOCAL='postgresql://postgres:localdev@127.0.0.1:15432/plans_seo_local?schema=plans_seo_pipeline' \
 *      DATABASE_URL="$LOCAL" DIRECT_URL="$LOCAL" npx tsx src/lib/backlink-management/asana-sync.itest.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

let n = 0;
function ok(name: string) { n++; console.log("ok -", name); }

type FakeTask = { gid: string; completed: boolean; due_on: string | null; assignee: null; permalink_url: string };
const ASANA = "https://app.asana.com/api/1.0";
const tasks = new Map<string, FakeTask>();
const calls: { method: string; path: string; body: any }[] = [];

function installFakeAsana() {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (!url.startsWith(ASANA)) throw new Error(`itest: ห้ามยิงออกนอก (${url.slice(0, 60)})`);
    const method = String(init?.method ?? "GET").toUpperCase();
    const path = url.slice(ASANA.length);
    const body = init?.body ? JSON.parse(String(init.body)).data : null;
    calls.push({ method, path, body });
    const one = path.match(/^\/tasks\/([^/?]+)(\/stories)?(\?|$)/);
    if (one) {
      const t = tasks.get(decodeURIComponent(one[1]));
      if (!t) return reply(404, { errors: [{ message: "not found" }] });
      if (one[2]) return reply(201, { data: {} });
      if (method === "PUT") { Object.assign(t, body); return reply(200, { data: t }); }
      return reply(200, { data: t });
    }
    if (method === "GET" && path.startsWith("/tasks?")) return reply(200, { data: [] });
    return reply(400, { errors: [{ message: "itest: ไม่รองรับ" }] });
  }) as typeof fetch;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("127.0.0.1")) {
    console.error("ปฏิเสธ: DATABASE_URL ไม่ใช่ฐานข้อมูล local (127.0.0.1) — ไม่รันเพื่อกันแตะข้อมูลจริง");
    process.exit(1);
  }
  installFakeAsana();
  process.env.ASANA_ACCESS_TOKEN = "itest-fake-token";

  // server.ts ดึง auth.ts ซึ่งใช้ react.cache (มีเฉพาะใน React ของ Next) — นอก Next ใส่ตัวแทนที่ไม่ทำอะไรให้โหลดไฟล์ได้
  const react = createRequire(`${process.cwd()}/`)("react") as { cache?: unknown };
  if (typeof react.cache !== "function") react.cache = <T,>(fn: T): T => fn;

  const { prisma } = await import("@/lib/prisma");
  const sync = await import("./asana-sync");

  const stamp = Date.now();
  const orgId = `itest-asana-${stamp}`;
  let seq = 0;
  const mkTask = (completed: boolean): string => {
    const gid = `T${stamp}${++seq}`;
    tasks.set(gid, { gid, completed, due_on: null, assignee: null, permalink_url: `https://app.asana.com/0/0/${gid}` });
    return gid;
  };
  const mkReq = async (status: string, gid: string, extra: Record<string, unknown> = {}) =>
    prisma.blmRequest.create({
      data: {
        organizationId: orgId, projectId: "itest-project", targetUrl: "https://example.test/p", budgetPeriod: "2026-11",
        requestedById: "itest-user", status, asanaTaskGid: gid, asanaTaskUrl: `https://app.asana.com/0/0/${gid}`, ...extra,
      },
    });
  const reload = (id: string) => prisma.blmRequest.findUniqueOrThrow({ where: { id } });
  const eventsOf = (id: string) => prisma.blmRequestEvent.findMany({ where: { organizationId: orgId, requestId: id } });
  const putsOf = (gid: string) => calls.filter((c) => c.method === "PUT" && c.path.startsWith(`/tasks/${gid}`));

  try {
    await prisma.blmAsanaConfig.create({ data: { organizationId: orgId, projectGid: "DEFAULT", projectName: "Default" } });

    // 1) งานถูกกดเสร็จใน Asana → คำขอที่อนุมัติแล้วกลายเป็น PUBLISHED พร้อมประวัติ
    {
      const gid = mkTask(true);
      const r = await mkReq("APPROVED", gid);
      await sync.applyAsanaTask(orgId, tasks.get(gid)!);
      const after = await reload(r.id);
      assert.equal(after.status, "PUBLISHED");
      assert.equal(after.asanaCompleted, true);
      assert.ok(after.publishedAt);
      const ev = await eventsOf(r.id);
      assert.equal(ev.filter((e) => e.type === "STATUS" && e.source === "asana" && e.fromStatus === "APPROVED" && e.toStatus === "PUBLISHED").length, 1);
      ok("applyAsanaTask: completed task publishes an APPROVED request");
    }

    // 2) งานถูกกดเสร็จ แต่คำขอยังรออนุมัติ → จำว่าเสร็จ ไม่ข้ามขั้นอนุมัติ
    {
      const gid = mkTask(true);
      const r = await mkReq("REQUESTED", gid);
      await sync.applyAsanaTask(orgId, tasks.get(gid)!);
      const after = await reload(r.id);
      assert.equal(after.status, "REQUESTED");
      assert.equal(after.asanaCompleted, true);
      ok("applyAsanaTask: completed task does not skip approval");
    }

    // 3) สถานะในระบบเปลี่ยนไปก่อนเขียน → ไม่เขียนทับ ไม่มีประวัติ STATUS จาก Asana
    {
      const gid = mkTask(true);
      const r = await mkReq("APPROVED", gid);
      const delegate = prisma.blmRequest as any;
      const orig = delegate.updateMany.bind(delegate);
      let raced = false;
      let patched = true;
      try {
        delegate.updateMany = async (args: any) => {
          if (!raced && args?.where?.id === r.id) {
            raced = true;
            await prisma.blmRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
          }
          return orig(args);
        };
      } catch {
        patched = false;
      }
      if (patched && delegate.updateMany !== orig) {
        try {
          await sync.applyAsanaTask(orgId, tasks.get(gid)!);
        } finally {
          delegate.updateMany = orig;
        }
        assert.equal(raced, true, "ตัวจำลองการชนกันต้องถูกเรียก");
        const after = await reload(r.id);
        assert.equal(after.status, "CANCELLED");
        assert.equal(after.publishedAt, null);
        const ev = await eventsOf(r.id);
        assert.equal(ev.filter((e) => e.type === "STATUS").length, 0);
        ok("applyAsanaTask: concurrent status change is not overwritten");
      } else {
        console.log("skip - concurrent status change (ดักคำสั่ง prisma ไม่ได้ในสภาพแวดล้อมนี้)");
      }
    }

    // 4) มีคนกดเสร็จใน Asana แล้วระบบเราส่งการเปลี่ยนแปลง → ไม่เปิดงานกลับ และรับสถานะเสร็จ
    {
      const gid = mkTask(true);
      const r = await mkReq("APPROVED", gid);
      await sync.pushRequestChange(orgId, r.id, "");
      assert.equal(putsOf(gid).filter((c) => "completed" in (c.body ?? {})).length, 0);
      assert.equal(tasks.get(gid)!.completed, true);
      const after = await reload(r.id);
      assert.equal(after.status, "PUBLISHED");
      assert.equal(after.asanaSyncError, "");
      ok("pushRequestChange: task completed by a person is not reopened, request is published");
    }

    // 5) คำขอเคยถูกปฏิเสธ (ระบบเราปิดงานเอง) แล้วส่งใหม่+อนุมัติ → เปิดงานกลับเหมือนเดิม
    {
      const gid = mkTask(true);
      const r = await mkReq("APPROVED", gid, { asanaCompleted: true });
      await prisma.blmRequestEvent.create({
        data: { organizationId: orgId, requestId: r.id, type: "STATUS", fromStatus: "REQUESTED", toStatus: "REJECTED", source: "user" },
      });
      await sync.pushRequestChange(orgId, r.id, "");
      const puts = putsOf(gid).filter((c) => "completed" in (c.body ?? {}));
      assert.equal(puts.length, 1);
      assert.equal(puts[0].body.completed, false);
      const after = await reload(r.id);
      assert.equal(after.status, "APPROVED");
      assert.equal(after.asanaCompleted, false);
      ok("pushRequestChange: request closed by MarsOS earlier still reopens its task");
    }

    // 6) ยกเลิกคำขอ → ปิดงานใน Asana
    {
      const gid = mkTask(false);
      const r = await mkReq("CANCELLED", gid);
      await sync.pushRequestChange(orgId, r.id, "ยกเลิก");
      const puts = putsOf(gid).filter((c) => "completed" in (c.body ?? {}));
      assert.equal(puts.length, 1);
      assert.equal(puts[0].body.completed, true);
      assert.equal(calls.filter((c) => c.method === "POST" && c.path === `/tasks/${gid}/stories`).length, 1);
      const after = await reload(r.id);
      assert.equal(after.status, "CANCELLED");
      assert.equal(after.asanaCompleted, true);
      ok("pushRequestChange: cancelled request completes its task");
    }

    // 7) งานนอกโปรเจกต์เริ่มต้น: คำขอที่ปิดแล้วจำนวนมากต้องไม่แย่งคิวคำขอที่ยังเปิดอยู่
    {
      const closed: string[] = [];
      for (let i = 0; i < 10; i++) {
        const gid = mkTask(true);
        const r = await mkReq("VERIFIED", gid, { asanaCompleted: true });
        await prisma.blmRequestAsana.create({ data: { organizationId: orgId, requestId: r.id, projectGid: "OTHER", projectName: "Other" } });
        closed.push(gid);
      }
      const gid = mkTask(true);
      const open = await mkReq("IN_PROGRESS", gid);
      const link = await prisma.blmRequestAsana.create({
        data: { organizationId: orgId, requestId: open.id, projectGid: "OTHER", projectName: "Other", lastCheckedAt: new Date() },
      });
      const before = calls.length;
      await sync.refreshFromAsana(orgId, { minIntervalMs: 0, budgetMs: 20_000 });
      const polled = calls.slice(before).filter((c) => c.method === "GET" && /^\/tasks\/[^/?]+\?/.test(c.path)).map((c) => c.path.split("?")[0].slice("/tasks/".length));
      assert.ok(polled.includes(gid), "คำขอที่เปิดอยู่ต้องถูกถามสถานะ");
      assert.equal(polled.filter((g) => closed.includes(g)).length, 0, "คำขอที่ปิดแล้วไม่ต้องถาม");
      const after = await reload(open.id);
      assert.equal(after.status, "PUBLISHED");
      const linkAfter = await prisma.blmRequestAsana.findUniqueOrThrow({ where: { id: link.id } });
      assert.ok(linkAfter.lastCheckedAt && linkAfter.lastCheckedAt.getTime() > link.lastCheckedAt!.getTime());
      const cfg = await prisma.blmAsanaConfig.findUniqueOrThrow({ where: { organizationId: orgId } });
      assert.equal(cfg.lastError, "");
      ok("refreshFromAsana: open request in another Asana project is polled ahead of closed ones");
    }

    console.log(`\n${n} passed`);
  } finally {
    await prisma.blmRequestEvent.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.blmRequestAsana.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.blmRequest.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.blmAsanaConfig.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
