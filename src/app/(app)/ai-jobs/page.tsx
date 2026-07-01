import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AIJobsClient } from "@/components/professional/AIJobsClient";

export const metadata: Metadata = { title: "AI Jobs" };

export default async function AIJobsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [jobs, monthStats, jobsByType, costByProject] = await Promise.all([
    prisma.aIJob.findMany({
      where: { organizationId: orgId },
      include: {
        article: { select: { id: true, title: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.aIJob.aggregate({
      where: { organizationId: orgId, createdAt: { gte: startOfMonth } },
      _sum: { estimatedCost: true, tokenUsed: true, externalCost: true },
    }),
    prisma.aIJob.groupBy({
      by: ["jobType"],
      where: { organizationId: orgId },
      _count: { id: true },
      _sum: { estimatedCost: true, externalCost: true },
    }),
    prisma.aIJob.groupBy({
      by: ["projectId"],
      where: { organizationId: orgId, createdAt: { gte: startOfMonth } },
      _sum: { estimatedCost: true, externalCost: true, tokenUsed: true },
      _count: { id: true },
    }),
  ]);

  const projectNames: Record<string, string> = {};
  if (costByProject.length > 0) {
    const projectIds = costByProject.map((c) => c.projectId).filter(Boolean) as string[];
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    });
    projects.forEach((p) => { projectNames[p.id] = p.name; });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">AI Jobs</h1>
        <p className="text-sm text-gray-500 mt-0.5">{jobs.length} jobs total</p>
      </div>
      <AIJobsClient
        jobs={jobs.map((j) => ({
          id: j.id,
          jobType: j.jobType,
          status: j.status,
          modelProvider: j.modelProvider,
          modelName: j.modelName,
          tokenUsed: j.tokenUsed,
          estimatedCost: j.estimatedCost,
          externalCost: (j as any).externalCost ?? null,
          externalCalls: (j as any).externalCalls ?? null,
          externalApi: (j as any).externalApi ?? null,
          errorMessage: j.errorMessage,
          createdAt: j.createdAt,
          article: j.article,
          createdBy: j.createdBy,
        }))}
        totalCostMonth={(monthStats._sum.estimatedCost ?? 0) + ((monthStats._sum as any).externalCost ?? 0)}
        totalTokensMonth={monthStats._sum.tokenUsed ?? 0}
        jobCountByType={jobsByType.map((jt) => ({
          jobType: jt.jobType,
          count: jt._count.id,
          cost: (jt._sum.estimatedCost ?? 0) + ((jt._sum as any).externalCost ?? 0),
        }))}
        costByProject={costByProject.map((c) => ({
          projectId: c.projectId ?? "unknown",
          projectName: c.projectId ? (projectNames[c.projectId] ?? c.projectId) : "ไม่มี project",
          cost: (c._sum.estimatedCost ?? 0) + ((c._sum as any).externalCost ?? 0),
          tokens: c._sum.tokenUsed ?? 0,
          jobs: c._count.id,
        }))}
      />
    </div>
  );
}
