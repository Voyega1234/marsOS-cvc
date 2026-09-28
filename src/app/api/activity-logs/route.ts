import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTO_API_PREFIX, LOGIN_ACTION, LOGOUT_ACTION, PAGE_VIEW_ACTION } from "@/lib/activity-describe";

/** แปลง YYYY-MM-DD (มุมมอง Asia/Bangkok, UTC+7) เป็นขอบเขตวันแบบ UTC Date */
function bangkokDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000+07:00`);
}
function bangkokDayEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+07:00`);
}

function buildKindWhere(kind: string): Prisma.ActivityLogWhereInput | undefined {
  switch (kind) {
    case "action":
      return { action: { startsWith: AUTO_API_PREFIX } };
    case "view":
      return { action: PAGE_VIEW_ACTION };
    case "auth":
      return { action: { in: [LOGIN_ACTION, LOGOUT_ACTION] } };
    case "legacy":
      return {
        AND: [
          { action: { not: { startsWith: AUTO_API_PREFIX } } },
          { action: { notIn: [PAGE_VIEW_ACTION, LOGIN_ACTION, LOGOUT_ACTION] } },
        ],
      };
    case "no-view":
      return { action: { not: PAGE_VIEW_ACTION } };
    case "all":
      return undefined;
    default:
      return { action: { not: PAGE_VIEW_ACTION } };
  }
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const articleId = searchParams.get("articleId");
  const userId = searchParams.get("userId");
  const kind = searchParams.get("kind");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const q = searchParams.get("q");
  const before = searchParams.get("before");
  const beforeId = searchParams.get("beforeId");
  const format = searchParams.get("format");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100") || 100, 200);

  const isPagedMode = Boolean(userId || kind || from || to || q || before || format === "page");

  if (!isPagedMode) {
    const oldLimit = Math.min(parseInt(searchParams.get("limit") ?? "50") || 50, 200);
    const logs = await prisma.activityLog.findMany({
      where: {
        organizationId: session.user.organizationId,
        ...(articleId ? { entityType: "Article", entityId: articleId } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: oldLimit,
    });
    return NextResponse.json(logs);
  }

  const where: Prisma.ActivityLogWhereInput = {
    organizationId: session.user.organizationId,
    ...(articleId ? { entityType: "Article", entityId: articleId } : {}),
    ...(userId ? { userId } : {}),
  };

  const kindWhere = buildKindWhere(kind ?? "no-view");
  const andConditions: Prisma.ActivityLogWhereInput[] = [];
  if (kindWhere) andConditions.push(kindWhere);

  if (from) {
    andConditions.push({ createdAt: { gte: bangkokDayStart(from) } });
  }
  if (to) {
    andConditions.push({ createdAt: { lte: bangkokDayEnd(to) } });
  }

  if (q) {
    andConditions.push({
      OR: [
        { entityType: { contains: q, mode: "insensitive" } },
        { entityId: { contains: q, mode: "insensitive" } },
        { newValue: { contains: q, mode: "insensitive" } },
        { action: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (before) {
    const beforeDate = new Date(before);
    if (beforeId) {
      andConditions.push({
        OR: [
          { createdAt: { lt: beforeDate } },
          { AND: [{ createdAt: beforeDate }, { id: { lt: beforeId } }] },
        ],
      });
    } else {
      andConditions.push({ createdAt: { lt: beforeDate } });
    }
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const logs = await prisma.activityLog.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  const last = logs[logs.length - 1];
  const nextCursor = logs.length === limit && last ? { before: last.createdAt.toISOString(), beforeId: last.id } : null;

  return NextResponse.json({ logs, nextCursor });
}
