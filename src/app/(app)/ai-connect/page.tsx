import { Metadata } from "next";

import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AIConnectClient } from "@/components/ai-connect/AIConnectClient";

export const metadata: Metadata = { title: "AI Connect — Admin Only" };

export default async function AIConnectPage() {
  const session = await getSession();

  // Strict ADMIN-only — SEO_MANAGER and below are redirected away
  if (session?.user?.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const orgId = session.user.organizationId ?? "";

  const keys = await prisma.aIProviderKey.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      provider: true,
      displayName: true,
      keyMasked: true,
      isActive: true,
      isDefault: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return <AIConnectClient initialKeys={keys} />;
}
