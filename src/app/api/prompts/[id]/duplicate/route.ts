import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditPrompts } from "@/services/prompts";

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });

  const original = await prisma.promptTemplate.findUnique({ where: { id: params.id } });
  if (!original || original.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const copy = await prisma.promptTemplate.create({
    data: {
      organizationId: original.organizationId,
      name: `${original.name} (Copy)`,
      type: original.type,
      description: original.description,
      promptText: original.promptText,
      variables: original.variables,
      modelProvider: original.modelProvider,
      modelName: original.modelName,
      temperature: original.temperature,
      maxTokens: original.maxTokens,
      isActive: false,
      version: 1,
      createdById: session.user.id,
      updatedById: session.user.id,
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
      action: "DUPLICATE_PROMPT",
      entityType: "PromptTemplate",
      entityId: copy.id,
      newValue: JSON.stringify({ name: copy.name, copiedFrom: original.id }),
    },
  });

  return NextResponse.json(copy, { status: 201 });
}
