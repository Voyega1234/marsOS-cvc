import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminUsersClient } from "@/components/admin/AdminUsersClient";
import { PageHeader } from "@/components/ds";
import { buildProjectOptions } from "@/lib/brand-radar/queries";
import { isMissingTable } from "@/lib/brand-radar/server";

export const metadata: Metadata = { title: "จัดการ Users" };

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/dashboard");

  const orgId = session.user.organizationId;
  if (!orgId) redirect("/dashboard");

  const [users, projects] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId },
      include: {
        clientAccess: {
          include: { project: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, clientName: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Brand Radar projects with a profile; the page must render even if this fails
  let radarProjects: { id: string; name: string }[] = [];
  try {
    const opts = await buildProjectOptions(orgId);
    radarProjects = opts.filter((o) => o.hasProfile).map((o) => ({ id: o.id, name: o.name }));
  } catch (e) {
    console.error("[admin/users] Brand Radar project list failed", e);
    radarProjects = [];
  }

  let radarAccess: { userId: string; projectId: string }[] = [];
  try {
    radarAccess = await prisma.brandRadarClientAccess.findMany({
      where: { organizationId: orgId },
      select: { userId: true, projectId: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const radarById = new Map(radarProjects.map((p) => [p.id, p]));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Admin" title="จัดการ Users" subtitle={`${users.length} users ในองค์กร`} />
      <AdminUsersClient
        users={users.map((u) => ({
          id: u.id,
          name: u.name ?? "",
          email: u.email,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt.toISOString(),
          passwordPlain: u.passwordPlain ?? null,
          clientProjects: u.clientAccess.map((a) => ({
            projectId: a.projectId,
            projectName: a.project.name,
          })),
          radarProjects: radarAccess
            .filter((r) => r.userId === u.id && radarById.has(r.projectId))
            .map((r) => radarById.get(r.projectId)!),
        }))}
        radarProjects={radarProjects}
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          clientName: p.clientName ?? "",
        }))}
        orgId={orgId}
      />
    </div>
  );
}
