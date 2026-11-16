import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { loadQuotaView, pullStaleSources } from "@/lib/backlink-management/quota-server";
import { quotaFail } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    const deps = { port: googleSheetsPort() };
    // pull=0: read what is already stored, without touching the sheets (used by the request form)
    if (req.nextUrl.searchParams.get("pull") !== "0") await pullStaleSources(ctx.orgId, { maxAgeMs: 10 * 60_000, budgetMs: force ? 25_000 : 8_000, force }, deps);
    return NextResponse.json(await loadQuotaView(ctx, deps));
  } catch (e) {
    return quotaFail(e);
  }
}
