import { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AllArticlesClient } from "@/components/articles/AllArticlesClient";

export const metadata: Metadata = { title: "บทความทั้งหมด" };

interface TimelineEntry {
  date: string;
  keyword: string;
  title: string;
  articleStatus: string;
  funnel?: string;
  slug?: string;
  intent?: string;
  priority?: string;
  volume?: number;
  timelineBatch?: string;
}

export default async function ArticlesPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const projects = await prisma.project.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, clientName: true, timeline: true },
    orderBy: { updatedAt: "desc" },
  });

  // Flatten all timeline entries across projects
  const allArticles = projects.flatMap((p) => {
    let entries: TimelineEntry[] = [];
    try { entries = JSON.parse((p as any).timeline || "[]"); } catch { /* ignore */ }
    return entries.map((e, idx) => ({
      ...e,
      projectId: p.id,
      projectName: p.clientName ?? p.name,
      idx,
    }));
  });

  const projectList = projects.map((p) => ({
    id: p.id,
    name: p.clientName ?? p.name,
  }));

  return (
    <AllArticlesClient
      articles={allArticles}
      projects={projectList}
    />
  );
}
