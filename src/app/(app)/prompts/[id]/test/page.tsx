import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TestPromptClient } from "@/components/prompts/TestPromptClient";

export const metadata: Metadata = { title: "Test Prompt" };

export default async function TestPromptPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  const orgId = session.user.organizationId;
  if (!orgId || !["ADMIN", "SEO_MANAGER"].includes(role)) redirect("/dashboard");

  const prompt = await prisma.promptTemplate.findUnique({
    where: { id: params.id },
  });

  if (!prompt || prompt.organizationId !== orgId) notFound();

  return (
    <TestPromptClient
      prompt={{
        id: prompt.id,
        name: prompt.name,
        type: prompt.type,
        promptText: prompt.promptText,
        modelProvider: prompt.modelProvider,
        modelName: prompt.modelName,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        isActive: prompt.isActive,
        version: prompt.version,
      }}
    />
  );
}
