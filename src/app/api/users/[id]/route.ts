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

  const user = await prisma.user.updateMany({
    where: { id: params.id, organizationId: session.user.organizationId },
    data: updateData,
  });

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
