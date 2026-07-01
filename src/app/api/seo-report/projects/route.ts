import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;

  const projects = await prisma.project.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: {
      id: true, name: true, website: true, clientName: true,
      gscSiteUrl: true, ga4PropertyId: true,
      industry: true, language: true, accentColor: true,
      _count: { select: { articles: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(projects);
}
