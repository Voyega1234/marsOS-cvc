import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyCommentAdded } from "@/services/notify";

async function verifyArticleAccess(articleId: string, session: Awaited<ReturnType<typeof getSession>>) {
  if (!session?.user?.id) return null;
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, projectId: true, project: { select: { organizationId: true } } },
  });
  if (!article) return null;

  const userRole = session.user.role ?? '';
  if (userRole === 'CLIENT') {
    const access = await prisma.clientProjectAccess.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId: article.projectId } },
    });
    if (!access) return null;
  } else {
    if (article.project.organizationId !== session.user.organizationId) return null;
  }
  return article;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const article = await verifyArticleAccess(params.id, session);
  if (!article) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const comments = await prisma.comment.findMany({
    where: { articleId: params.id },
    include: { user: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(comments);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const article = await verifyArticleAccess(params.id, session);
  if (!article) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { body, fieldName } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });

  const comment = await prisma.comment.create({
    data: { articleId: params.id, userId: session!.user.id, body: body.trim(), fieldName: fieldName ?? null },
    include: { user: { select: { name: true, role: true } } },
  });

  const orgId = article.project.organizationId;
  if (orgId) {
    notifyCommentAdded({
      articleId: params.id,
      organizationId: orgId,
      commenterId: session!.user.id,
      commenterName: session!.user.name,
      commentBody: body.trim(),
    }).catch(() => {});
  }

  return NextResponse.json(comment, { status: 201 });
}
