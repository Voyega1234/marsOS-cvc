import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError, addEvent, parseDateOnly } from "@/lib/backlink-management/server";
import { pushRequestChange } from "@/lib/backlink-management/asana-sync";
import { isValidPeriod, round2 } from "@/lib/backlink-management/budget";
import { budgetFor, enrichOne } from "@/lib/backlink-management/requests-server";
import { isHttpUrl, resolveAction } from "@/lib/backlink-management/workflow";
import { LINK_TYPES, isApprover, statusLabel } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

class BudgetBlock extends Error {
  constructor(public payload: { error: string; budget: unknown }) { super(payload.error); }
}

const thb = (n: number) => n.toLocaleString("th-TH", { style: "currency", currency: "THB" });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const row = await enrichOne(ctx.orgId, params.id);
    if (!row) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 });
    const events = await prisma.blmRequestEvent.findMany({
      where: { organizationId: ctx.orgId, requestId: row.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const ids = Array.from(new Set(events.map((e) => e.actorId).filter((x): x is string => !!x)));
    const users = ids.length
      ? await prisma.user.findMany({ where: { organizationId: ctx.orgId, id: { in: ids } }, select: { id: true, name: true, email: true } })
      : [];
    const um = new Map(users.map((u) => [u.id, u.name ?? u.email]));
    return NextResponse.json({
      request: row,
      events: events.map((e) => ({ ...e, actorName: e.actorId ? um.get(e.actorId) ?? "" : "" })),
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const cur = await prisma.blmRequest.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
    if (!cur) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    const approver = isApprover(ctx.role);

    // ───────── เปลี่ยนสถานะ ─────────
    if (typeof b.action === "string") {
      const reason = typeof b.reason === "string" ? b.reason.trim() : "";
      const liveUrl = typeof b.liveUrl === "string" ? b.liveUrl.trim() : "";
      const res = resolveAction(b.action, cur, ctx.role, { reason, liveUrl });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      const to = res.toStatus;
      const data: Record<string, unknown> = { status: to };
      let amount: number | null = null;
      let eventNote = "";

      if (b.action === "approve") {
        data.approvedById = ctx.userId;
        data.approvedAt = new Date();
        amount = cur.quotedPrice;
      } else if (b.action === "reject") {
        data.rejectReason = reason;
        eventNote = reason;
      } else if (b.action === "publish") {
        data.liveUrl = liveUrl || cur.liveUrl;
        data.publishedAt = new Date();
        if (b.actualPrice !== undefined && b.actualPrice !== null && b.actualPrice !== "") {
          const ap = Number(b.actualPrice);
          if (!Number.isFinite(ap) || ap < 0) return NextResponse.json({ error: "ราคาจริงไม่ถูกต้อง" }, { status: 400 });
          data.actualPrice = round2(ap);
        }
        amount = (data.actualPrice as number | undefined) ?? cur.actualPrice ?? cur.quotedPrice;
      } else if (b.action === "resubmit") {
        data.rejectReason = "";
        data.approvedById = null;
        data.approvedAt = null;
      }

      try {
        await prisma.$transaction(
          async (tx) => {
            const fresh = await tx.blmRequest.findFirst({ where: { id: cur.id, organizationId: ctx.orgId } });
            if (!fresh || fresh.status !== cur.status) throw new Error("สถานะของคำขอเพิ่งถูกเปลี่ยนโดยผู้อื่น กรุณารีเฟรชแล้วลองใหม่");
            if (b.action === "approve") {
              const { summary, hasBudgetRow } = await budgetFor(tx, ctx.orgId, fresh.projectId, fresh.budgetPeriod, {
                id: fresh.id, status: "APPROVED", quotedPrice: fresh.quotedPrice, actualPrice: fresh.actualPrice,
              });
              if (summary.remaining < 0) {
                if (!(b.force === true && ctx.role === "ADMIN")) {
                  const msg = hasBudgetRow
                    ? `อนุมัติไม่ได้: งบเดือน ${fresh.budgetPeriod} ไม่พอ — งบที่อนุมัติ ${thb(summary.approved)}, กันงบแล้ว ${thb(summary.reserved)}, ใช้จริง ${thb(summary.actual)}, หลังอนุมัติจะเกินงบ ${thb(-summary.remaining)}`
                    : `อนุมัติไม่ได้: ยังไม่ได้ตั้งงบของเดือนนี้ (${fresh.budgetPeriod}) — หลังอนุมัติจะเกินงบ ${thb(-summary.remaining)}`;
                  throw new BudgetBlock({ error: msg, budget: { ...summary, hasBudgetRow, period: fresh.budgetPeriod } });
                }
                eventNote = "อนุมัติเกินงบโดยผู้ดูแล";
              }
            }
            await tx.blmRequest.update({ where: { id: cur.id }, data });
          },
          { isolationLevel: "Serializable" },
        );
      } catch (e) {
        if (e instanceof BudgetBlock) return NextResponse.json(e.payload, { status: 409 });
        if (e instanceof Error && /เพิ่งถูกเปลี่ยน/.test(e.message)) return NextResponse.json({ error: e.message }, { status: 409 });
        throw e;
      }

      await addEvent({
        organizationId: ctx.orgId, requestId: cur.id, type: "STATUS",
        fromStatus: cur.status, toStatus: to, amount, note: eventNote, actorId: ctx.userId,
      });
      await pushRequestChange(ctx.orgId, cur.id, `MarsOS: สถานะเปลี่ยนเป็น ${statusLabel(to)} โดย ${ctx.userName}`);
      return NextResponse.json({ request: await enrichOne(ctx.orgId, cur.id) });
    }

    // ───────── แก้ไขข้อมูล ─────────
    const data: Record<string, unknown> = {};
    const locked = cur.status !== "REQUESTED" && !approver;
    const lockedMsg = "คำขอผ่านขั้นรออนุมัติแล้ว ราคา เดือนตัดงบ และเว็บ แก้ได้เฉพาะ ADMIN / SEO Manager";
    const txt = (k: string, max: number) => { if (typeof b[k] === "string") data[k] = (b[k] as string).trim().slice(0, max); };
    txt("anchorText", 300); txt("keyword", 300); txt("notes", 3000);

    if (b.linkType !== undefined) {
      if (!LINK_TYPES.includes(b.linkType)) return NextResponse.json({ error: "ประเภทลิงก์ไม่ถูกต้อง" }, { status: 400 });
      data.linkType = b.linkType;
    }
    if (b.targetUrl !== undefined) {
      if (!isHttpUrl(b.targetUrl)) return NextResponse.json({ error: "URL หน้าลูกค้าไม่ถูกต้อง" }, { status: 400 });
      data.targetUrl = String(b.targetUrl).trim();
    }
    if (b.liveUrl !== undefined) {
      const v = String(b.liveUrl ?? "").trim();
      if (v && !isHttpUrl(v)) return NextResponse.json({ error: "URL ที่ลิงก์อยู่ไม่ถูกต้อง" }, { status: 400 });
      data.liveUrl = v;
    }
    if (b.dueDate !== undefined) {
      if (!b.dueDate) data.dueDate = null;
      else {
        const d = parseDateOnly(b.dueDate);
        if (!d) return NextResponse.json({ error: "วันที่กำหนดส่งไม่ถูกต้อง" }, { status: 400 });
        data.dueDate = d;
      }
    }
    let assigneeChanged = false;
    if (b.assigneeId !== undefined) {
      const id = b.assigneeId ? String(b.assigneeId) : null;
      if (id) {
        const u = await prisma.user.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true } });
        if (!u) return NextResponse.json({ error: "ไม่พบผู้รับผิดชอบ" }, { status: 400 });
      }
      if (id !== cur.assigneeId) { data.assigneeId = id; assigneeChanged = true; }
    }
    if (b.vendorSiteId !== undefined) {
      if (locked) return NextResponse.json({ error: lockedMsg }, { status: 403 });
      if (b.vendorSiteId) {
        const v = await prisma.blmVendorSite.findFirst({ where: { id: String(b.vendorSiteId), organizationId: ctx.orgId } });
        if (!v) return NextResponse.json({ error: "ไม่พบเว็บในคลัง" }, { status: 400 });
        data.vendorSiteId = v.id; data.vendorDomain = v.domain;
      } else { data.vendorSiteId = null; data.vendorDomain = ""; }
    }
    if (b.budgetPeriod !== undefined) {
      if (locked) return NextResponse.json({ error: lockedMsg }, { status: 403 });
      if (!isValidPeriod(b.budgetPeriod)) return NextResponse.json({ error: "เดือนที่ตัดงบไม่ถูกต้อง" }, { status: 400 });
      data.budgetPeriod = b.budgetPeriod;
    }
    const priceEvents: { note: string; amount: number }[] = [];
    if (b.quotedPrice !== undefined) {
      if (locked) return NextResponse.json({ error: lockedMsg }, { status: 403 });
      const n = Number(b.quotedPrice);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: "ราคาไม่ถูกต้อง" }, { status: 400 });
      if (round2(n) !== cur.quotedPrice) { data.quotedPrice = round2(n); priceEvents.push({ note: `ราคาที่ขอ ${cur.quotedPrice} → ${round2(n)}`, amount: round2(n) }); }
    }
    if (b.actualPrice !== undefined) {
      if (b.actualPrice === null || b.actualPrice === "") { if (cur.actualPrice !== null) { data.actualPrice = null; priceEvents.push({ note: "ล้างราคาจริง", amount: 0 }); } }
      else {
        const n = Number(b.actualPrice);
        if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: "ราคาจริงไม่ถูกต้อง" }, { status: 400 });
        if (round2(n) !== cur.actualPrice) { data.actualPrice = round2(n); priceEvents.push({ note: `ราคาจริง ${cur.actualPrice ?? "-"} → ${round2(n)}`, amount: round2(n) }); }
      }
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ request: await enrichOne(ctx.orgId, cur.id) });

    await prisma.blmRequest.update({ where: { id: cur.id }, data });
    for (const p of priceEvents) await addEvent({ organizationId: ctx.orgId, requestId: cur.id, type: "PRICE", amount: p.amount, note: p.note, actorId: ctx.userId });
    if (assigneeChanged) {
      const u = data.assigneeId ? await prisma.user.findFirst({ where: { id: String(data.assigneeId), organizationId: ctx.orgId }, select: { name: true, email: true } }) : null;
      await addEvent({ organizationId: ctx.orgId, requestId: cur.id, type: "ASSIGN", note: u ? `มอบหมายให้ ${u.name ?? u.email}` : "ยกเลิกผู้รับผิดชอบ", actorId: ctx.userId });
    }
    if ("dueDate" in data || assigneeChanged) await pushRequestChange(ctx.orgId, cur.id, "");
    return NextResponse.json({ request: await enrichOne(ctx.orgId, cur.id) });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const cur = await prisma.blmRequest.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
    if (!cur) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 });
    if (!["REQUESTED", "REJECTED", "CANCELLED"].includes(cur.status)) {
      return NextResponse.json({ error: "ลบได้เฉพาะคำขอที่รออนุมัติ ไม่อนุมัติ หรือยกเลิกแล้ว" }, { status: 400 });
    }
    if (!isApprover(ctx.role) && cur.requestedById !== ctx.userId) {
      return NextResponse.json({ error: "ลบได้เฉพาะผู้ขอหรือผู้อนุมัติ" }, { status: 403 });
    }
    if (cur.asanaTaskGid) {
      // ปิดงานใน Asana ก่อนลบ (ถือว่าเสร็จ เพราะคำขอถูกถอน)
      await prisma.blmRequest.update({ where: { id: cur.id }, data: { status: "CANCELLED" } });
      await pushRequestChange(ctx.orgId, cur.id, `MarsOS: คำขอถูกลบโดย ${ctx.userName}`);
    }
    await prisma.blmRequest.delete({ where: { id: cur.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
