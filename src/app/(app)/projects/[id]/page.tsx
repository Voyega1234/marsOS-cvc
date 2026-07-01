import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import ClientDetailTabs from "@/components/projects/ClientDetailTabs";

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const userRole = session.user.role ?? "USER";
  const orgId = session.user.organizationId;

  // CLIENT: can only view projects explicitly assigned to them
  if (userRole === "CLIENT") {
    const access = await prisma.clientProjectAccess.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId: params.id } },
    });
    if (!access) notFound();
  } else if (!orgId) {
    redirect("/login");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: params.id,
      ...(userRole !== "CLIENT" ? { organizationId: orgId! } : {}),
    },
    include: {
      defaultTemplate: true,
      owner: { select: { id: true, name: true } },
      _count: { select: { articles: true, keywords: true } },
    },
  });
  if (!project) notFound();

  return (
    <ClientDetailTabs
      userRole={session.user.role ?? 'MEMBER'}
      project={{
        id: project.id,
        name: project.name,
        clientName: project.clientName,
        website: project.website,
        businessType: project.businessType,
        industry: project.industry,
        language: project.language,
        notes: project.notes,
        projectContext: project.projectContext,
        imageStyleGuide: project.imageStyleGuide,
        brandTone: (project as any).brandTone ?? null,
        styleGuide: (project as any).styleGuide ?? null,
        accentColor: (project as any).accentColor ?? '#2563eb',
        articleTheme: (project as any).articleTheme ?? 'professional',
        forbiddenWords: (project as any).forbiddenWords ?? '[]',
        sampleArticle: (project as any).sampleArticle ?? null,
        internalLinks: (project as any).internalLinks ?? '[]',
        ctaSetting: (project as any).ctaSetting ?? '{}',
        authorEnabled: (project as any).authorEnabled ?? false,
        authorName: (project as any).authorName ?? null,
        authorTitle: (project as any).authorTitle ?? null,
        authorImage: (project as any).authorImage ?? null,
        authors: (project as any).authors ?? '[]',
        wordpressConnectionId: project.wordpressConnectionId ?? null,
        autoSchedule: (project as any).autoSchedule ?? false,
        gscSiteUrl: (project as any).gscSiteUrl ?? null,
        ga4PropertyId: (project as any).ga4PropertyId ?? null,
        _count: project._count,
      }}
    />
  );
}
