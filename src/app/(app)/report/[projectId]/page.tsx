import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClientReportClient } from "@/components/report/ClientReportClient";

export const metadata: Metadata = { title: "Report" };

export default async function ClientReportPage({ params }: { params: { projectId: string } }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const userRole = session.user.role ?? "USER";
  const orgId = session.user.organizationId;
  const isClient = userRole === "CLIENT";

  // CLIENT: verify they have explicit access to this project
  if (isClient) {
    const access = await prisma.clientProjectAccess.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId: params.projectId } },
    });
    if (!access) notFound();
  } else if (!orgId) {
    redirect("/login");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      ...(isClient ? {} : { organizationId: orgId! }),
    },
    select: {
      id: true, name: true, clientName: true, website: true,
      gscSiteUrl: true, ga4PropertyId: true,
    },
  });

  if (!project) notFound();

  return (
    <ClientReportClient
      project={{
        id:            project.id,
        name:          project.clientName ?? project.name,
        website:       project.website ?? "",
        gscSiteUrl:    (project as { gscSiteUrl?: string | null }).gscSiteUrl ?? null,
        ga4PropertyId: project.ga4PropertyId ?? null,
      }}
      isClient={isClient}
    />
  );
}
