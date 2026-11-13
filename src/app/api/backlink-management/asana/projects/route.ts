import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { listProjects, resolveToken, AsanaError } from "@/lib/backlink-management/asana";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: ctx.orgId } });
    const token = resolveToken(config);
    if (!token) return NextResponse.json({ error: "ยังไม่มี Asana token — กรอก token ก่อน หรือให้ผู้ดูแลตั้ง ASANA_ACCESS_TOKEN บนเซิร์ฟเวอร์" }, { status: 400 });
    return NextResponse.json(await listProjects(token));
  } catch (e) {
    const msg = e instanceof AsanaError ? `Asana: ${e.message}` : "โหลดรายการโปรเจกต์ Asana ไม่สำเร็จ";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
