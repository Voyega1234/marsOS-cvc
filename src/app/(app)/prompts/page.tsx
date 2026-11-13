import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PromptLibraryClient } from "@/components/professional/PromptLibraryClient";
import { PageHeader } from "@/components/ds";

// หน้า/route นี้ query DB ตอน request เท่านั้น — ห้าม prerender ตอน build (build ไม่ควรแตะ DB)
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: "Prompt Library" };

export default async function PromptsPage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");

  const role = session.user.role;
  const orgId = session.user.organizationId;
  if (!orgId || !["ADMIN", "SEO_MANAGER"].includes(role)) redirect("/dashboard");

  const prompts = await prisma.promptTemplate.findMany({
    where: { organizationId: orgId },
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      _count: { select: { versions: true } },
    },
    orderBy: [{ type: "asc" }, { isActive: "desc" }, { version: "desc" }],
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Prompts"
        title="Prompt Library"
        subtitle={`${prompts.length} prompt${prompts.length !== 1 ? "s" : ""} · ${prompts.filter((p) => p.isActive).length} active`}
      />
      <PromptLibraryClient
        prompts={prompts.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          description: p.description,
          promptText: p.promptText,
          modelProvider: p.modelProvider,
          modelName: p.modelName,
          temperature: p.temperature,
          maxTokens: p.maxTokens,
          isActive: p.isActive,
          version: p.version,
          updatedAt: p.updatedAt,
          createdBy: p.createdBy,
          updatedBy: p.updatedBy,
          versionCount: p._count.versions,
        }))}
        userRole={role}
      />
    </div>
  );
}
