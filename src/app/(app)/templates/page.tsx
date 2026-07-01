import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TemplatesClient } from "@/components/templates/TemplatesClient";

export const metadata: Metadata = { title: "Brand Templates" };

export default async function TemplatesPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const templates = await prisma.brandTemplate.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return <TemplatesClient templates={templates} orgId={orgId} />;
}
