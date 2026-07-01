
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WebsiteConnectClient } from "@/components/website-connect/WebsiteConnectClient";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Website Connect" };

export default async function WebsiteConnectPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId ?? "";

  const [wpConnections, siteConnections] = await Promise.all([
    prisma.wordPressConnection.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, siteUrl: true, username: true, defaultStatus: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.siteConnection.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, platform: true, siteUrl: true,
        credentialMasked: true, extraConfig: true, status: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <WebsiteConnectClient
      initialWpConnections={wpConnections}
      initialSiteConnections={siteConnections as never}
    />
  );
}
