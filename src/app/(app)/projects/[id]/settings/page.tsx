
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import ProjectSettingsClient from "@/components/projects/ProjectSettingsClient";

export default async function ProjectSettingsPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) redirect("/login");
  const orgId = session.user.organizationId;

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: orgId },
    include: {
      wordpressConnection: true,
      defaultTemplate: true,
      owner: { select: { id: true, name: true } },
    },
  });
  if (!project) notFound();

  const [wpConnections, templates, users] = await Promise.all([
    prisma.wordPressConnection.findMany({ where: { organizationId: orgId } }),
    prisma.brandTemplate.findMany({ where: { organizationId: orgId } }),
    prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, role: true } }),
  ]);

  return (
    <ProjectSettingsClient
      project={project}
      wpConnections={wpConnections}
      templates={templates}
      userRole={session.user.role}
      users={users}
    />
  );
}
