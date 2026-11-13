import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import ClientDetailTabs from "@/components/projects/ClientDetailTabs";
import ClientPortal from "@/components/client-portal/ClientPortal";
import { CLIENT_REVIEW_VISIBLE } from "@/lib/client-proposal/constants";

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) redirect("/setup");

  const userRole = session.user.role ?? "USER";
  const orgId = session.user.organizationId;

  // CLIENT: can only view projects explicitly assigned to them
  if (userRole === "CLIENT") {
    const access = await prisma.clientProjectAccess.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId: params.id } },
    });
    if (!access) notFound();

    // ลูกค้า: ส่งเฉพาะข้อมูลที่พอร์ทัลต้องใช้ ไม่ส่ง project เต็ม
    const [cp, reviewRows, accessRows] = await Promise.all([
      prisma.project.findUnique({
        where: { id: params.id },
        select: { id: true, name: true, clientName: true, website: true, gscSiteUrl: true, ga4PropertyId: true, logoUrl: true },
      }),
      prisma.article.findMany({
        where: {
          projectId: params.id,
          status: { in: [...CLIENT_REVIEW_VISIBLE] },
          NOT: [{ htmlContent: null }, { htmlContent: "" }],
        },
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.clientProjectAccess.findMany({
        where: { userId: session.user.id },
        select: { project: { select: { id: true, name: true, clientName: true } } },
      }),
    ]);
    if (!cp) notFound();
    return (
      <ClientPortal
        user={{ name: session.user.name ?? null }}
        project={cp}
        projects={accessRows.map((r) => r.project)}
        reviewArticles={reviewRows.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status as string,
          updatedAt: a.updatedAt.toISOString(),
        }))}
      />
    );
  } else if (!orgId) {
    redirect("/setup");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: params.id,
      organizationId: orgId!, // CLIENT ออกไปแล้วด้านบน
    },
    include: {
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
        logoUrl: project.logoUrl ?? null,
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
        themeColors: (project as any).themeColors ?? '{}',
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
