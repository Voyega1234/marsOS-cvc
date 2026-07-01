import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewPrompts, canEditPrompts } from "@/services/prompts";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prompts = await prisma.promptTemplate.findMany({
    where: { organizationId: session.user.organizationId ?? "" },
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      _count: { select: { versions: true } },
    },
    orderBy: [{ type: "asc" }, { version: "desc" }],
  });
  return NextResponse.json(prompts);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });

  const body = await req.json();
  const { name, type, description, promptText, variables, modelProvider, modelName, temperature, maxTokens } = body;

  if (!name?.trim() || !type || !promptText?.trim()) {
    return NextResponse.json({ error: "name, type, and promptText are required" }, { status: 400 });
  }

  const prompt = await prisma.promptTemplate.create({
    data: {
      name: name.trim(),
      type,
      description: description?.trim() ?? "",
      promptText: promptText.trim(),
      variables: variables ?? "[]",
      modelProvider: modelProvider ?? "CLAUDE",
      modelName: modelName ?? "claude-sonnet-4-6",
      temperature: temperature ?? 0.7,
      maxTokens: maxTokens ?? 4000,
      isActive: false,
      version: 1,
      organizationId: session.user.organizationId!,
      createdById: session.user.id,
    },
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { versions: true } },
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: session.user.organizationId!,
      userId: session.user.id,
      action: "CREATE_PROMPT",
      entityType: "PromptTemplate",
      entityId: prompt.id,
      newValue: JSON.stringify({ name: prompt.name, type: prompt.type }),
    },
  });

  return NextResponse.json(prompt, { status: 201 });
}
