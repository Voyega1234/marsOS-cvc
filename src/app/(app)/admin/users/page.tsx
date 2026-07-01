import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminUsersClient } from "@/components/admin/AdminUsersClient";

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">จัดการ Users</h1>
        <p className="text-sm text-gray-500 mt-0.5">{users.length} users ในองค์กร</p>
      </div>
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
        }))}
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
