import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActivityLogsClient } from "@/components/professional/ActivityLogsClient";

export const metadata: Metadata = { title: "Activity Logs" };

export default async function ActivityLogsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const users = await prisma.user.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-brand-navy">Activity Logs</h1>
        <p className="text-sm text-gray-500 mt-0.5">ทุกการกระทำในระบบ — ใครทำอะไร เมื่อไร</p>
      </div>
      <ActivityLogsClient users={users} />
    </div>
  );
}
