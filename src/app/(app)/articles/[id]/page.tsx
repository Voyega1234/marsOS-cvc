import { Metadata } from "next";
import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ArticleDetailClient } from "@/components/articles/ArticleDetailClient";

export const metadata: Metadata = { title: "Article Detail" };

export default async function ArticleDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();

  const article = await prisma.article.findUnique({
    where: { id: params.id },
    include: {
      project: {
        include: { defaultTemplate: true },
      },
      keyword: true,
      assignedTo: true,
      reviewer: true,
      createdBy: true,
      versions: { orderBy: { versionNumber: "desc" }, take: 10 },
      reviews: { include: { reviewer: true }, orderBy: { createdAt: "desc" }, take: 5 },
      comments: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 20 },
      aiJobs: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!article) notFound();

  const [users, projectArticles] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: article.project.organizationId },
      select: { id: true, name: true, role: true },
    }),
    prisma.article.findMany({
      where: { projectId: article.projectId, id: { not: params.id } },
      select: { id: true, title: true, slug: true, status: true, keyword: { select: { keyword: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <ArticleDetailClient
      article={article}
      users={users}
      currentUser={session!.user}
      projectArticles={projectArticles}
    />
  );
}
