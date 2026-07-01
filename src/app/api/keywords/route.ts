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

  const keyword = await prisma.keyword.create({
    data: {
      projectId:       project.id,
      seedKeyword:     String(body.seedKeyword ?? ""),
      keyword:         String(body.keyword ?? body.seedKeyword ?? ""),
      relatedKeywords: body.relatedKeywords ?? "[]",
      intent:          body.intent          ?? "INFORMATIONAL",
      funnelStage:     body.funnelStage     ?? "TOFU",
      priority:        Number(body.priority ?? 0),
      volume:          body.volume     != null ? Number(body.volume)     : undefined,
      difficulty:      body.difficulty != null ? Number(body.difficulty) : undefined,
      status:          body.status ?? "NEW",
    },
  });
  logActivity({ organizationId: orgId, userId: session!.user.id, action: 'CREATE', entityType: 'Keyword', entityId: keyword.id, newValue: keyword.keyword })
  return NextResponse.json(keyword, { status: 201 });
}
