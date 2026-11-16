import { NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { listSources, pullSource } from "@/lib/backlink-management/quota-server";
import { quotaFail } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const deps = { port: googleSheetsPort() };
    await pullSource(ctx.orgId, params.id, deps);
    return NextResponse.json(await listSources(ctx, deps));
  } catch (e) {
    return quotaFail(e);
  }
}
