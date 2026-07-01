import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewPrompts, canEditPrompts, snapshotPrompt } from "@/services/prompts";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prompt = await prisma.promptTemplate.findUnique({ where: { id: params.id } });
  if (!prompt || prompt.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const versions = await prisma.promptVersion.findMany({
    where: { promptTemplateId: params.id },
    include: { createdBy: { select: { name: true, email: true } } },
    orderBy: { versionNumber: "desc" },
  });

  return NextResponse.json(versions);
}

// Explicitly save a snapshot of the current prompt (without editing it)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });

  const prompt = await prisma.promptTemplate.findUnique({ where: { id: params.id } });
  if (!prompt || prompt.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { changeNote } = await req.json().catch(() => ({}));
  const version = await snapshotPrompt(params.id, session.user.id, changeNote);

  await prisma.activityLog.create({
    data: {
      organizationId: session.user.organizationId!,
      userId: session.user.id,
      action: "SNAPSHOT_PROMPT",
      entityType: "PromptTemplate",
      entityId: params.id,
      newValue: JSON.stringify({ versionNumber: version.versionNumber, changeNote }),
    },
  });

  return NextResponse.json(version, { status: 201 });
}
