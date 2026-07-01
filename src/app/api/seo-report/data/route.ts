import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true, name: true, website: true, clientName: true, industry: true, accentColor: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startPrev    = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endPrev      = new Date(now.getFullYear(), now.getMonth(), 0);

  const [articles, prevArticles, aiJobs, keywords] = await Promise.all([
    prisma.article.findMany({
      where: { projectId },
      select: {
        id: true, title: true, status: true, funnelStage: true,
        wordpressUrl: true, auditScore: true, refreshScore: true,
        createdAt: true, updatedAt: true,
        keyword: { select: { keyword: true, volume: true, difficulty: true } },
        rankSnapshots: { orderBy: { snapshotAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.article.findMany({
      where: { projectId, createdAt: { gte: startPrev, lte: endPrev } },
      select: { status: true },
    }),
    prisma.aIJob.aggregate({
      where: { projectId, createdAt: { gte: startOfMonth } },
      _sum: { estimatedCost: true },
      _count: { id: true },
    }),
    prisma.keyword.findMany({
      where: { projectId },
      select: { keyword: true, volume: true, difficulty: true, status: true },
      orderBy: { volume: "desc" },
      take: 20,
    }),
  ]);

  const thisMonthArticles = articles.filter(
    (a) => new Date(a.createdAt) >= startOfMonth
  );

  const posted     = articles.filter((a) => a.status === "POSTED").length;
  const postedPrev = prevArticles.filter((a) => a.status === "POSTED").length;
  const drafted    = articles.filter((a) => a.status === "WORDPRESS_DRAFTED").length;
  const approved   = articles.filter((a) => a.status === "APPROVED").length;
  const total      = articles.length;

  const scoredArticles = articles.filter((a) => a.auditScore != null);
  const avgAudit = scoredArticles.length
    ? Math.round(scoredArticles.reduce((s, a) => s + (a.auditScore ?? 0), 0) / scoredArticles.length)
    : null;

  const withRank = articles.filter((a) => a.rankSnapshots[0]?.position != null);
  const avgPosition = withRank.length
    ? withRank.reduce((s, a) => s + (a.rankSnapshots[0]?.position ?? 0), 0) / withRank.length
    : null;

  const top10Count = withRank.filter((a) => (a.rankSnapshots[0]?.position ?? 99) <= 10).length;

  const statusGroups = articles.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  const funnelGroups = articles.reduce<Record<string, number>>((acc, a) => {
    acc[a.funnelStage] = (acc[a.funnelStage] || 0) + 1;
    return acc;
  }, {});

  const growthPct = postedPrev > 0
    ? Math.round(((posted - postedPrev) / postedPrev) * 100)
    : posted > 0 ? 100 : 0;

  return NextResponse.json({
    project,
    stats: {
      total, posted, drafted, approved,
      growthPct,
      avgAudit,
      avgPosition: avgPosition ? Math.round(avgPosition * 10) / 10 : null,
      top10Count,
      aiCost: aiJobs._sum.estimatedCost ?? 0,
      aiJobs: aiJobs._count.id,
      thisMonth: thisMonthArticles.length,
    },
    articles: articles.slice(0, 30).map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      funnelStage: a.funnelStage,
      wordpressUrl: a.wordpressUrl,
      auditScore: a.auditScore,
      refreshScore: a.refreshScore,
      keyword: a.keyword?.keyword ?? null,
      searchVolume: a.keyword?.volume ?? null,
      position: a.rankSnapshots[0]?.position ?? null,
      updatedAt: a.updatedAt,
    })),
    keywords: keywords.map((k) => ({
      keyword: k.keyword,
      searchVolume: k.volume,
      difficulty: k.difficulty,
      status: k.status,
    })),
    statusGroups,
    funnelGroups,
  });
}
