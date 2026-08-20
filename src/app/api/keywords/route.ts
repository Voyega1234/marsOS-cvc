import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  // Always scope to org — never return keywords from other orgs/clients
  const keywords = await prisma.keyword.findMany({
    where: projectId
      ? { projectId, project: { organizationId: orgId } }
      : { project: { organizationId: orgId } },
    orderBy: { priority: "asc" },
  });
  return NextResponse.json(keywords);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session!.user.organizationId;
  const body  = await req.json();

  // Verify projectId belongs to caller's org before creating
  const project = await prisma.project.findFirst({ where: { id: body.projectId, organizationId: orgId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const kw = String(body.keyword ?? body.seedKeyword ?? "").trim();

  // dedupe ด้วย (projectId, keyword) — เดิม create ทุกครั้ง ทำให้เกิดแถวซ้ำสะสม
  // (เช่น กด "ส่งเข้า Content Map" หลายรอบ จะยิง keyword ชุดเดิมเข้ามาใหม่ทั้งหมด)
  // พอมีตัวซ้ำ การลบทีละแถวใน Keyword Bank เลยเหมือนลบไม่ออก เพราะตัวซ้ำยังอยู่
  const existing = kw
    ? await prisma.keyword.findFirst({ where: { projectId: project.id, keyword: kw }, select: { id: true } })
    : null;

  const data = {
    seedKeyword:     String(body.seedKeyword ?? ""),
    keyword:         kw,
    relatedKeywords: body.relatedKeywords ?? "[]",
    intent:          body.intent          ?? "INFORMATIONAL",
    funnelStage:     body.funnelStage     ?? "TOFU",
    priority:        Number(body.priority ?? 0),
    volume:          body.volume     != null ? Number(body.volume)     : undefined,
    difficulty:      body.difficulty != null ? Number(body.difficulty) : undefined,
    status:          body.status ?? "NEW",
  };

  const keyword = existing
    ? await prisma.keyword.update({ where: { id: existing.id }, data })
    : await prisma.keyword.create({ data: { projectId: project.id, ...data } });

  logActivity({ organizationId: orgId, userId: session!.user.id, action: existing ? 'UPDATE' : 'CREATE', entityType: 'Keyword', entityId: keyword.id, newValue: keyword.keyword })
  return NextResponse.json(keyword, { status: existing ? 200 : 201 });
}
