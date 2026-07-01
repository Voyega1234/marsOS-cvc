import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ClientPortalClient } from "@/components/client-portal/ClientPortalClient";

export default async function ClientPortalPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  // Non-CLIENT roles go to normal dashboard
  if (session.user.role !== "CLIENT") redirect("/dashboard");

  const userId = session.user.id;

  // Get all projects this client has access to
  const accessRows = await prisma.clientProjectAccess.findMany({
    where: { userId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          clientName: true,
          website: true,
          status: true,
          articles: {
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              wordpressUrl: true,
              createdAt: true,
              updatedAt: true,
              comments: {
                select: { id: true, body: true, createdAt: true, user: { select: { name: true, role: true } } },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
            orderBy: { updatedAt: "desc" },
          },
        },
      },
    },
  });

  const projects = accessRows.map((r) => r.project);

  return (
    <ClientPortalClient
      projects={projects}
      userName={session.user.name ?? ""}
    />
  );
}
