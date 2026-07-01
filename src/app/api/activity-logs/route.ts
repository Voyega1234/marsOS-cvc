import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const articleId = searchParams.get("articleId");
  const limit = parseInt(searchParams.get("limit") ?? "50");

  const logs = await prisma.activityLog.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(articleId ? { entityType: "Article", entityId: articleId } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });

  return NextResponse.json(logs);
}
