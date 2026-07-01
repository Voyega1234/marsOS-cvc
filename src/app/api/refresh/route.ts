import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.user.organizationId;

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status    = searchParams.get("status");

  const where: Record<string, unknown> = { organizationId: orgId };
  if (projectId) where.projectId = projectId;
  if (status)    where.status    = status;

  const items = await (prisma as any).contentRefreshItem.findMany({
    where,
    include: { project: { select: { id: true, name: true, clientName: true } } },
    orderBy: [{ priority: "asc" }, { daysOld: "desc" }],
  });

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId || !session.user.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId  = session.user.organizationId;
  const userId = session.user.id;
  const body   = await req.json();

  const {
    url, pageTitle, clientName, projectId,
    priority = "medium", reasons = [],
    notes, daysOld, clicks, impressions,
    clicksChangePct, imprsChangePct, recommendation, dueDate,
  } = body;

  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const item = await (prisma as any).contentRefreshItem.create({
    data: {
      organizationId: orgId,
      createdById: userId,
      url, pageTitle, clientName,
      ...(projectId && { projectId }),
      priority,
      reasons: JSON.stringify(reasons),
      notes, daysOld, clicks, impressions,
      clicksChangePct, imprsChangePct, recommendation, dueDate,
    },
    include: { project: { select: { id: true, name: true, clientName: true } } },
  });

  return NextResponse.json(item, { status: 201 });
}
