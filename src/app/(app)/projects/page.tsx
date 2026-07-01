import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreateProjectButton } from "@/components/projects/CreateProjectButton";
import ProjectsTable from "@/components/projects/ProjectsTable";

export const metadata: Metadata = { title: "Clients" };

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session?.user) return null;

  const userRole = session.user.role ?? "USER";

  // CLIENT must not see the Clients list — redirect to their assigned project if any
  if ((userRole as string) === "CLIENT") {
    const access = await prisma.clientProjectAccess.findFirst({
      where: { userId: session.user.id },
      select: { projectId: true },
    });
    if (access?.projectId) redirect(`/projects/${access.projectId}`);
    return null;
  }
  const orgId = session.user.organizationId;

  // CLIENT: only see projects explicitly assigned by admin
  let rawProjects;
  if (userRole === "CLIENT") {
    const accessList = await prisma.clientProjectAccess.findMany({
      where: { userId: session.user.id },
      include: {
        project: {
          include: {
            owner: { select: { id: true, name: true } },
            _count: { select: { articles: true, keywords: true, members: true } },
          },
        },
      },
    });
    rawProjects = accessList.map((a) => a.project);
  } else {
    if (!orgId) return null;
    rawProjects = await prisma.project.findMany({
      where: { organizationId: orgId },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { articles: true, keywords: true, members: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  interface TimelineEntry { articleStatus?: string }

  const projects = rawProjects.map((p) => {
    // Build statusMap from timeline JSON (new system) + Article model (legacy)
    let timeline: TimelineEntry[] = []
    try { timeline = JSON.parse((p as any).timeline || '[]') } catch { /* ignore */ }

    const timelineStats = { total: 0, writing: 0, review: 0, approved: 0, pushed: 0 }
    timeline.forEach((e) => {
      timelineStats.total++
      if (e.articleStatus === 'writing')  timelineStats.writing++
      if (e.articleStatus === 'review')   timelineStats.review++
      if (e.articleStatus === 'approved') timelineStats.approved++
      if (e.articleStatus === 'pushed')   timelineStats.pushed++
    })

    const proj = p as typeof p & { monthlyTarget?: number | null }
    return { ...proj, statusMap: {} as Record<string, number>, timelineStats }
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500 text-sm mt-0.5">{projects.length} clients · คลิกเพื่อดู pipeline</p>
        </div>
        {userRole !== "CLIENT" && orgId && (
          <CreateProjectButton orgId={orgId} userId={session.user.id} />
        )}
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <div className="text-5xl mb-4">📁</div>
          <h3 className="text-lg font-semibold text-gray-900">ยังไม่มี project</h3>
          <p className="text-gray-500 text-sm mt-1">สร้าง project แรกเพื่อเริ่มเขียนบทความ</p>
        </div>
      ) : (
        <ProjectsTable projects={projects.map(p => ({ ...p, logoUrl: (p as any).logoUrl ?? null, userRole }))} userRole={userRole} />
      )}
    </div>
  );
}
