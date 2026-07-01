import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();

  if (body.password) {
    const hashed = await bcrypt.hash(body.password, 12);
    await prisma.user.update({ where: { id: params.id }, data: { password: hashed, passwordPlain: body.password } });
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

  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { role: true } });
  if (!target) return NextResponse.json({ error: "ไม่พบ user" }, { status: 404 });
  if (target.role !== "CLIENT") return NextResponse.json({ error: "ลบได้เฉพาะ CLIENT เท่านั้น" }, { status: 403 });

  await prisma.clientProjectAccess.deleteMany({ where: { userId: params.id } });
  await prisma.user.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
