import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { currentPeriod, isValidPeriod, round2 } from "@/lib/backlink-management/budget";

export const dynamic = "force-dynamic";

function shiftPeriod(p: string, delta: number): string {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const SPENT = ["PUBLISHED", "VERIFIED", "LOST"];

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const sp = req.nextUrl.searchParams;
    const cur = currentPeriod();
    let to = sp.get("to") ?? "";
    let from = sp.get("from") ?? "";
    if (!isValidPeriod(to)) to = cur;
    if (!isValidPeriod(from)) from = shiftPeriod(to, -5);
    if (from > to) [from, to] = [to, from];

    const rows = await prisma.blmRequest.findMany({
      where: { organizationId: ctx.orgId, budgetPeriod: { gte: from, lte: to } },
      select: {
        projectId: true, vendorDomain: true, budgetPeriod: true, status: true, quotedPrice: true,
        actualPrice: true, checkStatus: true,
      },
      take: 20000,
    });
    const spend = (r: (typeof rows)[number]) => (SPENT.includes(r.status) ? r.actualPrice ?? r.quotedPrice : 0);
    const isLive = (r: (typeof rows)[number]) => r.status === "VERIFIED" && (r.checkStatus === "LIVE" || r.checkStatus === "NOFOLLOW");

    const totalsSpend = rows.reduce((a, r) => a + spend(r), 0);
    const live = rows.filter(isLive).length;
    const totals = {
      requests: rows.length,
      published: rows.filter((r) => SPENT.includes(r.status)).length,
      verifiedLive: live,
      lost: rows.filter((r) => r.status === "LOST").length,
      nofollow: rows.filter((r) => r.checkStatus === "NOFOLLOW").length,
      spendActual: round2(totalsSpend),
      costPerLiveLink: live ? round2(totalsSpend / live) : null,
    };

    const months: string[] = [];
    for (let p = from; p <= to && months.length < 60; p = shiftPeriod(p, 1)) months.push(p);
    const byMonth = months.map((period) => {
      const rs = rows.filter((r) => r.budgetPeriod === period);
      return { period, requests: rs.length, published: rs.filter((r) => SPENT.includes(r.status)).length, live: rs.filter(isLive).length, spend: round2(rs.reduce((a, r) => a + spend(r), 0)) };
    });

    const projIds = Array.from(new Set(rows.map((r) => r.projectId)));
    const projects = projIds.length
      ? await prisma.project.findMany({ where: { organizationId: ctx.orgId, id: { in: projIds } }, select: { id: true, name: true } })
      : [];
    const pm = new Map(projects.map((p) => [p.id, p.name]));
    const byProject = projIds.map((id) => {
      const rs = rows.filter((r) => r.projectId === id);
      const sp2 = rs.reduce((a, r) => a + spend(r), 0);
      const lv = rs.filter(isLive).length;
      return { projectId: id, projectName: pm.get(id) ?? "(ลบแล้ว)", requests: rs.length, published: rs.filter((r) => SPENT.includes(r.status)).length, live: lv, lost: rs.filter((r) => r.status === "LOST").length, spend: round2(sp2), costPerLive: lv ? round2(sp2 / lv) : null };
    }).sort((a, b) => b.spend - a.spend);

    const vendors = Array.from(new Set(rows.filter((r) => r.vendorDomain).map((r) => r.vendorDomain)));
    const byVendor = vendors.map((domain) => {
      const rs = rows.filter((r) => r.vendorDomain === domain);
      const pub = rs.filter((r) => SPENT.includes(r.status));
      const lv = rs.filter(isLive).length;
      return { domain, requests: rs.length, published: pub.length, live: lv, spend: round2(rs.reduce((a, r) => a + spend(r), 0)), liveRate: pub.length ? Math.round((lv / pub.length) * 1000) / 10 : null };
    }).sort((a, b) => b.spend - a.spend).slice(0, 20);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const byStatus = Object.entries(counts).map(([status, count]) => ({ status, count }));

    return NextResponse.json({ from, to, totals, byMonth, byProject, byVendor, byStatus });
  } catch (e) {
    return serverError(e);
  }
}
