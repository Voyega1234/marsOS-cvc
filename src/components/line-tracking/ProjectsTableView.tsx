import Link from "next/link";
import { ProjectStatusSelect } from "@/components/line-tracking/ProjectStatusSelect";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import { DuplicateProjectButton } from "@/components/line-tracking/DuplicateProjectButton";
import { CheckChip, DotPill, TargetBar, TintTile } from "@/components/ui/Widgets";
import { CONNECTION_TYPES, CONNECTION_LABEL } from "@/lib/line-tracking/enums";
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

function ConnMark({ status, label }: { status: string; label: string }) {
  const state = status === "CONNECTED" ? "ok" : status === "ERROR" ? "bad" : "none";
  return <CheckChip state={state} title={`${label}: ${status}`} />;
}

// Presentation of /line-tracking/projects; shared by the real page and the preview replica.
export function ProjectsTableView({ rows, createHref, projectHref, setStatusAction, duplicateAction, renameHref }: ProjectsTableViewProps) {
  const th = "px-3 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 text-left whitespace-nowrap";
  const stickyTh = "sticky left-0 z-20 bg-gray-50";
  const totalLeads = rows.reduce((sum, r) => sum + r.leads, 0);
  const liveCount = rows.filter((r) => r.status === "LIVE").length;
  const fullyCount = rows.filter((r) => r.percent >= 100).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title mt-1">Projects</h1>
          <p className="page-subtitle mt-1">โปรเจกต์ลูกค้าทั้งหมด (แต่ละลูกค้าแยก LINE / Sheet / GA4 / Ads)</p>
        </div>
        <Link href={createHref} className="btn-primary">
          + Create Project
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TintTile tint="neutral" label="โปรเจกต์ทั้งหมด" value={rows.length.toLocaleString()} />
        <TintTile tint="mint" label="LIVE" value={liveCount.toLocaleString()} />
        <TintTile tint="blue" label="Leads รวม" value={totalLeads.toLocaleString()} />
        <TintTile tint="neutral" label="ตั้งค่าครบ 100%" value={fullyCount.toLocaleString()} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <ResizableTable storageKey="lt-projects" className="min-w-full">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className={`${th} ${stickyTh} px-5`}>Project</th>
                <th className={th}>Business</th>
                {CONNECTION_TYPES.map((t, i) => (
                  <th key={t} className={`${th} px-2 text-center ${i === 0 ? "border-l border-gray-200" : ""}`}>{CONNECTION_LABEL[t]}</th>
                ))}
                <th className={`${th} border-l border-gray-200`}>Connected</th>
                <th className={th}>Setup</th>
                <th className={th}>Status</th>
                <th className={`${th} px-5`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-sm text-gray-500">
                    ยังไม่มีโปรเจกต์ — เริ่มด้วย “Create Project”
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} className="group align-middle hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-5 py-3 text-sm text-gray-700 group-hover:bg-gray-50">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <Link href={projectHref(p.id)} className="font-medium text-blue-600 hover:underline">
                        {p.name}
                      </Link>
                      {renameHref && (
                        <Link
                          href={renameHref(p.id)}
                          title="แก้ชื่อโปรเจกต์"
                          className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                        >
                          ✏️ แก้ชื่อ
                        </Link>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{p.clientName} · {p.leads} leads</div>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-500">{p.businessType}</td>
                  {CONNECTION_TYPES.map((t, i) => (
                    <td key={t} className={`px-2 py-3 text-center ${i === 0 ? "border-l border-gray-200" : ""}`}>
                      <ConnMark status={p.statusMap[t]} label={CONNECTION_LABEL[t]} />
                    </td>
                  ))}
                  <td className="border-l border-gray-200 px-3 py-3">
                    {/* A project rarely needs all nine channels, so a low count is not a fault:
                        red only when a connection reports an error. */}
                    <DotPill
                      tone={CONNECTION_TYPES.some((t) => p.statusMap[t] === "ERROR") ? "red" : "blue"}
                      title="connected / total"
                    >
                      {CONNECTION_TYPES.filter((t) => p.statusMap[t] === "CONNECTED").length}/{CONNECTION_TYPES.length}
                    </DotPill>
                  </td>
                  <td className="w-36 px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-full min-w-[3.5rem]">
                        <TargetBar value={p.percent} max={100} size="sm" />
                      </div>
                      <span className="text-xs tabular-nums text-gray-500">{p.percent}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {/* Editable on purpose: setup progress is a hint, not a gate — a project
                        that is live with 22% of connectors wired is still live. */}
                    <ProjectStatusSelect projectId={p.id} status={p.status} action={setStatusAction} solid />
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={projectHref(p.id)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Open
                      </Link>
                      <form action={duplicateAction} onSubmit={duplicateAction ? undefined : (e) => e.preventDefault()}>
                        <input type="hidden" name="projectId" value={p.id} />
                        <DuplicateProjectButton
                          projectName={p.name}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        />
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </ResizableTable>
        </div>
      </div>
    </div>
  );
}
