import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { deleteClientLoginAccount, isClientLoginEmail, syncClientLoginAccount } from "@/lib/supabase/admin";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const scoped = await prisma.user.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId ?? null },
    select: { id: true, role: true, email: true },
  });
  if (!scoped) return NextResponse.json({ error: "ไม่พบ user" }, { status: 404 });

  const body = await req.json();

  if (body.password) {
    const hashed = await bcrypt.hash(body.password, 12);
    await prisma.user.update({ where: { id: params.id }, data: { password: hashed, passwordPlain: body.password } });
    // ลูกค้า login ด้วยรหัสผ่านผ่าน Supabase Auth — ตั้งรหัสเดียวกันที่นั่นด้วย (สร้างบัญชีให้ถ้ายังไม่มี)
    // เฉพาะอีเมล @mars.local — ลูกค้าที่ใช้อีเมลจริงเข้าด้วย Google ตามเดิม ไม่แตะบัญชี Supabase ของเขา
    if (scoped.role === "CLIENT" && isClientLoginEmail(scoped.email)) {
      const result = await syncClientLoginAccount({ userId: scoped.id, email: scoped.email, password: body.password });
      if (!result.ok) {
        console.warn(`[auth] client login account not ready: ${result.error} — ${scoped.email}`);
        return NextResponse.json({ ok: true, loginReady: false, loginError: result.error });
      }
      return NextResponse.json({ ok: true, loginReady: true });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.status) {
    const user = await prisma.user.update({ where: { id: params.id }, data: { status: body.status } });
    return NextResponse.json({ ok: true, status: user.status });
  }

  return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const target = await prisma.user.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId ?? null },
    select: { role: true, email: true },
  });
  if (!target) return NextResponse.json({ error: "ไม่พบ user" }, { status: 404 });
  if (target.role !== "CLIENT") return NextResponse.json({ error: "ลบได้เฉพาะ CLIENT เท่านั้น" }, { status: 403 });

  await prisma.clientProjectAccess.deleteMany({ where: { userId: params.id } });
  await prisma.user.delete({ where: { id: params.id } });
  // ลบบัญชี login ของลูกค้าใน Supabase Auth ตามไปด้วย — ลบไม่สำเร็จไม่ถือว่าล้ม
  // (ไม่มี User ใน MarsOS แล้ว บัญชีที่ค้างเข้าระบบไม่ได้อยู่ดี)
  if (isClientLoginEmail(target.email)) {
    const removed = await deleteClientLoginAccount(target.email);
    if (!removed.ok) console.warn(`[auth] client login account not removed: ${removed.error} — ${target.email}`);
  }
  return NextResponse.json({ ok: true });
}
