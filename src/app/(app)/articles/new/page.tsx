import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { QuickCreateClient } from "@/components/articles/QuickCreateClient";

export const metadata: Metadata = { title: "สร้างบทความใหม่" };

export default async function NewArticlePage() {
  const session = await getSession();
  if (!session?.user?.organizationId) redirect("/login");

  const orgId = session.user.organizationId;

  const projects = await prisma.project.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      automationMode: true,
      language: true,
      keywords: {
        select: { id: true, keyword: true, funnelStage: true, intent: true },
        orderBy: { priority: "asc" },
        take: 50,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <QuickCreateClient
      projects={projects}
      userId={session.user.id}
      userRole={session.user.role}
    />
  );
}
