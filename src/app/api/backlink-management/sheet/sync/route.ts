import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { syncSheet } from "@/lib/backlink-management/sheet-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  const b = await req.json().catch(() => ({}));
  // syncSheet ไม่ throw
  return NextResponse.json(await syncSheet(ctx.orgId, { force: b?.force === true }));
}
