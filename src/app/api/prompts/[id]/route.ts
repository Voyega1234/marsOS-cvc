import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewPrompts, canEditPrompts, snapshotPrompt } from "@/services/prompts";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prompt = await prisma.promptTemplate.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { createdBy: { select: { name: true, email: true } } },
        take: 20,
      },
      _count: { select: { versions: true } },
    },
  });
  if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (prompt.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(prompt);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });

  const existing = await prisma.promptTemplate.findUnique({ where: { id: params.id } });
  if (!existing || existing.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const { name, type, description, promptText, variables, modelProvider, modelName, temperature, maxTokens, changeNote } = body;

  // Snapshot the current state before overwriting
  await snapshotPrompt(params.id, session.user.id, changeNote);

  const updated = await prisma.promptTemplate.update({
    where: { id: params.id },
    data: {
      name: name?.trim() ?? existing.name,
      type: type ?? existing.type,
      description: description?.trim() ?? existing.description,
      promptText: promptText?.trim() ?? existing.promptText,
      variables: variables ?? existing.variables,
      modelProvider: modelProvider ?? existing.modelProvider,
      modelName: modelName ?? existing.modelName,
      temperature: temperature ?? existing.temperature,
      maxTokens: maxTokens ?? existing.maxTokens,
      version: existing.version + 1,
      updatedById: session.user.id,
    },
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      _count: { select: { versions: true } },
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: session.user.organizationId!,
      userId: session.user.id,
      action: "UPDATE_PROMPT",
      entityType: "PromptTemplate",
      entityId: params.id,
      oldValue: JSON.stringify({ version: existing.version, name: existing.name }),
      newValue: JSON.stringify({ version: updated.version, name: updated.name, changeNote }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });

  const existing = await prisma.promptTemplate.findUnique({ where: { id: params.id } });
  if (!existing || existing.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.isActive) {
    return NextResponse.json({ error: "Cannot delete an active prompt. Deactivate it first." }, { status: 400 });
  }

  await prisma.promptTemplate.delete({ where: { id: params.id } });

  await prisma.activityLog.create({
    data: {
      organizationId: session.user.organizationId!,
      userId: session.user.id,
      action: "DELETE_PROMPT",
      entityType: "PromptTemplate",
      entityId: params.id,
      oldValue: JSON.stringify({ name: existing.name, type: existing.type }),
    },
  });

  return NextResponse.json({ ok: true });
}
