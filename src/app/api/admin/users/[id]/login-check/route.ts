import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { clientLoginUsername } from "@/lib/client-login";
import { checkClientLoginAccount, isClientLoginEmail, syncClientLoginAccount } from "@/lib/supabase/admin";

/**
 * ปุ่ม "ตรวจ login" / "ซ่อม" ในหน้า จัดการ Users — ตอบว่าลูกค้าคนนี้เข้าระบบด้วยรหัสผ่านที่เก็บไว้ได้จริงหรือไม่
 * และถ้าไม่ได้ พังที่ขั้นไหน (ไม่มีบัญชีใน Supabase · รหัสไม่ตรง · Supabase ปิดทางรหัสผ่าน · กติกา MarsOS ไม่ให้ผ่าน)
 *
 * POST เท่านั้น เพราะมีผลข้างเคียง: "check" login จริงหนึ่งครั้งแล้วออกทันที · "repair" สร้าง/ตั้งรหัสบัญชีคู่ใน Supabase ใหม่
 * body: { action: "check" | "repair" }
 * 200: { ok, code, message, detail?, username, repairable, repaired? } · อื่น ๆ: { error }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const user = await prisma.user.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId ?? null },
    select: { id: true, role: true, email: true, status: true, passwordPlain: true },
  });
  if (!user) return NextResponse.json({ error: "ไม่พบ user" }, { status: 404 });

  // ตรวจได้เฉพาะบัญชีลูกค้าที่หน้า Users สร้าง (@mars.local) — ทีมและลูกค้าอีเมลจริงเข้าด้วย Google ไม่มีรหัสผ่านให้ตรวจ
  if (user.role !== "CLIENT" || !isClientLoginEmail(user.email)) {
    return NextResponse.json({ error: "ตรวจได้เฉพาะบัญชีลูกค้าที่เข้าด้วยชื่อผู้ใช้ + รหัสผ่าน" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
  if (action !== "check" && action !== "repair") {
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const username = clientLoginUsername(user.email) ?? user.email.split("@")[0];
  const input = { userId: user.id, email: user.email, password: user.passwordPlain };

  let repaired: boolean | undefined;
  if (action === "repair") {
    if (!user.passwordPlain) {
      return NextResponse.json({ error: "ไม่มีรหัสผ่านเก็บไว้ — กด “รีเซ็ต” ตั้งรหัสใหม่ก่อน" }, { status: 400 });
    }
    const synced = await syncClientLoginAccount({ userId: user.id, email: user.email, password: user.passwordPlain });
    repaired = synced.ok;
    if (!synced.ok) {
      console.warn(`[auth] client login repair failed: ${synced.error} — ${user.email}`);
      return NextResponse.json({
        ok: false,
        code: "repair_failed",
        message: `ซ่อมไม่สำเร็จ: ${synced.error}`,
        username,
        repairable: false,
        repaired: false,
      });
    }
  }

  const result = await checkClientLoginAccount(input);
  if (!result.ok) console.warn(`[auth] client login check: ${result.code}${result.detail ? ` (${result.detail})` : ""} — ${user.email}`);

  // บัญชี Supabase พร้อม แต่ User ใน MarsOS ถูกปิด — /auth/password ปฏิเสธเพราะหาแถว ACTIVE ไม่เจอ
  if (result.ok && user.status !== "ACTIVE") {
    return NextResponse.json({
      ok: false,
      code: "inactive",
      message: "บัญชีนี้ถูกปิดใช้งานใน MarsOS (สถานะไม่ใช่ ACTIVE) — เปิดใช้งานก่อน ลูกค้าจึงจะเข้าได้",
      username,
      repairable: false,
      ...(repaired !== undefined ? { repaired } : {}),
    });
  }

  // ปัญหาที่ Supabase ยังอยู่ และ User ใน MarsOS ก็ถูกปิดด้วย — บอกทั้งสองเรื่อง ไม่อย่างนั้นแก้เรื่องแรกแล้วลูกค้ายังเข้าไม่ได้
  const message = user.status !== "ACTIVE"
    ? `${result.message} · บัญชีนี้ถูกปิดใช้งานใน MarsOS ด้วย (สถานะไม่ใช่ ACTIVE) ต้องเปิดใช้งานก่อนลูกค้าจึงจะเข้าได้`
    : result.message;

  return NextResponse.json({ ...result, message, username, ...(repaired !== undefined ? { repaired } : {}) });
}
