import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  const where: Record<string, unknown> = { project: { organizationId: session.user.organizationId } };
  if (projectId) where.projectId = projectId;

  const articles = await prisma.article.findMany({
    where,
    include: { project: true, keyword: true, assignedTo: true },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(articles);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { title, projectId, funnelStage, searchIntent, brief, keywordId } = body;

  if (!projectId || !title) return NextResponse.json({ error: "title and projectId required" }, { status: 400 });

  // Verify project belongs to this org before creating article
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true, organizationId: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const article = await prisma.article.create({
    data: {
      title,
      slug: slugify(title),
      projectId,
      funnelStage: funnelStage ?? "TOFU",
      searchIntent: searchIntent ?? "INFORMATIONAL",
      brief: brief ?? null,
      keywordId: keywordId ?? null,
      status: "NEW",
      createdById: session.user.id,
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Article",
      entityId: article.id,
      newValue: JSON.stringify({ title }),
    },
  });

  return NextResponse.json(article, { status: 201 });
}
