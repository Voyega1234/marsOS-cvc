
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import ContentMapClient from "@/components/projects/ContentMapClient";
import type { ContentMapOutput } from "@/services/ai/types";

export default async function ContentMapPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) redirect("/login");
  const orgId = session.user.organizationId;

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { id: true, name: true, website: true },
  });
  if (!project) notFound();

  // Fetch latest content-map AI job for this project
  const latestJob = await prisma.aIJob.findFirst({
    where: { projectId: params.id, jobType: "CONTENT_MAP" },
    orderBy: { createdAt: "desc" },
    select: { output: true, createdAt: true },
  });

  let contentMap: ContentMapOutput | null = null;
  if (latestJob?.output) {
    try {
      contentMap = JSON.parse(latestJob.output) as ContentMapOutput;
    } catch {}
  }

  // Existing articles for this project (to detect duplicates)
  const existingArticles = await prisma.article.findMany({
    where: { projectId: params.id },
    select: { id: true, title: true, keywordId: true },
  });

  // Existing keywords for regeneration
  const keywords = await prisma.keyword.findMany({
    where: { projectId: params.id },
    select: { id: true, keyword: true },
  });

  return (
    <ContentMapClient
      project={project}
      contentMap={contentMap}
      existingArticleTitles={existingArticles.map((a) => a.title)}
      keywordList={keywords.map((k) => k.keyword)}
    />
  );
}
