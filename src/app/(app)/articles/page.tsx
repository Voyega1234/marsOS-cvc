import { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { timelineEntries } from "@/lib/project-timeline";
import { AllArticlesClient } from "@/components/articles/AllArticlesClient";
import { PBN_PREFS_MARK, PBN_CLIENT_NAME } from "@/lib/upload-article/pbn";

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

const UPLOAD_STATUS_MAP: Record<string, string> = {
  IMPORTED: "pending",
  PUSHING: "writing",
  GENERATED: "done",
  REVIEWED: "approved",
  PUSHED: "pushed",
  FAILED: "review",
};

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
    const entries = timelineEntries<TimelineEntry>((p as any).timeline);
    return entries.map((e, idx) => ({
      ...e,
      projectId: p.id,
      projectName: p.clientName ?? p.name,
      idx,
      source: "seo-sme" as const,
    }));
  });

  const uploadArticles = await prisma.uploadArticle.findMany({
    where: { organizationId: orgId, status: { not: "WRITING" } },
    select: {
      id: true,
      clientId: true,
      title: true,
      slug: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      sourceName: true,
      client: { select: { name: true, pushPrefs: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const uploadRows = uploadArticles.map((a) => {
    const isPbn = a.client.pushPrefs.includes(PBN_PREFS_MARK);
    return {
      projectId: a.clientId,
      projectName: isPbn ? PBN_CLIENT_NAME : a.client.name,
      idx: 0,
      date: a.updatedAt.toISOString().slice(0, 10),
      keyword: "",
      title: a.title,
      articleStatus: UPLOAD_STATUS_MAP[a.status] ?? "pending",
      funnel: undefined,
      slug: a.slug,
      intent: undefined,
      priority: undefined,
      volume: undefined,
      timelineBatch: undefined,
      source: (isPbn ? "pbn" : "upload-article") as "pbn" | "upload-article",
      href: isPbn ? "/pbn-backlinks?tab=review" : `/upload-article/${a.clientId}?tab=review`,
      id: `ua-${a.id}`,
    };
  });

  const projectList = projects.map((p) => ({
    id: p.id,
    name: p.clientName ?? p.name,
  }));

  return (
    <AllArticlesClient
      articles={[...allArticles, ...uploadRows]}
      projects={projectList}
    />
  );
}
