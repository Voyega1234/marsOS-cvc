import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { clientPasswordProblem } from "@/lib/client-login";
import { isMissingTable, profiledProjectIds } from "@/lib/brand-radar/server";
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

  // One change per request: the branches below return early, so a second change in the same body would be dropped silently
  if (Array.isArray(body.brandRadarProjectIds) && (body.password || body.status)) {
    return NextResponse.json({ error: "แก้ไขได้ทีละอย่าง: สิทธิ์ Brand Radar ต้องส่งแยกจากรหัสผ่านหรือสถานะ" }, { status: 400 });
  }

  if (body.password) {
    // บัญชีลูกค้าที่เข้าด้วยรหัสผ่าน: รหัสสั้นหรือยาวเกินที่ระบบ login รับ — ปฏิเสธก่อนบันทึก ไม่ให้รหัสใน MarsOS กับระบบ login ต่างกัน
    if (scoped.role === "CLIENT" && isClientLoginEmail(scoped.email)) {
      const passwordProblem = clientPasswordProblem(body.password);
      if (passwordProblem) return NextResponse.json({ error: passwordProblem }, { status: 400 });
    }
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

  if (Array.isArray(body.brandRadarProjectIds)) {
    const orgId = session.user.organizationId;
    if (scoped.role !== "CLIENT") {
      return NextResponse.json({ error: "ตั้งสิทธิ์ Brand Radar ได้เฉพาะ CLIENT" }, { status: 400 });
    }
    // Keep strings, dedupe, max 200
    const ids: string[] = Array.from(
      new Set((body.brandRadarProjectIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)),
    );
    if (ids.length > 200) {
      return NextResponse.json({ error: "เลือกโปรเจกต์ Brand Radar ได้ไม่เกิน 200 โปรเจกต์" }, { status: 400 });
    }
    if (ids.length > 0) {
      if (!orgId) return NextResponse.json({ error: "โปรเจกต์ Brand Radar ไม่ถูกต้อง" }, { status: 400 });
      const okIds = await profiledProjectIds(orgId, ids);
      if (okIds.length !== ids.length) {
        return NextResponse.json({ error: "โปรเจกต์ Brand Radar ไม่ถูกต้อง" }, { status: 400 });
      }
    }
    try {
      await prisma.$transaction([
        prisma.brandRadarClientAccess.deleteMany({ where: { userId: params.id } }),
        prisma.brandRadarClientAccess.createMany({
          data: ids.map((projectId) => ({ userId: params.id, projectId, organizationId: orgId as string })),
          skipDuplicates: true,
        }),
      ]);
    } catch (e) {
      if (isMissingTable(e)) {
        return NextResponse.json(
          { error: "ยังไม่ได้สร้างตารางสิทธิ์ Brand Radar ให้รันไฟล์ scripts/sql/add-brand-radar-client-access.sql ใน Supabase ก่อน" },
          { status: 400 },
        );
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
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

  // Brand Radar access rows (table may not exist yet)
  try {
    await prisma.brandRadarClientAccess.deleteMany({ where: { userId: params.id } });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  // One transaction: a failed user delete must not leave the login without its article access rows
  await prisma.$transaction([
    prisma.clientProjectAccess.deleteMany({ where: { userId: params.id } }),
    prisma.user.delete({ where: { id: params.id } }),
  ]);
  // ลบบัญชี login ของลูกค้าใน Supabase Auth ตามไปด้วย — ลบไม่สำเร็จไม่ถือว่าล้ม
  // (ไม่มี User ใน MarsOS แล้ว บัญชีที่ค้างเข้าระบบไม่ได้อยู่ดี)
  if (isClientLoginEmail(target.email)) {
    const removed = await deleteClientLoginAccount(target.email);
    if (!removed.ok) console.warn(`[auth] client login account not removed: ${removed.error} — ${target.email}`);
  }
  return NextResponse.json({ ok: true });
}
