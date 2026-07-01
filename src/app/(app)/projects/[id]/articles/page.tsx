
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import ProjectArticlesClient from "@/components/projects/ProjectArticlesClient";

export default async function ProjectArticlesPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) redirect("/login");
  const orgId = session.user.organizationId;

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const articles = await prisma.article.findMany({
    where: { projectId: params.id, project: { organizationId: orgId } },
    include: {
      keyword: true,
      assignedTo: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <ProjectArticlesClient
      project={project}
      articles={articles}
      userId={session.user.id}
    />
  );
}
