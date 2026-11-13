import { prisma } from "@/lib/prisma";
import { createNotification } from "@/services/notify";

/** Tell the team a client acted on an article. Never throws. */
export async function notifyTeamOfClientAction(args: {
  articleId: string;
  type: string;
  title: string;
  body?: string;
  link: string;
}): Promise<void> {
  try {
    const article = await prisma.article.findUnique({
      where: { id: args.articleId },
      select: {
        createdById: true,
        assignedToId: true,
        reviewerId: true,
        project: { select: { organizationId: true, ownerId: true, members: { select: { userId: true } } } },
      },
    });
    if (!article) return;
    const organizationId = article.project.organizationId;
    const candidates = [
      article.createdById,
      article.assignedToId,
      article.reviewerId,
      article.project.ownerId,
      ...article.project.members.map((m) => m.userId),
    ].filter((x): x is string => Boolean(x));

    let ids: string[] = [];
    if (candidates.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: Array.from(new Set(candidates)) }, status: "ACTIVE", role: { not: "CLIENT" } },
        select: { id: true },
      });
      ids = users.map((u) => u.id);
    }
    if (!ids.length) {
      const admins = await prisma.user.findMany({
        where: { organizationId, status: "ACTIVE", role: { in: ["ADMIN", "SEO_MANAGER"] } },
        select: { id: true },
      });
      ids = admins.map((u) => u.id);
    }
    for (const userId of Array.from(new Set(ids))) {
      try {
        await createNotification({
          userId,
          organizationId,
          type: args.type,
          title: args.title,
          body: args.body,
          link: args.link,
          entityType: "Article",
          entityId: args.articleId,
        });
      } catch (e) {
        console.warn("[client-proposal] notify failed", e);
      }
    }
  } catch (e) {
    console.warn("[client-proposal] notifyTeamOfClientAction failed", e);
  }
}
