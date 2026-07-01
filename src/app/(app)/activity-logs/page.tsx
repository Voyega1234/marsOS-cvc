import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActivityLogsClient } from "@/components/professional/ActivityLogsClient";

export const metadata: Metadata = { title: "Activity Logs" };

export default async function ActivityLogsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const logs = await prisma.activityLog.findMany({
    where: { organizationId: orgId },
    include: {
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Activity Logs</h1>
        <p className="text-sm text-gray-500 mt-0.5">Last {logs.length} events in your organization</p>
      </div>
      <ActivityLogsClient
        logs={logs.map((l) => ({
          id: l.id,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          oldValue: l.oldValue,
          newValue: l.newValue,
          createdAt: l.createdAt,
          user: l.user,
        }))}
      />
    </div>
  );
}
