import { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ContentRefreshClient } from "@/components/refresh/ContentRefreshClient";

export const metadata: Metadata = { title: "Content Refresh" };

export default async function RefreshPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const [items, projects] = await Promise.all([
    (prisma as any).contentRefreshItem.findMany({
      where: { organizationId: orgId },
      include: { project: { select: { id: true, name: true, clientName: true } } },
      orderBy: [{ priority: "asc" }, { daysOld: "desc" }],
    }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, clientName: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return (
    <ContentRefreshClient
      initialItems={items}
      projects={projects.map(p => ({ id: p.id, name: p.clientName ?? p.name }))}
    />
  );
}
