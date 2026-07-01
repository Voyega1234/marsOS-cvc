
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BacklinkAssistantClient } from "@/components/backlink/BacklinkAssistantClient";

export const metadata = { title: "Backlink Assistant" };

export default async function BacklinkAssistantPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId ?? "";

  const [backlinks, projects] = await Promise.all([
    prisma.backlinkEntry.findMany({
      where: { organizationId: orgId },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, website: true },
    }),
  ]);

  return <BacklinkAssistantClient initialBacklinks={backlinks as never} projects={projects} />;
}
