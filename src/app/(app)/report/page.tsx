import { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SERVICE_ACCOUNT_EMAIL } from "@/lib/google-auth";
import { ReportSiteList } from "@/components/report/ReportSiteList";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportListPage() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const projects = await prisma.project.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, name: true, clientName: true, website: true,
      gscSiteUrl: true, ga4PropertyId: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <ReportSiteList
      initialProjects={projects as Parameters<typeof ReportSiteList>[0]["initialProjects"]}
      serviceEmail={SERVICE_ACCOUNT_EMAIL}
    />
  );
}
