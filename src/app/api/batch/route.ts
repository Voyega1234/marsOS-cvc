/**
 * Batch Job API
 * POST /api/batch — create a batch job (BULK_CREATE | BULK_REFRESH | BULK_OPTIMIZE)
 * GET  /api/batch — list batch jobs for org
 */
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await prisma.batchJob.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(jobs);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId  = session.user.organizationId;
  const userId = session.user.id;
  const body   = await req.json() as {
    projectId: string;
    keywords: string[];
    funnelStage?: string;
    searchIntent?: string;
    automationMode?: string;
    competitorUrls?: string[];
  };

  const { projectId, keywords, funnelStage = "TOFU", searchIntent = "INFORMATIONAL", automationMode = "FULL_AUTO", competitorUrls = [] } = body;

  if (!projectId || !keywords?.length) {
    return NextResponse.json({ error: "projectId and keywords required" }, { status: 400 });
  }

  // Verify project belongs to org
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Create batch job record — start as PENDING, move to RUNNING inside try
  const batchJob = await prisma.batchJob.create({
    data: {
      organizationId: orgId,
      projectId,
      name: `Batch: ${keywords.length} keywords`,
      type: "BULK_CREATE",
      status: "PENDING",
      totalItems: keywords.length,
      inputData: JSON.stringify({ keywords, funnelStage, searchIntent, automationMode, competitorUrls }),
      createdById: userId,
    },
  });

  const createdIds: string[] = [];
  // Track failures with reason for debuggability
  const failedItems: { keyword: string; error: string }[] = [];

  try {
    await prisma.batchJob.update({ where: { id: batchJob.id }, data: { status: "RUNNING" } });

    for (const kw of keywords) {
      try {
        const article = await prisma.article.create({
          data: {
            projectId,
            title: kw,
            slug: slugify(kw),
            funnelStage,
            searchIntent,
            status: "NEW",
            createdById: userId,
            competitorUrls: competitorUrls.length ? JSON.stringify(competitorUrls) : null,
          },
        });
        createdIds.push(article.id);
      } catch (err) {
        failedItems.push({ keyword: kw, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Trigger auto-run — collect results to report partial failures
    let autoRunFailed = 0;
    if (automationMode !== "MANUAL" && createdIds.length > 0) {
      const modeOverride = automationMode === "FULL_AUTO" ? "FULL_AUTO" : "SEMI_AUTO";
      const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      const cookie  = req.headers.get("cookie") ?? "";
      const results = await Promise.allSettled(
        createdIds.map((articleId) =>
          fetch(`${baseUrl}/api/ai/auto-run`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ articleId, modeOverride }),
          })
        )
      );
      autoRunFailed = results.filter((r) => r.status === "rejected").length;
    }

    await prisma.batchJob.update({
      where: { id: batchJob.id },
      data: {
        status: createdIds.length === 0 ? "FAILED" : "DONE",
        completedItems: createdIds.length,
        failedItems: failedItems.length,
        resultData: JSON.stringify({ articleIds: createdIds, failed: failedItems, autoRunFailed }),
      },
    });

    return NextResponse.json({
      batchJobId: batchJob.id,
      created: createdIds.length,
      failed: failedItems.length,
      failedKeywords: failedItems.map((f) => f.keyword),
      articleIds: createdIds,
    }, { status: 201 });

  } catch (err) {
    // Ensure batchJob never stays RUNNING on unexpected error
    await prisma.batchJob.update({
      where: { id: batchJob.id },
      data: {
        status: "FAILED",
        completedItems: createdIds.length,
        failedItems: keywords.length - createdIds.length,
        errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err),
      },
    }).catch(() => {});
    throw err;
  }
}
