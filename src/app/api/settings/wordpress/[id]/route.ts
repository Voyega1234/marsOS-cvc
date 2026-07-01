import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  

  const orgId = session!.user.organizationId ?? "";

  const existing = await prisma.wordPressConnection.findFirst({
    where: { id: params.id, organizationId: orgId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Unlink any projects pointing to this connection before deleting
  await prisma.project.updateMany({
    where: { wordpressConnectionId: params.id },
    data:  { wordpressConnectionId: null },
  });

  await prisma.wordPressConnection.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  

  const orgId = session!.user.organizationId ?? "";
  const body = await req.json();

  const existing = await prisma.wordPressConnection.findFirst({
    where: { id: params.id, organizationId: orgId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.wordPressConnection.update({
    where: { id: params.id },
    data: {
      name: body.name ?? existing.name,
      defaultStatus: body.defaultStatus ?? existing.defaultStatus,
    },
    select: { id: true, name: true, siteUrl: true, username: true, defaultStatus: true, createdAt: true },
  });

  return NextResponse.json(updated);
}
