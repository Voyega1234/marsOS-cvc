/**
 * Rank Tracking API
 * GET  /api/rank?articleId=xxx  — get rank history for article
 * POST /api/rank                 — record new snapshot (from GSC sync or manual)
 */
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const articleId = searchParams.get("articleId");

  if (articleId) {
    const snapshots = await prisma.rankSnapshot.findMany({
      where: { articleId },
      orderBy: { snapshotAt: "asc" },
    });
    return NextResponse.json(snapshots);
  }

  // Org-wide: latest snapshot per article
  const orgId = session.user.organizationId;
  const articles = await prisma.article.findMany({
    where: { project: { organizationId: orgId }, status: { in: ["POSTED", "WORDPRESS_DRAFTED", "APPROVED"] } },
    select: {
      id: true, title: true, status: true,
      keyword: { select: { keyword: true } },
      project: { select: { id: true, name: true } },
      rankSnapshots: { orderBy: { snapshotAt: "desc" }, take: 1 },
    },
  });

  return NextResponse.json(articles.map((a) => ({
    articleId:    a.id,
    title:        a.title,
    keyword:      a.keyword?.keyword ?? "",
    project:      a.project.name,
    latestRank:   a.rankSnapshots[0] ?? null,
  })));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    articleId: string;
    keyword: string;
    position: number;
    clicks?: number;
    impressions?: number;
    ctr?: number;
    source?: string;
  };

  const { articleId, keyword, position, clicks = 0, impressions = 0, ctr = 0, source = "MANUAL" } = body;

  // Verify article belongs to org
  const article = await prisma.article.findFirst({
    where: { id: articleId, project: { organizationId: session.user.organizationId } },
    select: { id: true },
  });
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const snapshot = await prisma.rankSnapshot.create({
    data: { articleId, keyword, position, clicks, impressions, ctr, source },
  });

  // Update rankHistory JSON on article for quick access
  const existing = await prisma.article.findUnique({ where: { id: articleId }, select: { rankHistory: true } });
  let history: object[] = [];
  try { history = JSON.parse(existing?.rankHistory ?? "[]"); } catch {}
  history.push({ date: new Date().toISOString(), position, clicks, impressions, ctr, source });
  await prisma.article.update({
    where: { id: articleId },
    data: { rankHistory: JSON.stringify(history.slice(-52)) }, // keep 52 weeks max
  });

  return NextResponse.json(snapshot, { status: 201 });
}
