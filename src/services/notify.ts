/**
 * Notification helpers — Slack webhook + in-app notifications.
 * Called after AI jobs complete, status changes, or comments are posted.
 */

import { prisma } from "@/lib/prisma";

// ── Slack ─────────────────────────────────────────────────────────────────────

export async function sendSlackNotification(webhookUrl: string, text: string) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // non-critical
  }
}

// ── In-app notification ───────────────────────────────────────────────────────

export async function createNotification({
  userId, organizationId, type, title, body, link, entityType, entityId,
}: {
  userId: string;
  organizationId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}) {
  await prisma.notification.create({
    data: { userId, organizationId, type, title, body, link, entityType, entityId },
  }).catch(() => {});
}

// ── Notify article creator / assignee ─────────────────────────────────────────

export async function notifyArticleOwners({
  articleId,
  organizationId,
  type,
  title,
  body,
  excludeUserId,
}: {
  articleId: string;
  organizationId: string;
  type: string;
  title: string;
  body?: string;
  excludeUserId?: string;
}) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { createdById: true, assignedToId: true, reviewerId: true },
  });
  if (!article) return;

  const recipients = new Set([
    article.createdById,
    article.assignedToId,
    article.reviewerId,
  ].filter((id): id is string => !!id && id !== excludeUserId));

  await Promise.all(Array.from(recipients).map((userId) =>
    createNotification({ userId, organizationId, type, title, body, link: `/articles/${articleId}`, entityType: "Article", entityId: articleId })
  ));
}

// ── AI job done notification ──────────────────────────────────────────────────

const JOB_TYPE_LABEL: Record<string, string> = {
  OUTLINE:          "สร้าง Outline",
  ARTICLE:          "เขียนบทความ",
  SEO_CHECK:        "SEO Check",
  IMAGE_PROMPT:     "สร้าง Image Prompt",
  KEYWORD_RESEARCH: "วิเคราะห์ Keyword",
  CONTENT_MAP:      "สร้าง Content Map",
  WORDPRESS:        "ส่ง WordPress",
};

export async function notifyAIJobDone({
  jobId,
  jobType,
  articleId,
  organizationId,
  userId,
  failed,
  errorMessage,
}: {
  jobId: string;
  jobType: string;
  articleId: string | null;
  organizationId: string;
  userId: string;
  failed?: boolean;
  errorMessage?: string;
}) {
  const label = JOB_TYPE_LABEL[jobType] ?? jobType;
  if (failed) {
    await createNotification({
      userId,
      organizationId,
      type: "AI_JOB_FAILED",
      title: `❌ AI ทำงานผิดพลาด: ${label}`,
      body: errorMessage?.slice(0, 120),
      link: articleId ? `/articles/${articleId}` : `/ai-jobs`,
      entityType: "AIJob",
      entityId: jobId,
    });
  } else {
    await createNotification({
      userId,
      organizationId,
      type: "AI_JOB_DONE",
      title: `✅ AI เสร็จแล้ว: ${label}`,
      link: articleId ? `/articles/${articleId}` : `/ai-jobs`,
      entityType: "AIJob",
      entityId: jobId,
    });
  }
}

// ── Auto-assign article ───────────────────────────────────────────────────────

export async function autoAssignArticle(articleId: string, organizationId: string) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { project: true },
  });
  if (!article) return;

  const project = article.project as typeof article.project & {
    defaultWriterId?: string | null;
    defaultReviewerId?: string | null;
    slackWebhookUrl?: string | null;
    monthlyTarget?: number | null;
    aiCostLimit?: number | null;
  };

  const updates: Record<string, unknown> = {};
  let notifyUserId: string | null = null;
  let notifyType = "";
  let notifyTitle = "";

  if (article.status === "OUTLINE_APPROVED" && project.defaultWriterId && !article.assignedToId) {
    updates.assignedToId = project.defaultWriterId;
    notifyUserId  = project.defaultWriterId;
    notifyType    = "ARTICLE_ASSIGNED";
    notifyTitle   = `มีบทความใหม่รอคุณ: ${article.title}`;
  }

  if (["ARTICLE_DONE", "IMAGE_PROMPT_DONE", "SEO_REVIEW"].includes(article.status) && project.defaultReviewerId && !article.reviewerId) {
    updates.reviewerId = project.defaultReviewerId;
    notifyUserId  = project.defaultReviewerId;
    notifyType    = "REVIEW_REQUESTED";
    notifyTitle   = `บทความรอตรวจ SEO: ${article.title}`;
  }

  if (Object.keys(updates).length > 0) {
    await prisma.article.update({ where: { id: articleId }, data: updates }).catch(() => {});
  }

  if (notifyUserId && notifyType) {
    await createNotification({
      userId: notifyUserId,
      organizationId,
      type: notifyType,
      title: notifyTitle,
      link: `/articles/${articleId}`,
      entityType: "Article",
      entityId: articleId,
    });

    if (project.slackWebhookUrl) {
      await sendSlackNotification(
        project.slackWebhookUrl,
        `🤖 *Mars*: ${notifyTitle}\n👉 /articles/${articleId}`
      );
    }
  }
}

// ── Article status change notification ────────────────────────────────────────

export async function notifyArticleStatusChange({
  articleId,
  organizationId,
  newStatus,
  actorId,
  actorName,
}: {
  articleId: string;
  organizationId: string;
  newStatus: string;
  actorId: string;
  actorName?: string | null;
}) {
  const STATUS_NOTIFY: Record<string, { type: string; title: (actor: string, articleTitle: string) => string }> = {
    APPROVED: {
      type: "ARTICLE_APPROVED",
      title: (actor, t) => `✅ บทความได้รับการ Approve แล้ว: ${t}`,
    },
    REVISION_REQUIRED: {
      type: "REVISION_REQUIRED",
      title: (actor, t) => `✏️ ${actor} ขอแก้ไข: ${t}`,
    },
    POSTED: {
      type: "ARTICLE_PUBLISHED",
      title: (actor, t) => `🚀 บทความ Publish แล้ว: ${t}`,
    },
    SEO_REVIEW: {
      type: "REVIEW_REQUESTED",
      title: (actor, t) => `🔍 บทความรอตรวจ SEO: ${t}`,
    },
  };

  const cfg = STATUS_NOTIFY[newStatus];
  if (!cfg) return;

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, createdById: true, assignedToId: true, reviewerId: true },
  });
  if (!article) return;

  const actor = actorName ?? "ระบบ";
  const title = cfg.title(actor, article.title);

  const recipients = new Set([
    article.createdById,
    article.assignedToId,
    article.reviewerId,
  ].filter((id): id is string => !!id && id !== actorId));

  await Promise.all(Array.from(recipients).map((userId) =>
    createNotification({
      userId,
      organizationId,
      type: cfg.type,
      title,
      link: `/articles/${articleId}`,
      entityType: "Article",
      entityId: articleId,
    })
  ));
}

// ── Comment notification ──────────────────────────────────────────────────────

export async function notifyCommentAdded({
  articleId,
  organizationId,
  commenterId,
  commenterName,
  commentBody,
}: {
  articleId: string;
  organizationId: string;
  commenterId: string;
  commenterName?: string | null;
  commentBody: string;
}) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, createdById: true, assignedToId: true, reviewerId: true },
  });
  if (!article) return;

  const actor = commenterName ?? "ผู้ใช้";
  const recipients = new Set([
    article.createdById,
    article.assignedToId,
    article.reviewerId,
  ].filter((id): id is string => !!id && id !== commenterId));

  await Promise.all(Array.from(recipients).map((userId) =>
    createNotification({
      userId,
      organizationId,
      type: "COMMENT_ADDED",
      title: `💬 ${actor} แสดงความคิดเห็น: ${article.title}`,
      body: commentBody.slice(0, 100),
      link: `/articles/${articleId}`,
      entityType: "Article",
      entityId: articleId,
    })
  ));
}

// ── Cost alert ────────────────────────────────────────────────────────────────

export async function checkCostAlert(organizationId: string, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } }) as {
    aiCostLimit?: number | null;
    slackWebhookUrl?: string | null;
    ownerId?: string | null;
  } | null;
  if (!project?.aiCostLimit) return;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const result = await prisma.aIJob.aggregate({
    where: { organizationId, projectId, createdAt: { gte: startOfMonth } },
    _sum: { estimatedCost: true },
  });

  const spent = result._sum.estimatedCost ?? 0;
  const pct = spent / project.aiCostLimit;

  if (pct >= 0.9) {
    if (project.slackWebhookUrl) {
      await sendSlackNotification(
        project.slackWebhookUrl,
        `⚠️ *Mars Cost Alert*: ใช้ AI ไปแล้ว $${spent.toFixed(2)} จากงบ $${project.aiCostLimit.toFixed(2)} (${Math.round(pct * 100)}%) เดือนนี้`
      );
    }

    // In-app: notify all admins in the org
    const admins = await prisma.user.findMany({
      where: { organizationId, role: { in: ["ADMIN", "SEO_MANAGER"] } },
      select: { id: true },
    });
    await Promise.all(admins.map((u) =>
      createNotification({
        userId: u.id,
        organizationId,
        type: "COST_ALERT",
        title: `⚠️ ใกล้ถึง AI Budget: ${Math.round(pct * 100)}% ของงบเดือนนี้`,
        body: `ใช้ไปแล้ว $${spent.toFixed(2)} / $${project.aiCostLimit!.toFixed(2)}`,
        link: `/ai-jobs`,
        entityType: "Project",
        entityId: projectId,
      })
    ));
  }
}
