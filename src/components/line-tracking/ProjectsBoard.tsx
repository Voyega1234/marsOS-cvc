"use client";

// Client part of /line-tracking/projects. Laid out like the Upload Article board
// (UploadClientsBoard): header, search pill, filter chips, cards / table switch.
// Presentation only: the rows, links and server actions come from ProjectsTableView,
// and every action (status, duplicate, rename, open) is the same as before.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Home, Plus, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, EntityAvatar, EntityCard, EntityGrid, PageHeader, Panel, SearchPill, Segmented } from "@/components/ds";
import { useUrlState } from "@/hooks/use-url-state";
import { ProjectStatusSelect } from "@/components/line-tracking/ProjectStatusSelect";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import { DuplicateProjectButton } from "@/components/line-tracking/DuplicateProjectButton";
import { CheckChip, DotPill, TargetBar } from "@/components/ui/Widgets";
import { CONNECTION_TYPES, CONNECTION_LABEL } from "@/lib/line-tracking/enums";
import type { ConnectionType, ProjectStatus } from "@/lib/line-tracking/enums";

export interface ProjectBoardRow {
  id: string;
  name: string;
  clientName: string;
  businessType: string;
  status: ProjectStatus;
  leads: number;
  percent: number;
  statusMap: Record<ConnectionType, string>;
  href: string;
  renameHref?: string;
  /** Uploaded logo (data URI); the initials avatar is shown when absent. */
  logo?: string | null;
}

type SortKey = "recent" | "name" | "leads" | "connected" | "percent";
type SortDir = "asc" | "desc";
type Filter = "all" | "live" | "incomplete";
const VIEW_VALUES = ["cards", "table"] as const;
const SORT_STORAGE_KEY = "line-tracking:projects-sort";
const SORT_KEYS: SortKey[] = ["recent", "name", "leads", "connected", "percent"];
const SORT_LABEL: Record<Exclude<SortKey, "recent">, string> = {
  name: "Project",
  leads: "Leads",
  connected: "Connected",
  percent: "Setup",
};

const connectedCount = (r: ProjectBoardRow) => CONNECTION_TYPES.filter((t) => r.statusMap[t] === "CONNECTED").length;
const hasError = (r: ProjectBoardRow) => CONNECTION_TYPES.some((t) => r.statusMap[t] === "ERROR");

function ConnMark({ status, label }: { status: string; label: string }) {
  const state = status === "CONNECTED" ? "ok" : status === "ERROR" ? "bad" : "none";
  return <CheckChip state={state} title={`${label}: ${status}`} />;
}

const outlineBtn = "rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50";

export function ProjectsBoard({ rows, createHref, setStatusAction, duplicateAction }: {
  rows: ProjectBoardRow[];
  createHref: string;
  setStatusAction: (formData: FormData) => Promise<void>;
  duplicateAction?: (formData: FormData) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useUrlState<"cards" | "table">("view", "cards", VIEW_VALUES);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "recent", dir: "desc" });

  // Remember the sort in localStorage (read after mount so the first render matches the server).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (SORT_KEYS.includes(v?.key) && (v?.dir === "asc" || v?.dir === "desc")) setSort({ key: v.key, dir: v.dir });
    } catch { /* keep the default */ }
  }, []);

  function toggleSort(key: SortKey) {
    // Same cycle as Upload Article: first direction, other direction, back to "recent".
    const first: SortDir = key === "name" ? "asc" : "desc";
    let next: { key: SortKey; dir: SortDir };
    if (sort.key !== key) next = { key, dir: first };
    else if (sort.dir === first) next = { key, dir: first === "asc" ? "desc" : "asc" };
    else next = { key: "recent", dir: "desc" };
    setSort(next);
    try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next)); } catch { /* not needed */ }
  }

  const totalLeads = rows.reduce((sum, r) => sum + r.leads, 0);
  const liveCount = rows.filter((r) => r.status === "LIVE").length;
  const incompleteCount = rows.filter((r) => r.percent < 100).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = !q ? rows : rows.filter((r) =>
      r.name.toLowerCase().includes(q) || r.clientName.toLowerCase().includes(q) || r.businessType.toLowerCase().includes(q));
    const list = filter === "live" ? searched.filter((r) => r.status === "LIVE")
      : filter === "incomplete" ? searched.filter((r) => r.percent < 100)
      : searched;
    if (sort.key === "recent") return list;
    const sign = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    return [...list].sort((a, b) => {
      if (key === "name") return sign * a.name.localeCompare(b.name, "th");
      const av = key === "leads" ? a.leads : key === "percent" ? a.percent : connectedCount(a);
      const bv = key === "leads" ? b.leads : key === "percent" ? b.percent : connectedCount(b);
      return sign * (av - bv) || a.name.localeCompare(b.name, "th");
    });
  }, [rows, search, filter, sort]);

  function SortHead({ k, label, className = "" }: { k: SortKey; label: string; className?: string }) {
    const active = sort.key === k;
    const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button type="button" onClick={() => toggleSort(k)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold hover:text-brand-navy ${active ? "text-brand-navy" : "text-gray-500"} ${className}`}>
        {label}
        {active ? <Icon size={11} /> : <ArrowDown size={11} className="opacity-0" />}
      </button>
    );
  }

  const chipActive = (on: boolean) => (on ? "!bg-brand-navy !text-white !border-brand-navy" : "");

  const duplicateForm = (r: ProjectBoardRow) => (
    <form action={duplicateAction} onSubmit={duplicateAction ? undefined : (e) => e.preventDefault()}>
      <input type="hidden" name="projectId" value={r.id} />
      <DuplicateProjectButton projectName={r.name} className={outlineBtn} />
    </form>
  );

  const renameLink = (r: ProjectBoardRow) => r.renameHref ? (
    <Link href={r.renameHref} title="แก้ชื่อโปรเจกต์"
      className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-blue-600">
      ✏️ แก้ชื่อ
    </Link>
  ) : null;

  const th = "px-3 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 text-left whitespace-nowrap";
  const stickyTh = "sticky left-0 z-20 bg-white/90";

  return (
    <div className="px-4 py-6 sm:px-6 w-full space-y-4">
      <PageHeader
        className="!mb-2"
        eyebrow="LINE Tracking"
        title="Projects"
        subtitle={<>โปรเจกต์ลูกค้าทั้งหมด (แต่ละลูกค้าแยก LINE / Sheet / GA4 / Ads){rows.length > 0 ? ` · ${rows.length.toLocaleString()} โปรเจกต์ · Leads รวม ${totalLeads.toLocaleString()}` : ""}</>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/line-tracking"><Home size={14} className="mr-1.5" /> หน้าแรก LINE Tracking</Link>
            </Button>
            <Button asChild>
              <Link href={createHref}><Plus size={14} className="mr-1.5" /> Create Project</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SearchPill value={search} onChange={setSearch} placeholder="ค้นหาโปรเจกต์ / ลูกค้า / ธุรกิจ" className="w-full max-w-sm" />
        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={filter === "all"} onClick={() => setFilter("all")} className={chipActive(filter === "all")}>ทั้งหมด</Chip>
              <Chip active={filter === "live"} onClick={() => setFilter("live")} className={chipActive(filter === "live")}>LIVE {liveCount}</Chip>
              <Chip active={filter === "incomplete"} onClick={() => setFilter("incomplete")} className={chipActive(filter === "incomplete")}>ตั้งค่ายังไม่ครบ {incompleteCount}</Chip>
            </div>
            <p className="text-xs text-gray-500" aria-live="polite">
              {search.trim() || filter !== "all" ? `พบ ${filtered.length} จาก ${rows.length} โปรเจกต์` : `ทั้งหมด ${rows.length} โปรเจกต์ · ตั้งค่าครบ 100% ${rows.length - incompleteCount}`}
            </p>
            <Segmented<"cards" | "table"> className="ml-auto" ariaLabel="มุมมอง" value={view} onChange={setView}
              options={[{ value: "cards", label: "การ์ด" }, { value: "table", label: "ตาราง" }]} />
          </>
        )}
      </div>

      {rows.length > 0 && view === "cards" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-gray-500 mr-1">เรียง:</span>
          {(Object.keys(SORT_LABEL) as Array<keyof typeof SORT_LABEL>).map((k) => (
            <SortHead key={k} k={k} label={SORT_LABEL[k]} className="rounded-full border border-gray-200 bg-white/70 px-2.5 py-1" />
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Radio size={24} />}
            title={rows.length === 0 ? "ยังไม่มีโปรเจกต์ — เริ่มด้วย “Create Project”" : "ไม่พบโปรเจกต์ที่ค้นหา"}
            action={rows.length === 0 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={createHref}><Plus size={12} className="mr-1" /> Create Project</Link>
              </Button>
            ) : undefined}
          />
        </Panel>
      ) : view === "cards" ? (
        <EntityGrid>
          {filtered.map((r) => {
            const connected = CONNECTION_TYPES.filter((t) => r.statusMap[t] === "CONNECTED");
            const errored = CONNECTION_TYPES.filter((t) => r.statusMap[t] === "ERROR");
            return (
              <EntityCard
                key={r.id}
                className="h-full"
                avatar={<EntityAvatar label={r.name} src={r.logo ?? undefined} />}
                title={
                  <Link href={r.href} className="block max-w-full truncate hover:text-brand-blue hover:underline focus:outline-none focus-visible:underline">
                    {r.name}
                  </Link>
                }
                subtitle={<span className="truncate">{r.clientName}{r.businessType ? ` · ${r.businessType}` : ""}</span>}
                badge={renameLink(r)}
                stats={[
                  { label: "Leads", value: r.leads.toLocaleString(), tone: r.leads > 0 ? "ok" : "default" },
                  { label: "Connected", value: `${connected.length}/${CONNECTION_TYPES.length}`, tone: errored.length ? "bad" : "default" },
                  { label: "Setup", value: `${r.percent}%`, tone: r.percent >= 100 ? "ok" : "default" },
                ]}
                footerLeft={<div className="w-28"><TargetBar value={r.percent} max={100} size="sm" /></div>}
                footerRight={<ProjectStatusSelect projectId={r.id} status={r.status} action={setStatusAction} solid />}
                actions={
                  <>
                    <Button asChild size="sm"><Link href={r.href}>Open</Link></Button>
                    {duplicateForm(r)}
                  </>
                }
              >
                {/* Only connected or failing channels: a project rarely needs all nine,
                    so missing ones are not listed as faults. */}
                {connected.length + errored.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {errored.map((t) => <Chip key={t} tone="bad" title={`${CONNECTION_LABEL[t]}: ERROR`}>{CONNECTION_LABEL[t]}</Chip>)}
                    {connected.map((t) => <Chip key={t} tone="ok" title={`${CONNECTION_LABEL[t]}: CONNECTED`}>{CONNECTION_LABEL[t]}</Chip>)}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">ยังไม่เชื่อมต่อช่องทาง</p>
                )}
              </EntityCard>
            );
          })}
        </EntityGrid>
      ) : (
        <Panel padded={false}>
          <div className="overflow-x-auto rounded-3xl">
            <ResizableTable storageKey="lt-projects" className="min-w-full">
              <thead className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className={`${th} ${stickyTh} px-5`}><SortHead k="name" label="PROJECT" /></th>
                  <th className={th}>Business</th>
                  {CONNECTION_TYPES.map((t, i) => (
                    <th key={t} className={`${th} px-2 text-center ${i === 0 ? "border-l border-gray-200/70" : ""}`}>{CONNECTION_LABEL[t]}</th>
                  ))}
                  <th className={`${th} border-l border-gray-200/70`}><SortHead k="connected" label="CONNECTED" /></th>
                  <th className={th}><SortHead k="percent" label="SETUP" /></th>
                  <th className={th}>Status</th>
                  <th className={`${th} px-5`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/60">
                {filtered.map((r) => (
                  <tr key={r.id} className="group align-middle hover:bg-white/60">
                    <td className="sticky left-0 z-10 bg-white/90 px-5 py-3 text-sm text-gray-700">
                      <div className="flex items-center gap-3">
                        <EntityAvatar label={r.name} src={r.logo ?? undefined} size={36} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2">
                            <Link href={r.href} className="text-sm font-bold text-brand-navy hover:text-brand-blue hover:underline">
                              {r.name}
                            </Link>
                            {renameLink(r)}
                          </div>
                          <div className="text-xs text-gray-400">{r.clientName} · {r.leads} leads</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">{r.businessType}</td>
                    {CONNECTION_TYPES.map((t, i) => (
                      <td key={t} className={`px-2 py-3 text-center ${i === 0 ? "border-l border-gray-200/70" : ""}`}>
                        <ConnMark status={r.statusMap[t]} label={CONNECTION_LABEL[t]} />
                      </td>
                    ))}
                    <td className="border-l border-gray-200/70 px-3 py-3">
                      {/* Red only when a connection reports an error; a low count is not a fault. */}
                      <DotPill tone={hasError(r) ? "red" : "blue"} title="connected / total">
                        {connectedCount(r)}/{CONNECTION_TYPES.length}
                      </DotPill>
                    </td>
                    <td className="w-36 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-full min-w-[3.5rem]">
                          <TargetBar value={r.percent} max={100} size="sm" />
                        </div>
                        <span className="text-xs tabular-nums text-gray-500">{r.percent}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <ProjectStatusSelect projectId={r.id} status={r.status} action={setStatusAction} solid />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={r.href} className={outlineBtn}>Open</Link>
                        {duplicateForm(r)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResizableTable>
          </div>
        </Panel>
      )}
    </div>
  );
}
