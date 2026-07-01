import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DataSourcesClient } from "@/components/data-sources/DataSourcesClient";

export const metadata: Metadata = { title: "Data Sources" };

export default async function DataSourcesPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const [dataSources, dataBrainFiles, projects] = await Promise.all([
    prisma.dataSource.findMany({
      where: { organizationId: orgId },
      select: { id: true, type: true, name: true, status: true, lastSyncAt: true, syncError: true, projectId: true, config: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dataBrainFile.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, originalName: true, mimeType: true, sizeBytes: true, summary: true, tags: true, projectId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return <DataSourcesClient dataSources={dataSources as never} dataBrainFiles={dataBrainFiles as never} projects={projects} />;
}
