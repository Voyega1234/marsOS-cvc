import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AIJobsClient } from "@/components/professional/AIJobsClient";
import { isUploadArticleJobType, uaClientIdFromJobInput, UPLOAD_ARTICLE_PAGE_LABEL } from "@/lib/upload-article/ai-job-source";

/** หน้า/เมนูที่สร้าง job — ผูก Project = เมนู Clients, ไม่ผูก = Studio */
const CLIENTS_PAGE_LABEL = "Clients";
const STUDIO_PAGE_LABEL = "Studio";

export const metadata: Metadata = { title: "AI Jobs" };

export default async function AIJobsPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [jobs, monthStats, jobsByType, costByProject, monthUnlinked] = await Promise.all([
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
    // งานที่ไม่ผูก Project เดือนนี้ — แยกต่อเป็น Upload Article (ตามลูกค้า) กับ Studio
    prisma.aIJob.findMany({
      where: { organizationId: orgId, createdAt: { gte: startOfMonth }, projectId: null },
      select: { jobType: true, input: true, estimatedCost: true, externalCost: true, tokenUsed: true },
    }),
  ]);

  const uploadClientIds = new Set<string>();
  for (const j of jobs) { const id = uaClientIdFromJobInput(j.input); if (id) uploadClientIds.add(id); }
  for (const j of monthUnlinked) { const id = uaClientIdFromJobInput(j.input); if (id) uploadClientIds.add(id); }
  const uploadClientNames: Record<string, string> = {};
  if (uploadClientIds.size > 0) {
    const clients = await prisma.uploadClient.findMany({
      where: { id: { in: Array.from(uploadClientIds) }, organizationId: orgId },
      select: { id: true, name: true },
    });
    clients.forEach((c) => { uploadClientNames[c.id] = c.name; });
  }

  /** ที่มาของ job: ชื่อโปรเจกต์/ลูกค้า + หน้าที่ใช้ */
  function jobSource(j: { jobType: string; input: string | null; project?: { name: string; clientName: string | null } | null }): { name: string | null; page: string } {
    if (j.project) return { name: j.project.clientName ?? j.project.name, page: CLIENTS_PAGE_LABEL };
    const uaId = uaClientIdFromJobInput(j.input);
    if (uaId) return { name: uploadClientNames[uaId] ?? "ลูกค้าที่ถูกลบ", page: UPLOAD_ARTICLE_PAGE_LABEL };
    if (isUploadArticleJobType(j.jobType)) return { name: null, page: UPLOAD_ARTICLE_PAGE_LABEL };
    return { name: null, page: STUDIO_PAGE_LABEL };
  }

  const unlinkedGroups = new Map<string, { projectId: string; projectName: string; page: string; cost: number; tokens: number; jobs: number }>();
  for (const j of monthUnlinked) {
    const src = jobSource(j);
    const uaId = uaClientIdFromJobInput(j.input);
    const key = uaId ? `ua:${uaId}` : src.page === UPLOAD_ARTICLE_PAGE_LABEL ? "ua:unknown" : "none";
    const g = unlinkedGroups.get(key) ?? {
      projectId: key,
      projectName: src.name ?? (key === "ua:unknown" ? "ไม่ระบุลูกค้า (log ก่อนอัปเดต)" : "ไม่มี project"),
      page: src.page,
      cost: 0, tokens: 0, jobs: 0,
    };
    g.cost += (j.estimatedCost ?? 0) + (j.externalCost ?? 0);
    g.tokens += j.tokenUsed ?? 0;
    g.jobs += 1;
    unlinkedGroups.set(key, g);
  }

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
        <h1 className="text-xl font-bold text-brand-navy">AI Jobs</h1>
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
          projectName: jobSource(j).name,
          sourcePage: jobSource(j).page,
        }))}
        totalCostMonth={(monthStats._sum.estimatedCost ?? 0) + ((monthStats._sum as any).externalCost ?? 0)}
        totalTokensMonth={monthStats._sum.tokenUsed ?? 0}
        jobCountByType={jobsByType.map((jt) => ({
          jobType: jt.jobType,
          count: jt._count.id,
          cost: (jt._sum.estimatedCost ?? 0) + ((jt._sum as any).externalCost ?? 0),
        }))}
        costByProject={[
          ...costByProject.filter((c) => c.projectId).map((c) => ({
            projectId: c.projectId!,
            projectName: projectNames[c.projectId!] ?? c.projectId!,
            page: CLIENTS_PAGE_LABEL,
            cost: (c._sum.estimatedCost ?? 0) + ((c._sum as any).externalCost ?? 0),
            tokens: c._sum.tokenUsed ?? 0,
            jobs: c._count.id,
          })),
          ...Array.from(unlinkedGroups.values()),
        ]}
      />
    </div>
  );
}
