// Report-only: link a GSC site to an EXISTING project, or rename it.
// Clients must be created from the Clients page — this route never creates new projects.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST: link gscSiteUrl to an existing project, or create a new minimal project
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;

  const { siteUrl, projectId, displayName } = await req.json();
  if (!siteUrl) return NextResponse.json({ error: "siteUrl required" }, { status: 400 });
  // projectId is required — this route only links, never creates
  if (!projectId) return NextResponse.json({ error: "projectId required — create the client first from the Clients page" }, { status: 400 });

  // Verify project belongs to this org before linking
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { gscSiteUrl: siteUrl, ...(displayName ? { clientName: displayName } : {}) },
    select: { id: true, name: true, clientName: true, gscSiteUrl: true, ga4PropertyId: true, website: true },
  });
  return NextResponse.json(updated);
}

// PATCH: rename displayName only (clientName on the project)
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;
  const { projectId, displayName } = await req.json();
  if (!projectId || !displayName)
    return NextResponse.json({ error: "projectId and displayName required" }, { status: 400 });

  // Verify org ownership before update
  const owns = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true },
  });
  if (!owns) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const updated = await prisma.project.update({
    where: { id: projectId },
    data:  { clientName: displayName },
    select: { id: true, name: true, clientName: true, gscSiteUrl: true, ga4PropertyId: true, website: true },
  });
  return NextResponse.json(updated);
}
