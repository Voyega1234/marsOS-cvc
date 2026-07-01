import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BatchCreateClient } from "@/components/batch/BatchCreateClient";

export const metadata: Metadata = { title: "Batch Content Creation" };

export default async function BatchPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const [projects, recentJobs] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      select: { id: true, name: true, automationMode: true, language: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.batchJob.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return <BatchCreateClient projects={projects} recentJobs={recentJobs} />;
}
