import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const updated = await (prisma as any).contentRefreshItem.update({
    where: { id: params.id },
    data: {
      ...(body.status        !== undefined && { status: body.status }),
      ...(body.priority      !== undefined && { priority: body.priority }),
      ...(body.notes         !== undefined && { notes: body.notes }),
      ...(body.dueDate       !== undefined && { dueDate: body.dueDate }),
      ...(body.pageTitle     !== undefined && { pageTitle: body.pageTitle }),
      ...(body.recommendation !== undefined && { recommendation: body.recommendation }),
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await (prisma as any).contentRefreshItem.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
