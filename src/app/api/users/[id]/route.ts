import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { role, status, name, password } = body;

  const updateData: Record<string, string> = {};
  if (role)   updateData.role   = role;
  if (status) updateData.status = status;
  if (name)   updateData.name   = name;
  if (password) {
    updateData.password = await bcrypt.hash(password, 12);
  }

  const before = role
    ? await prisma.user.findFirst({ where: { id: params.id, organizationId: session.user.organizationId }, select: { role: true } })
    : null;

  const user = await prisma.user.updateMany({
    where: { id: params.id, organizationId: session.user.organizationId },
    data: updateData,
  });

  // จด ROLE_CHANGED — /api/users/me/role ใช้ log ล่าสุดตัดสินว่าเจ้าตัวสลับกลับเป็น ADMIN เองได้ไหม
  if (role && before && before.role !== role) {
    await prisma.activityLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: "ROLE_CHANGED",
        entityType: "User",
        entityId: params.id,
        oldValue: before.role,
        newValue: String(role),
      },
    }).catch(() => {});
  }

  return NextResponse.json(user);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (params.id === session.user.id) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  await prisma.user.updateMany({
    where: { id: params.id, organizationId: session.user.organizationId },
    data: { status: "INACTIVE" },
  });

  return NextResponse.json({ ok: true });
}
