import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { taskId: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.seoTask.findFirst({ where: { id: params.taskId, organizationId: orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const k of ["category", "title", "detail", "url", "status", "priority", "ownerId", "evidence"] as const) {
    if (k in body) data[k] = body[k];
  }
  if ("dueDate" in body) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;

  const task = await prisma.seoTask.update({
    where: { id: params.taskId },
    data,
    include: { owner: { select: { id: true, name: true } } },
  });
  return NextResponse.json(task);
}

export async function DELETE(_: NextRequest, { params }: { params: { taskId: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.seoTask.findFirst({ where: { id: params.taskId, organizationId: orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.seoTask.delete({ where: { id: params.taskId } });
  return NextResponse.json({ ok: true });
}
