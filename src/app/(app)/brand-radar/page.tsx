import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { clientRadarProjectIds } from "@/lib/brand-radar/server";
import { buildProjectOptionsFor } from "@/lib/brand-radar/queries";
import type { ProjectOptDTO } from "@/lib/brand-radar/types";
import BrandRadarClient from "@/components/brand-radar/BrandRadarClient";

export const dynamic = "force-dynamic";

export default async function BrandRadarPage() {
  const session = await getSession();
  if (!session?.user) redirect("/setup");
  if (!session.user.organizationId || !session.user.id) redirect("/setup");
  const clientView = session.user.role === "CLIENT";
  let allowedIds: string[] | null = null;
  if (clientView) {
    // Same predicate as the layout and /projects, so a stale row cannot cause a redirect loop.
    allowedIds = await clientRadarProjectIds(session.user.id, session.user.organizationId);
    if (allowedIds.length === 0) redirect("/projects");
  }
  // Same list as GET /api/brand-radar/projects; on any error the client fetches it itself.
  let initialProjects: ProjectOptDTO[] | undefined;
  try {
    initialProjects = await buildProjectOptionsFor(session.user.organizationId, allowedIds, clientView);
  } catch (e) {
    console.error("brand-radar initial projects:", e);
  }
  return <BrandRadarClient userRole={session.user.role} initialProjects={initialProjects} />;
}
