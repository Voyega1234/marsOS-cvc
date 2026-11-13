import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { verifyRequest } from "@/lib/backlink-management/verify-server";
import { enrichOne } from "@/lib/backlink-management/requests-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const row = await prisma.blmRequest.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
    if (!row) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 });
    if (!row.liveUrl) return NextResponse.json({ error: "ยังไม่มี URL ที่ลิงก์อยู่ กรุณาระบุก่อนตรวจ" }, { status: 400 });
    await verifyRequest(ctx.orgId, ctx.userId, row);
    return NextResponse.json({ request: await enrichOne(ctx.orgId, row.id) });
  } catch (e) {
    return serverError(e);
  }
}
