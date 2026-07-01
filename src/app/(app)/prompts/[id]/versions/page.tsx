import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { VersionHistoryClient } from "@/components/prompts/VersionHistoryClient";

export const metadata: Metadata = { title: "Version History" };

export default async function VersionHistoryPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  const orgId = session.user.organizationId;
  if (!orgId || !["ADMIN", "SEO_MANAGER"].includes(role)) redirect("/dashboard");

  const prompt = await prisma.promptTemplate.findUnique({
    where: { id: params.id },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { createdBy: { select: { name: true, email: true } } },
      },
    },
  });

  if (!prompt || prompt.organizationId !== orgId) notFound();

  return (
    <VersionHistoryClient
      promptId={prompt.id}
      promptName={prompt.name}
      currentVersion={prompt.version}
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
      isAdmin={role === "ADMIN"}
    />
  );
}
