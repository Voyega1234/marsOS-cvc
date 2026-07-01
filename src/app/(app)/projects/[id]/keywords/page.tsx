
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import KeywordsClient from "@/components/projects/KeywordsClient";

export default async function ProjectKeywordsPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) redirect("/login");
  const orgId = session.user.organizationId;

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const keywords = await prisma.keyword.findMany({
    where: { projectId: params.id, project: { organizationId: orgId } },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  return (
    <KeywordsClient
      project={project}
      keywords={keywords}
      userId={session.user.id}
    />
  );
}
