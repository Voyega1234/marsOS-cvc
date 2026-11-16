import { NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { isApprover } from "@/lib/backlink-management/types";
import { removeSource } from "@/lib/backlink-management/quota-server";
import { quotaFail } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะผู้ดูแลลบลิงก์ชีทได้" }, { status: 403 });
  try {
    return NextResponse.json(await removeSource(ctx, params.id));
  } catch (e) {
    return quotaFail(e);
  }
}
