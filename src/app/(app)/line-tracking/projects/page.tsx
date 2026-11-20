import { listProjects, setupProgress, connectionStatusMap } from "@/lib/line-tracking/services/projectService";
import { duplicateProjectAction, setProjectStatusAction } from "@/lib/line-tracking/actions";
import type { ProjectStatus } from "@/lib/line-tracking/enums";
import { ProjectsTableView } from "@/components/line-tracking/ProjectsTableView";
import { getAllProjectLogos } from "@/lib/line-tracking/services/projectLogoStore";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [projects, logos] = await Promise.all([listProjects(), getAllProjectLogos()]);

  const rows = projects.map((p) => ({
    logo: logos.get(p.id) ?? null,
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    businessType: p.businessType,
    status: p.status as ProjectStatus,
    leads: p._count.leads,
    percent: setupProgress(p.connections).percent,
    statusMap: connectionStatusMap(p.connections),
  }));

  return (
    <ProjectsTableView
      rows={rows}
      createHref="/line-tracking/projects/new"
      projectHref={(id) => `/line-tracking/projects/${id}`}
      setStatusAction={setProjectStatusAction}
      duplicateAction={duplicateProjectAction}
      renameHref={(id) => `/line-tracking/projects/${id}/settings#project-name`}
    />
  );
}
