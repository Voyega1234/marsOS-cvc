import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyArticleStatusChange } from "@/services/notify";
import { logActivity } from "@/lib/logActivity";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const article = await prisma.article.findFirst({
    where: { id: params.id, project: { organizationId: session.user.organizationId } },
    include: { project: true, keyword: true, assignedTo: true, reviewer: true, versions: true, reviews: true },
  });
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(article);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;

  // Verify org ownership before mutating
  const existing = await prisma.article.findFirst({
    where: { id: params.id, project: { organizationId: orgId } },
    select: { id: true, projectId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const allowed = [
    "status", "title", "brief", "outline", "htmlContent", "seoTitle", "metaDescription",
    "faqSchema", "imagePrompt", "assignedToId", "reviewerId", "wordpressUrl", "wordpressStatus",
    "competitorUrls", "dataBrainContext", "scheduledAt", "needsRefresh", "assignedAuthorId",
  ];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  const article = await prisma.article.update({ where: { id: params.id }, data });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId: session.user.id,
      action: "UPDATE",
      entityType: "Article",
      entityId: params.id,
      newValue: JSON.stringify(data),
    },
  });

  // Notify on status changes that matter to team members
  if (typeof data.status === "string") {
    notifyArticleStatusChange({
      articleId: params.id,
      organizationId: orgId,
      newStatus: data.status,
      actorId: session.user.id,
      actorName: session.user.name,
    }).catch(() => {});
  }

  return NextResponse.json(article);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;

  // Verify org ownership before deleting
  const existing = await prisma.article.findFirst({
    where: { id: params.id, project: { organizationId: orgId } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const title = (await prisma.article.findUnique({ where: { id: params.id }, select: { title: true } }))?.title
  await prisma.article.delete({ where: { id: params.id } });
  logActivity({ organizationId: orgId, userId: session.user.id, action: 'DELETE', entityType: 'Article', entityId: params.id, oldValue: title ?? params.id }).catch(() => {})
  return NextResponse.json({ ok: true });
}
