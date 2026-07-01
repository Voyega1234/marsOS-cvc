import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PromptEditorClient } from "@/components/prompts/PromptEditorClient";

export const metadata: Metadata = { title: "Prompt Editor" };

export default async function PromptEditorPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  const orgId = session.user.organizationId;
  if (!orgId || !["ADMIN", "SEO_MANAGER"].includes(role)) redirect("/dashboard");

  const prompt = await prisma.promptTemplate.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { name: true, email: true } },
      updatedBy: { select: { name: true, email: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { createdBy: { select: { name: true, email: true } } },
        take: 50,
      },
    },
  });

  if (!prompt || prompt.organizationId !== orgId) notFound();

  // Fetch activity logs for this prompt
  const activity = await prisma.activityLog.findMany({
    where: {
      organizationId: orgId,
      entityType: "PromptTemplate",
      entityId: params.id,
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <PromptEditorClient
      prompt={{
        id: prompt.id,
        name: prompt.name,
        type: prompt.type,
        description: prompt.description ?? "",
        promptText: prompt.promptText,
        variables: prompt.variables,
        modelProvider: prompt.modelProvider,
        modelName: prompt.modelName,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        isActive: prompt.isActive,
        version: prompt.version,
      }}
      orgId={orgId}
      userRole={role}
      versions={prompt.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        name: v.name,
        type: v.type,
        description: v.description,
        promptText: v.promptText,
        modelProvider: v.modelProvider,
        modelName: v.modelName,
        temperature: v.temperature,
        maxTokens: v.maxTokens,
        changeNote: v.changeNote,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
      }))}
      activity={activity.map((a) => ({
        id: a.id,
        action: a.action,
        createdAt: a.createdAt,
        user: a.user,
        newValue: a.newValue,
      }))}
    />
  );
}
