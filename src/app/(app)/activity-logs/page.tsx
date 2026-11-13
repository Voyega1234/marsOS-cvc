import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActivityLogsClient } from "@/components/professional/ActivityLogsClient";
import { PageHeader } from "@/components/ds";

export const metadata: Metadata = { title: "Activity Logs" };

export default async function ActivityLogsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;
  // ดูได้เฉพาะ ADMIN — log มีอีเมล/การกระทำของทุกคนในทีม
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const users = await prisma.user.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Admin" title="Activity Logs" subtitle="ทุกการกระทำในระบบ — ใครทำอะไร เมื่อไร" />
      <ActivityLogsClient users={users} />
    </div>
  );
}
