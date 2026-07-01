import { prisma } from "@/lib/prisma";

type NotificationType =
  | "ARTICLE_ASSIGNED"
  | "REVIEW_REQUESTED"
  | "ARTICLE_APPROVED"
  | "REVISION_REQUIRED"
  | "COMMENT_ADDED"
  | "ARTICLE_PUBLISHED";

export async function createNotification({
  userId,
  organizationId,
  type,
  title,
  body,
  link,
  entityType,
  entityId,
}: {
  userId: string;
  organizationId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}) {
  return prisma.notification.create({
    data: { userId, organizationId, type, title, body, link, entityType, entityId },
  });
}
