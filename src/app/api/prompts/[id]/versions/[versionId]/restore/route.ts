import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditPrompts, snapshotPrompt } from "@/services/prompts";

export async function POST(
  _: NextRequest,
  { params }: { params: { id: string; versionId: string } }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  const [prompt, version] = await Promise.all([
    prisma.promptTemplate.findUnique({ where: { id: params.id } }),
    prisma.promptVersion.findUnique({ where: { id: params.versionId } }),
  ]);

  if (!prompt || prompt.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }
  if (!version || version.promptTemplateId !== params.id) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  // Snapshot current state before restoring
  await snapshotPrompt(params.id, session.user.id, `Auto-snapshot before restore to v${version.versionNumber}`);

  const restored = await prisma.promptTemplate.update({
    where: { id: params.id },
    data: {
      name: version.name,
      type: version.type,
      description: version.description,
      promptText: version.promptText,
      variables: version.variables,
      modelProvider: version.modelProvider,
      modelName: version.modelName,
      temperature: version.temperature,
      maxTokens: version.maxTokens,
      version: prompt.version + 1,
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
      action: "RESTORE_PROMPT_VERSION",
      entityType: "PromptTemplate",
      entityId: params.id,
      oldValue: JSON.stringify({ version: prompt.version }),
      newValue: JSON.stringify({ restoredFromVersion: version.versionNumber, newVersion: restored.version }),
    },
  });

  return NextResponse.json(restored);
}
