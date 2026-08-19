import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WebsiteConnectionsClient } from "@/components/settings/website-connections/WebsiteConnectionsClient";

export const metadata: Metadata = { title: "Website Connections · Settings" };

export default async function WebsiteConnectionsPage() {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/settings");

  const orgId = session.user.organizationId ?? "";

  const [wpConnections, projects] = await Promise.all([
    prisma.wordPressConnection.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        siteUrl: true,
        username: true,
        defaultStatus: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, clientName: true, website: true, wordpressConnectionId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <WebsiteConnectionsClient
      wpConnections={wpConnections.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }))}
      projects={projects}
    />
  );
}
