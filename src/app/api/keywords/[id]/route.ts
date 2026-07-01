import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();
  const keyword = await prisma.keyword.updateMany({
    where: { id: params.id, project: { organizationId: session.user.organizationId } },
    data,
  });
  logActivity({ organizationId: session.user.organizationId, userId: session.user.id, action: 'UPDATE', entityType: 'Keyword', entityId: params.id, newValue: JSON.stringify(data) })
  return NextResponse.json(keyword);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.keyword.findFirst({ where: { id: params.id, project: { organizationId: session.user.organizationId } }, select: { keyword: true } })
  await prisma.keyword.deleteMany({
    where: { id: params.id, project: { organizationId: session.user.organizationId } },
  });
  logActivity({ organizationId: session.user.organizationId, userId: session.user.id, action: 'DELETE', entityType: 'Keyword', entityId: params.id, oldValue: existing?.keyword })
  return NextResponse.json({ ok: true });
}
