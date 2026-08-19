import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AIJobsClient } from "@/components/professional/AIJobsClient";

export const metadata: Metadata = { title: "AI Cost · Settings" };

// หน้า AI (track cost ทั้งหมด) ย้ายมาเป็น subpage ของ Settings
// แยกค่าใช้จ่ายต่อ project (client) และงาน Studio (ไม่ผูก project) ชัดเจน
export default async function SettingsAiCostPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) redirect("/setup");
  if (!["ADMIN", "SEO_MANAGER"].includes(session!.user.role)) redirect("/settings");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [jobs, monthStats, jobsByType, costByProject] = await Promise.all([
    prisma.aIJob.findMany({
      where: { organizationId: orgId },
      include: {
        article: { select: { id: true, title: true } },
        createdBy: { select: { name: true } },
        project: { select: { name: true, clientName: true } },
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
  const projectIds = costByProject.map((c) => c.projectId).filter(Boolean) as string[];
  if (projectIds.length > 0) {
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, clientName: true },
    });
    projects.forEach((p) => { projectNames[p.id] = p.clientName ?? p.name; });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-brand-navy">AI Cost</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          ค่าใช้จ่าย AI ทั้งหมด — แยกตาม client project และงาน Studio · {jobs.length} jobs
        </p>
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
          // แยกที่มา: งานของ client project หรือ Studio (ไม่ผูก project)
          projectName: j.project ? (j.project.clientName ?? j.project.name) : null,
        }))}
        totalCostMonth={(monthStats._sum.estimatedCost ?? 0) + ((monthStats._sum as any).externalCost ?? 0)}
        totalTokensMonth={monthStats._sum.tokenUsed ?? 0}
        jobCountByType={jobsByType.map((jt) => ({
          jobType: jt.jobType,
          count: jt._count.id,
          cost: (jt._sum.estimatedCost ?? 0) + ((jt._sum as any).externalCost ?? 0),
        }))}
        costByProject={costByProject.map((c) => ({
          projectId: c.projectId ?? "studio",
          // งานที่ไม่ผูก project = งานจากหน้า Studio — แยก bucket ชัดเจน
          projectName: c.projectId ? (projectNames[c.projectId] ?? c.projectId) : "Studio (ไม่ผูก project)",
          cost: (c._sum.estimatedCost ?? 0) + ((c._sum as any).externalCost ?? 0),
          tokens: c._sum.tokenUsed ?? 0,
          jobs: c._count.id,
        }))}
      />
    </div>
  );
}
