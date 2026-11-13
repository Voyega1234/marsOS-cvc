import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { verifyRequest } from "@/lib/backlink-management/verify-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAP = 15;
const CONCURRENCY = 3;

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const b = await req.json().catch(() => ({}));
    const ids: string[] | null = Array.isArray(b.ids) ? b.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, CAP) : null;
    // before (ไม่บังคับ) = เวลาที่เริ่มรอบ "ตรวจทั้งหมด" — นับเฉพาะแถวที่ยังไม่ถูกตรวจตั้งแต่เวลานั้น เพื่อให้ remaining ลดลงจนเป็น 0
    const before = typeof b.before === "string" && !Number.isNaN(Date.parse(b.before)) ? new Date(b.before) : null;
    const baseWhere = {
      organizationId: ctx.orgId, liveUrl: { not: "" }, status: { in: ["PUBLISHED", "VERIFIED", "LOST"] },
      ...(before ? { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: before } }] } : {}),
    };
    let rows;
    let remaining = 0;
    if (ids && ids.length) {
      rows = await prisma.blmRequest.findMany({ where: { organizationId: ctx.orgId, id: { in: ids }, liveUrl: { not: "" } } });
    } else {
      const total = await prisma.blmRequest.count({ where: baseWhere });
      rows = await prisma.blmRequest.findMany({
        where: baseWhere,
        orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }],
        take: CAP,
      });
      remaining = Math.max(0, total - rows.length);
    }
    const results: { id: string; checkStatus: string; status: string }[] = [];
    let idx = 0;
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        try {
          const r = await verifyRequest(ctx.orgId, ctx.userId, row);
          results.push({ id: row.id, ...r });
        } catch {
          results.push({ id: row.id, checkStatus: "PAGE_ERROR", status: row.status });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    return NextResponse.json({ checked: results.length, results, remaining });
  } catch (e) {
    return serverError(e);
  }
}
