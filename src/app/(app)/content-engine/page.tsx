import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewPrompts } from "@/services/prompts";
import { CE_TYPES } from "@/components/settings/content-engine/types";
import { ContentEngineSettingsClient } from "@/components/settings/content-engine/ContentEngineSettingsClient";

// หน้า/route นี้ query DB ตอน request เท่านั้น — ห้าม prerender ตอน build (build ไม่ควรแตะ DB)
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: "Content Engine" };

const CE_LAYER_TYPES = [
  CE_TYPES.BUSINESS_SKILL,
  CE_TYPES.MASTER_PROMPT,
  CE_TYPES.ARTICLE_BRIEF,
  CE_TYPES.VALIDATOR_PACK,
  CE_TYPES.IMAGE_PROMPT,
];

export default async function ContentEngineStudioPage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (!canViewPrompts(session.user.role)) redirect("/content-studio");

  const orgId = session.user.organizationId;
  if (!orgId) redirect("/setup");

  // Studio scope — projectId=null เท่านั้น (Studio ดึงชุดที่ Active จากที่นี่เท่านั้น)
  const prompts = await prisma.promptTemplate.findMany({
    where: { organizationId: orgId, projectId: null, type: { in: CE_LAYER_TYPES } },
    select: {
      id: true,
      name: true,
      description: true,
      promptText: true,
      type: true,
      isActive: true,
      version: true,
      updatedAt: true,
      updatedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: [{ type: "asc" }, { isActive: "desc" }, { updatedAt: "desc" }],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-brand-navy">Content Engine ของ Studio — ใช้กับเครื่องมือใน Studio เท่านั้น</h1>
      </div>
      <ContentEngineSettingsClient
        items={prompts.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          promptText: p.promptText,
          type: p.type,
          isActive: p.isActive,
          version: p.version,
          updatedAt: p.updatedAt.toISOString(),
          editorName: p.updatedBy?.name ?? p.createdBy?.name ?? null,
        }))}
        scope="studio"
        userRole={session.user.role}
      />
    </div>
  );
}
