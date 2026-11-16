import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { isApprover } from "@/lib/backlink-management/types";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { addSource, listSources } from "@/lib/backlink-management/quota-server";
import { quotaFail, readJson } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    return NextResponse.json(await listSources(ctx));
  } catch (e) {
    return quotaFail(e);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะผู้ดูแลเพิ่มลิงก์ชีทได้" }, { status: 403 });
  try {
    const b = await readJson(req);
    return NextResponse.json(await addSource(ctx, { url: b.url, label: b.label }, { port: googleSheetsPort() }));
  } catch (e) {
    return quotaFail(e);
  }
}
