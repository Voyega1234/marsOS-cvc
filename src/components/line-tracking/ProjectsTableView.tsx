import { ProjectsBoard } from "@/components/line-tracking/ProjectsBoard";
import type { ConnectionType, ProjectStatus } from "@/lib/line-tracking/enums";

export interface ProjectRow {
  id: string;
  name: string;
  clientName: string;
  businessType: string;
  status: ProjectStatus;
  leads: number;
  percent: number;
  statusMap: Record<ConnectionType, string>;
}

export interface ProjectsTableViewProps {
  rows: ProjectRow[];
  createHref: string;
  projectHref: (id: string) => string;
  setStatusAction: (formData: FormData) => Promise<void>;
  /** Server action for the Duplicate form. Omit in previews: the form then does nothing. */
  duplicateAction?: (formData: FormData) => Promise<void>;
  /** Staff only: when given, a small rename link is shown next to each project name. */
  renameHref?: (id: string) => string;
}

// Presentation of /line-tracking/projects. Runs on the server: the href functions
// cannot cross into a client component, so the links are worked out here and the
// board (laid out like the Upload Article board) gets plain strings.
export function ProjectsTableView({ rows, createHref, projectHref, setStatusAction, duplicateAction, renameHref }: ProjectsTableViewProps) {
  const boardRows = rows.map((r) => ({
    ...r,
    href: projectHref(r.id),
    ...(renameHref ? { renameHref: renameHref(r.id) } : {}),
  }));
  return (
    <ProjectsBoard
      rows={boardRows}
      createHref={createHref}
      setStatusAction={setStatusAction}
      duplicateAction={duplicateAction}
    />
  );
}
