import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runOutline, runArticleWriter, runSeoCheck } from "@/services/ai";
import { logActivity } from "@/lib/logActivity";
import type { Role } from "@/types";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action, articleIds, assignedToId } = await req.json() as {
    action: "auto-run" | "assign" | "delete" | "approve-outline" | "approve-article";
    articleIds: string[];
    assignedToId?: string;
  };

  if (!Array.isArray(articleIds) || articleIds.length === 0) {
    return NextResponse.json({ error: "No articles selected" }, { status: 400 });
  }

  const orgId = session.user.organizationId;
  const ctx = { organizationId: orgId, userId: session.user.id, userRole: session.user.role as Role };

  // Verify all articles belong to this org
  const articles = await prisma.article.findMany({
    where: { id: { in: articleIds }, project: { organizationId: orgId } },
    select: { id: true, status: true },
  });

  if (articles.length === 0) return NextResponse.json({ error: "No valid articles" }, { status: 404 });

  if (action === "assign") {
    await prisma.article.updateMany({
      where: { id: { in: articles.map((a) => a.id) } },
      data: { assignedToId: assignedToId ?? null },
    });
    logActivity({ organizationId: orgId, userId: session.user.id, action: 'BULK_ASSIGN', entityType: 'Article', entityId: articleIds.join(','), newValue: `assigned to ${assignedToId} · ${articles.length} articles` })
    return NextResponse.json({ ok: true, updated: articles.length });
  }

  if (action === "delete") {
    await prisma.article.deleteMany({ where: { id: { in: articles.map((a) => a.id) } } });
    logActivity({ organizationId: orgId, userId: session.user.id, action: 'BULK_DELETE', entityType: 'Article', entityId: articleIds.join(','), oldValue: `${articles.length} articles deleted` })
    return NextResponse.json({ ok: true, deleted: articles.length });
  }

  if (action === "approve-outline") {
    await prisma.article.updateMany({
      where: { id: { in: articles.filter((a) => a.status === "OUTLINE_DONE").map((a) => a.id) } },
      data: { status: "OUTLINE_APPROVED" },
    });
    logActivity({ organizationId: orgId, userId: session.user.id, action: 'BULK_APPROVE_OUTLINE', entityType: 'Article', entityId: articleIds.join(','), newValue: `${articles.length} outlines approved` })
    return NextResponse.json({ ok: true });
  }

  if (action === "approve-article") {
    await prisma.article.updateMany({
      where: { id: { in: articles.filter((a) => ["SEO_REVIEW", "IMAGE_PROMPT_DONE"].includes(a.status)).map((a) => a.id) } },
      data: { status: "APPROVED" },
    });
    logActivity({ organizationId: orgId, userId: session.user.id, action: 'BULK_APPROVE', entityType: 'Article', entityId: articleIds.join(','), newValue: `${articles.length} articles approved` })
    return NextResponse.json({ ok: true });
  }

  if (action === "auto-run") {
    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const article of articles) {
      try {
        const needsOutline = ["NEW", "KEYWORD_DONE", "CONTENT_MAP_DONE"].includes(article.status);
        const needsArticle = article.status === "OUTLINE_APPROVED";
        const needsSeo     = ["ARTICLE_DONE", "IMAGE_PROMPT_DONE"].includes(article.status);

        if (!needsOutline && !needsArticle && !needsSeo) {
          results.push({ id: article.id, ok: false, error: "status not actionable" });
          continue;
        }

        if (needsOutline) {
          await runOutline({ ...ctx, articleId: article.id });
          await prisma.article.update({ where: { id: article.id }, data: { status: "OUTLINE_APPROVED" } });
          try {
            await runArticleWriter({ ...ctx, articleId: article.id });
          } catch (writeErr) {
            // Roll back to OUTLINE_APPROVED so the article isn't stranded in ERROR
            await prisma.article.update({ where: { id: article.id }, data: { status: "OUTLINE_APPROVED" } }).catch(() => {});
            throw writeErr;
          }
        } else if (needsArticle) {
          await runArticleWriter({ ...ctx, articleId: article.id });
        } else if (needsSeo) {
          await runSeoCheck({ ...ctx, articleId: article.id });
        }

        results.push({ id: article.id, ok: true });
      } catch (e) {
        results.push({ id: article.id, ok: false, error: String(e) });
      }
    }

    const okCount = results.filter(r => r.ok).length
    logActivity({ organizationId: orgId, userId: session.user.id, action: 'BULK_AUTO_RUN', entityType: 'Article', entityId: articleIds.join(','), newValue: `${okCount}/${articles.length} articles processed` })
    return NextResponse.json({ ok: true, results });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
