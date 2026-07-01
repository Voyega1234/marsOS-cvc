import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  const where: Record<string, unknown> = { organizationId: session.user.organizationId };
  if (projectId) where.projectId = projectId;

  const entries = await prisma.backlinkEntry.findMany({
    where,
    include: { project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { projectId, targetUrl, sourceUrl, anchorText, domainRating, notes } = body;

  if (!projectId || !targetUrl) {
    return NextResponse.json({ error: "projectId and targetUrl are required" }, { status: 400 });
  }

  const entry = await prisma.backlinkEntry.create({
    data: {
      organizationId: session.user.organizationId,
      projectId,
      targetUrl,
      sourceUrl: sourceUrl || null,
      anchorText: anchorText || null,
      domainRating: domainRating ? Number(domainRating) : null,
      notes: notes || null,
      createdById: session.user.id,
    },
    include: { project: { select: { id: true, name: true } } },
  });

  return NextResponse.json(entry, { status: 201 });
}
