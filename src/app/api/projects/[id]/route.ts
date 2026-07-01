import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session!.user.organizationId ?? "" },
    include: {
      defaultTemplate: true,
      wordpressConnection: true,
      owner: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      _count: { select: { articles: true, keywords: true } },
    },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session!.user.organizationId;
  const existing = await prisma.project.findFirst({ where: { id: params.id, organizationId: orgId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  // Allowlist — prevent overwriting organizationId or sensitive relations
  const allowed = ["name", "website", "businessType", "targetAudience", "language", "industry", "market",
    "status", "notes", "projectContext", "writingPrompt", "imageStyleGuide", "automationMode",
    "gtmContainerId", "ga4MeasurementId", "ga4PropertyId", "internalLinks", "themeColors",
    "wordpressConnectionId", "defaultTemplateId", "ownerId", "clientName",
    "monthlyTarget", "aiCostLimit", "slackWebhookUrl", "defaultWriterId", "defaultReviewerId",
    "wpUrl", "wpUser", "wpAppPassword",
    "timeline", "autoSchedule",
    "styleGuide", "accentColor", "articleTheme", "forbiddenWords", "sampleArticle"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) { if (key in body) data[key] = body[key]; }

  const project = await prisma.project.update({ where: { id: params.id }, data });
  const skipLog = Object.keys(data).length === 1 && ('timeline' in data || 'autoSchedule' in data)
  if (!skipLog) {
    logActivity({ organizationId: orgId, userId: session!.user.id, action: 'UPDATE', entityType: 'Project', entityId: params.id, newValue: JSON.stringify(Object.keys(data)) })
  }
  return NextResponse.json(project);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session!.user.organizationId;
  const existing = await prisma.project.findFirst({ where: { id: params.id, organizationId: orgId }, select: { id: true, name: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.project.delete({ where: { id: params.id } });
  logActivity({ organizationId: orgId, userId: session!.user.id, action: 'DELETE', entityType: 'Project', entityId: params.id, oldValue: existing.name })
  return NextResponse.json({ ok: true });
}
