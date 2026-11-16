import { NextRequest, NextResponse } from "next/server";
import { markSheetDirty } from "@/lib/backlink-management/sheet-sync";
import { prisma } from "@/lib/prisma";
import { findProject, projectInfo } from "@/lib/backlink-management/projects";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { currentPeriod, isValidPeriod, round2, summarizeBudget } from "@/lib/backlink-management/budget";
import { isApprover } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";

type BudgetRowIn = { id: string; projectId: string; period: string; approvedAmount: number; note: string };
type RequestRowIn = { projectId: string; status: string; quotedPrice: number; actualPrice: number | null };

// ใช้ร่วมกันทั้งรายเดือนและ "ทุกเดือน": all=true รวมงบทุกเดือนต่อโปรเจกต์
async function buildBudgetResponse(orgId: string, budgets: BudgetRowIn[], requests: RequestRowIn[], all: boolean) {
  const ids = Array.from(new Set([...budgets.map((b) => b.projectId), ...requests.map((r) => r.projectId)]));
  const pm = await projectInfo(orgId, ids);
  const rows = ids
    .filter((id) => pm.has(id))
    .map((id) => {
      const bs = budgets.filter((x) => x.projectId === id);
      const b = bs[0];
      const rs = requests.filter((r) => r.projectId === id);
      const counts: Record<string, number> = {};
      for (const r of rs) counts[r.status] = (counts[r.status] ?? 0) + 1;
      const approved = all ? round2(bs.reduce((a, x) => a + x.approvedAmount, 0)) : (b?.approvedAmount ?? 0);
      return {
        projectId: id,
        projectName: pm.get(id)!.name,
        clientName: pm.get(id)!.clientName ?? "",
        budgetId: all ? null : (b?.id ?? null),
        note: all ? "" : (b?.note ?? ""),
        ...summarizeBudget(approved, rs),
        counts,
        ...(all ? { periods: bs.filter((x) => x.approvedAmount > 0).map((x) => x.period).sort() } : {}),
      };
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
  const t = { approved: 0, pending: 0, reserved: 0, actual: 0, remaining: 0 };
  for (const r of rows) { t.approved += r.approved; t.pending += r.pending; t.reserved += r.reserved; t.actual += r.actual; }
  t.remaining = t.approved - t.reserved - t.actual;
  return {
    rows,
    totals: { approved: round2(t.approved), pending: round2(t.pending), reserved: round2(t.reserved), actual: round2(t.actual), remaining: round2(t.remaining), overBudget: round2(t.remaining) < 0 },
  };
}

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const p = req.nextUrl.searchParams.get("period") ?? "";
    const all = p === "all";
    const period = all ? "all" : isValidPeriod(p) ? p : currentPeriod();
    const select = { projectId: true, status: true, quotedPrice: true, actualPrice: true } as const;
    const [budgets, requests] = await Promise.all([
      prisma.blmBudget.findMany({ where: all ? { organizationId: ctx.orgId } : { organizationId: ctx.orgId, period } }),
      prisma.blmRequest.findMany({
        where: all ? { organizationId: ctx.orgId } : { organizationId: ctx.orgId, budgetPeriod: period },
        select,
      }),
    ]);
    const { rows, totals } = await buildBudgetResponse(ctx.orgId, budgets, requests, all);
    return NextResponse.json({ period, rows, totals });
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
    const project = await findProject(ctx.orgId, String(b.projectId ?? ""));
    if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 400 });
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    const row = await prisma.blmBudget.upsert({
      where: { organizationId_projectId_period: { organizationId: ctx.orgId, projectId: project.id, period: b.period } },
      create: { organizationId: ctx.orgId, projectId: project.id, period: b.period, approvedAmount: round2(amount), note, setById: ctx.userId },
      update: { approvedAmount: round2(amount), note, setById: ctx.userId },
    });
    await markSheetDirty(ctx.orgId);
    return NextResponse.json({ budget: row });
  } catch (e) {
    return serverError(e);
  }
}
