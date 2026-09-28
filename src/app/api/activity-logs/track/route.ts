import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/logActivity";
import { LOGOUT_ACTION, PAGE_VIEW_ACTION } from "@/lib/activity-describe";

/**
 * POST /api/activity-logs/track — จดการเปิดหน้า / ออกจากระบบ จากฝั่ง browser
 * body {event: "view", path} | {event: "logout"}
 * (path /api/activity-logs ถูกยกเว้นจาก log อัตโนมัติ — ไม่จดซ้ำ)
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId || !session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (body.event === "logout") {
    await logActivity({ organizationId: orgId, userId: session.user.id, action: LOGOUT_ACTION, entityType: "User", entityId: session.user.id });
    return NextResponse.json({ ok: true });
  }

  const raw = typeof body.path === "string" ? body.path : "";
  // เก็บแค่ pathname — ตัด query/hash ทิ้ง (อาจมี token/ข้อมูลส่วนตัว)
  const path = raw.split(/[?#]/)[0].slice(0, 300);
  if (!path.startsWith("/") || path.startsWith("/api/")) return NextResponse.json({ error: "path ไม่ถูกต้อง" }, { status: 400 });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    action: PAGE_VIEW_ACTION,
    entityType: "Page",
    entityId: path,
    newValue: JSON.stringify({ path, method: "GET" }),
  });
  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";
