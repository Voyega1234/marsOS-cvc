import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const n = await prisma.notification.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!n) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.notification.update({
    where: { id: params.id },
    data: { isRead: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const n = await prisma.notification.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!n) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.notification.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
