import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError, addEvent, sleep, parseDateOnly } from "@/lib/backlink-management/server";
import { ensureAsanaTask, refreshFromAsana } from "@/lib/backlink-management/asana-sync";
import { currentPeriod, isValidPeriod, round2 } from "@/lib/backlink-management/budget";
import { enrichRows, enrichOne } from "@/lib/backlink-management/requests-server";
import { isHttpUrl } from "@/lib/backlink-management/workflow";
import { LINK_TYPES } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    await Promise.race([refreshFromAsana(ctx.orgId), sleep(5000)]);
    const sp = req.nextUrl.searchParams;
    const projectId = sp.get("projectId") ?? "";
    const period = sp.get("period") ?? "";
    const status = sp.get("status") ?? "";
    const q = (sp.get("q") ?? "").trim();
    const rows = await prisma.blmRequest.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(projectId ? { projectId } : {}),
        ...(isValidPeriod(period) ? { budgetPeriod: period } : {}),
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { vendorDomain: { contains: q, mode: "insensitive" } },
                { targetUrl: { contains: q, mode: "insensitive" } },
                { anchorText: { contains: q, mode: "insensitive" } },
                { keyword: { contains: q, mode: "insensitive" } },
                { liveUrl: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ requests: await enrichRows(ctx.orgId, rows) });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const b = await req.json().catch(() => ({}));
    const project = await prisma.project.findFirst({ where: { id: String(b.projectId ?? ""), organizationId: ctx.orgId }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 400 });
    if (!isHttpUrl(b.targetUrl)) return NextResponse.json({ error: "URL หน้าลูกค้าต้องขึ้นต้นด้วย http:// หรือ https://" }, { status: 400 });

    let vendorSiteId: string | null = null;
    let vendorDomain = "";
    let vendorPrice = 0;
    let vendorLinkType: string | null = null;
    if (b.vendorSiteId) {
      const v = await prisma.blmVendorSite.findFirst({ where: { id: String(b.vendorSiteId), organizationId: ctx.orgId } });
      if (!v) return NextResponse.json({ error: "ไม่พบเว็บในคลัง" }, { status: 400 });
      vendorSiteId = v.id; vendorDomain = v.domain; vendorPrice = v.price; vendorLinkType = v.linkType;
    }
    let assigneeId: string | null = null;
    if (b.assigneeId) {
      const u = await prisma.user.findFirst({ where: { id: String(b.assigneeId), organizationId: ctx.orgId }, select: { id: true } });
      if (!u) return NextResponse.json({ error: "ไม่พบผู้รับผิดชอบ" }, { status: 400 });
      assigneeId = u.id;
    }
    const period = b.budgetPeriod ? String(b.budgetPeriod) : currentPeriod();
    if (!isValidPeriod(period)) return NextResponse.json({ error: "เดือนที่ตัดงบไม่ถูกต้อง" }, { status: 400 });
    const quoted = b.quotedPrice === undefined || b.quotedPrice === null || b.quotedPrice === "" ? vendorPrice : Number(b.quotedPrice);
    if (!Number.isFinite(quoted) || quoted < 0) return NextResponse.json({ error: "ราคาไม่ถูกต้อง" }, { status: 400 });
    const linkType = LINK_TYPES.includes(b.linkType) ? String(b.linkType) : vendorLinkType ?? "dofollow";
    const due = b.dueDate ? parseDateOnly(b.dueDate) : null;
    if (b.dueDate && !due) return NextResponse.json({ error: "วันที่กำหนดส่งไม่ถูกต้อง" }, { status: 400 });

    const row = await prisma.blmRequest.create({
      data: {
        organizationId: ctx.orgId,
        projectId: project.id,
        vendorSiteId, vendorDomain,
        targetUrl: String(b.targetUrl).trim(),
        anchorText: String(b.anchorText ?? "").trim().slice(0, 300),
        keyword: String(b.keyword ?? "").trim().slice(0, 300),
        linkType,
        quotedPrice: round2(quoted),
        budgetPeriod: period,
        status: "REQUESTED",
        requestedById: ctx.userId,
        assigneeId,
        dueDate: due,
        notes: String(b.notes ?? "").trim().slice(0, 3000),
      },
    });
    await addEvent({
      organizationId: ctx.orgId, requestId: row.id, type: "CREATED", toStatus: "REQUESTED",
      amount: row.quotedPrice, note: "สร้างคำขอ", actorId: ctx.userId,
    });
    await ensureAsanaTask(ctx.orgId, row.id);
    return NextResponse.json({ request: await enrichOne(ctx.orgId, row.id) });
  } catch (e) {
    return serverError(e);
  }
}
