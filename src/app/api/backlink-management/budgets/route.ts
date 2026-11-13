import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { currentPeriod, isValidPeriod, round2, summarizeBudget } from "@/lib/backlink-management/budget";
import { isApprover } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const p = req.nextUrl.searchParams.get("period") ?? "";
    const period = isValidPeriod(p) ? p : currentPeriod();
    const [budgets, requests] = await Promise.all([
      prisma.blmBudget.findMany({ where: { organizationId: ctx.orgId, period } }),
      prisma.blmRequest.findMany({
        where: { organizationId: ctx.orgId, budgetPeriod: period },
        select: { projectId: true, status: true, quotedPrice: true, actualPrice: true },
      }),
    ]);
    const ids = Array.from(new Set([...budgets.map((b) => b.projectId), ...requests.map((r) => r.projectId)]));
    const projects = ids.length
      ? await prisma.project.findMany({ where: { organizationId: ctx.orgId, id: { in: ids } }, select: { id: true, name: true, clientName: true } })
      : [];
    const pm = new Map(projects.map((x) => [x.id, x]));
    const rows = ids
      .filter((id) => pm.has(id))
      .map((id) => {
        const b = budgets.find((x) => x.projectId === id);
        const rs = requests.filter((r) => r.projectId === id);
        const counts: Record<string, number> = {};
        for (const r of rs) counts[r.status] = (counts[r.status] ?? 0) + 1;
        return {
          projectId: id,
          projectName: pm.get(id)!.name,
          clientName: pm.get(id)!.clientName ?? "",
          budgetId: b?.id ?? null,
          note: b?.note ?? "",
          ...summarizeBudget(b?.approvedAmount ?? 0, rs),
          counts,
        };
      })
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
    const t = { approved: 0, pending: 0, reserved: 0, actual: 0, remaining: 0 };
    for (const r of rows) { t.approved += r.approved; t.pending += r.pending; t.reserved += r.reserved; t.actual += r.actual; }
    t.remaining = t.approved - t.reserved - t.actual;
    return NextResponse.json({
      period,
      rows,
      totals: { approved: round2(t.approved), pending: round2(t.pending), reserved: round2(t.reserved), actual: round2(t.actual), remaining: round2(t.remaining), overBudget: round2(t.remaining) < 0 },
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะ ADMIN หรือ SEO Manager เท่านั้นที่ตั้งงบได้" }, { status: 403 });
  try {
    const b = await req.json().catch(() => ({}));
    if (!isValidPeriod(b.period)) return NextResponse.json({ error: "เดือนไม่ถูกต้อง" }, { status: 400 });
    const amount = Number(b.approvedAmount);
    if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "งบต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" }, { status: 400 });
    const project = await prisma.project.findFirst({ where: { id: String(b.projectId ?? ""), organizationId: ctx.orgId }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 400 });
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    const row = await prisma.blmBudget.upsert({
      where: { organizationId_projectId_period: { organizationId: ctx.orgId, projectId: project.id, period: b.period } },
      create: { organizationId: ctx.orgId, projectId: project.id, period: b.period, approvedAmount: round2(amount), note, setById: ctx.userId },
      update: { approvedAmount: round2(amount), note, setById: ctx.userId },
    });
    return NextResponse.json({ budget: row });
  } catch (e) {
    return serverError(e);
  }
}
