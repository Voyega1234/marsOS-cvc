/**
 * Data Sources API
 * GET  — list data sources for org
 * POST — create / update a data source connection
 */
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sources = await prisma.dataSource.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
  });
  // Never return credentialJson to client
  return NextResponse.json(sources.map(({ credentialJson: _c, ...s }) => s));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;
  const body  = await req.json() as {
    id?: string;
    type: string;
    name: string;
    credentialJson?: Record<string, string>;
    config?: Record<string, string>;
    projectId?: string;
  };

  const data = {
    organizationId: orgId,
    type:           body.type,
    name:           body.name,
    status:         "PENDING" as const,
    credentialJson: body.credentialJson ? JSON.stringify(body.credentialJson) : null,
    config:         body.config ? JSON.stringify(body.config) : "{}",
    projectId:      body.projectId ?? null,
  };

  let source;
  if (body.id) {
    // Verify ownership before updating
    const existing = await prisma.dataSource.findFirst({ where: { id: body.id, organizationId: orgId }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    source = await prisma.dataSource.update({ where: { id: body.id }, data });
  } else {
    source = await prisma.dataSource.create({ data });
  }

  const { credentialJson: _c, ...safe } = source;
  return NextResponse.json(safe, { status: body.id ? 200 : 201 });
}
