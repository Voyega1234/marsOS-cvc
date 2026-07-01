import { Metadata } from "next";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/settings/SettingsClient";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const [org, users, wpConnections, aiJobs, aiProviderKeys] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, email: true, role: true, status: true } }),
    prisma.wordPressConnection.findMany({ where: { organizationId: orgId } }),
    prisma.aIJob.groupBy({
      by: ["modelProvider"],
      where: { organizationId: orgId },
      _count: { id: true },
      _sum: { estimatedCost: true, tokenUsed: true },
    }),
    prisma.aIProviderKey.findMany({
      where: { organizationId: orgId },
      select: { id: true, provider: true, displayName: true, keyMasked: true, isActive: true, isDefault: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading settings...</div>}>
      <SettingsClient
        org={org}
        users={users}
        wpConnections={wpConnections}
        aiStats={aiJobs}
        aiProviderKeys={aiProviderKeys}
        currentUser={session!.user}
      />
    </Suspense>
  );
}
