import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CreateReviewSchema = z.object({
  articleId: z.string(),
  status: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]).default("APPROVED"),
  notes: z.string().optional(),
  seoScore: z.number().int().min(0).max(100).optional(),
  aeoScore: z.number().int().min(0).max(100).optional(),
  conversionScore: z.number().int().min(0).max(100).optional(),
  riskLevel: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const articleId = searchParams.get("articleId");

  const reviews = await prisma.review.findMany({
    where: {
      ...(articleId ? { articleId } : {}),
      article: { project: { organizationId: session.user.organizationId } },
    },
    include: {
      reviewer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(reviews);
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id || !session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreateReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { articleId, status, notes, seoScore, aeoScore, conversionScore, riskLevel } = parsed.data;

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { project: true },
  });

  if (!article || article.project.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const review = await prisma.review.create({
    data: {
      articleId,
      reviewerId: session.user.id,
      status,
      notes,
      seoScore,
      aeoScore,
      conversionScore,
      riskLevel,
    },
    include: {
      reviewer: { select: { id: true, name: true, email: true } },
    },
  });

  const newArticleStatus =
    status === "APPROVED"
      ? "APPROVED"
      : status === "REJECTED"
      ? "ERROR"
      : "REVIEWING";

  await prisma.article.update({
    where: { id: articleId },
    data: { status: newArticleStatus },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: session.user.organizationId,
      userId: session.user.id,
      action: `REVIEW_${status}`,
      entityType: "Article",
      entityId: articleId,
      newValue: notes ? JSON.stringify({ notes }) : null,
    },
  });

  return NextResponse.json(review, { status: 201 });
}
