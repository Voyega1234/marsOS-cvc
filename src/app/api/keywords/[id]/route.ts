import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // อนุญาตเฉพาะฟิลด์ที่แก้ได้จากคลัง Keyword — เดิมส่ง body ทั้งก้อนเข้า Prisma
  // ทำให้เขียนทับ id / projectId / createdAt ได้
  const EDITABLE = ["keyword", "title", "volume", "difficulty", "intent", "funnelStage", "priority", "status", "relatedKeywords", "meta"] as const;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "ไม่มีฟิลด์ที่แก้ไขได้ใน request" }, { status: 400 });
  }

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
