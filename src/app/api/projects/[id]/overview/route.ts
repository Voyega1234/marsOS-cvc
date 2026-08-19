import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── Client Workspace Overview — real aggregates, no mock data ──────────────

const RECENT_ARTICLES_LIMIT = 6;
const AI_COST_BREAKDOWN_LIMIT = 5;
const PUBLISHED_STATUSES = ["POSTED", "WORDPRESS_DRAFTED"];
const REVIEW_STATUSES = ["SEO_REVIEW", "REVIEW", "REVIEWING"];

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectRow = await prisma.project.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: {
      id: true,
      name: true,
      clientName: true,
      website: true,
      industry: true,
      businessType: true,
      status: true,
      monthlyTarget: true,
      aiCostLimit: true,
      gscSiteUrl: true,
      ga4PropertyId: true,
      accentColor: true,
      createdAt: true,
      owner: { select: { name: true } },
    },
  });
  if (!projectRow) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const monthStart = startOfMonth();

  const [
    articlesByStatus,
    articlesTotal,
    publishedThisMonth,
    recentArticles,
    keywordCount,
    aiCostAgg,
    aiCostByType,
    seoTaskGroups,
    reviewPendingCount,
  ] = await Promise.all([
    prisma.article
      .groupBy({ by: ["status"], where: { projectId: params.id }, _count: { _all: true } })
      .catch(() => []),
    prisma.article.count({ where: { projectId: params.id } }).catch(() => 0),
    prisma.article
      .count({
        where: { projectId: params.id, status: { in: PUBLISHED_STATUSES }, updatedAt: { gte: monthStart } },
      })
      .catch(() => 0),
    prisma.article
      .findMany({
        where: { projectId: params.id },
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: RECENT_ARTICLES_LIMIT,
      })
      .catch(() => []),
    prisma.keyword.count({ where: { projectId: params.id } }).catch(() => 0),
    prisma.aIJob
      .aggregate({
        where: { projectId: params.id, createdAt: { gte: monthStart } },
        _sum: { estimatedCost: true },
        _count: { _all: true },
      })
      .catch(() => ({ _sum: { estimatedCost: null }, _count: { _all: 0 } })),
    prisma.aIJob
      .groupBy({
        by: ["jobType"],
        where: { projectId: params.id, createdAt: { gte: monthStart } },
        _sum: { estimatedCost: true },
        orderBy: { _sum: { estimatedCost: "desc" } },
        take: AI_COST_BREAKDOWN_LIMIT,
      })
      .catch(() => []),
    prisma.seoTask
      .groupBy({ by: ["area", "status"], where: { projectId: params.id }, _count: { _all: true } })
      .catch(() => []),
    prisma.article
      .count({ where: { projectId: params.id, status: { in: REVIEW_STATUSES } } })
      .catch(() => 0),
  ]);

  return NextResponse.json({
    project: {
      name: projectRow.name,
      clientName: projectRow.clientName,
      website: projectRow.website,
      industry: projectRow.industry,
      businessType: projectRow.businessType,
      status: projectRow.status,
      monthlyTarget: projectRow.monthlyTarget,
      aiCostLimit: projectRow.aiCostLimit,
      gscSiteUrl: projectRow.gscSiteUrl,
      ga4PropertyId: projectRow.ga4PropertyId,
      accentColor: projectRow.accentColor,
      owner: { name: projectRow.owner?.name ?? null },
      createdAt: projectRow.createdAt,
    },
    articles: {
      byStatus: articlesByStatus.map((row) => ({ status: row.status, count: row._count._all })),
      total: articlesTotal,
      publishedThisMonth,
      recent: recentArticles,
    },
    keywords: { count: keywordCount },
    aiCost: {
      totalThisMonth: aiCostAgg._sum.estimatedCost ?? 0,
      jobCountThisMonth: aiCostAgg._count._all,
      byType: aiCostByType.map((row) => ({
        jobType: row.jobType,
        cost: row._sum.estimatedCost ?? 0,
      })),
    },
    seoTasks: seoTaskGroups.map((row) => ({
      area: row.area,
      status: row.status,
      count: row._count._all,
    })),
    reviewPending: reviewPendingCount,
  });
}
