"use client";

import { useCallback, useEffect, useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { Chip, PageHeader, UnderlineTabs } from "@/components/ds";
import AsanaDialog, { type AsanaStatus } from "./AsanaDialog";
import SheetDialog, { type SheetStatus } from "./SheetDialog";
import SheetImportDialog from "./SheetImportDialog";
import BudgetTab from "./BudgetTab";
import ReportTab from "./ReportTab";
import ProjectsDialog from "./ProjectsDialog";
import QuotaTab from "./QuotaTab";
import RequestDialog from "./RequestDialog";
import RequestDrawer from "./RequestDrawer";
import RequestsTab from "./RequestsTab";
import TrackingTab from "./TrackingTab";
import VendorsTab from "./VendorsTab";
import SearchSelect from "./SearchSelect";
import { api, useAutoRefresh, type BlmRow, type Meta } from "./shared";

type TabId = "requests" | "vendors" | "budget" | "tracking" | "report" | "quota";
const TABS: { id: TabId; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "vendors", label: "Vendors" },
  { id: "budget", label: "Budget" },
  { id: "tracking", label: "Link Tracking" },
  { id: "report", label: "Report" },
  { id: "quota", label: "Quota" },
];

const TAB_IDS: readonly TabId[] = TABS.map(t => t.id);

export default function BacklinkManagementClient({ userRole }: { userRole: string }) {
  const [tab, setTab] = useUrlState<TabId>("tab", "requests", TAB_IDS);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [projectId, setProjectId] = useState("");
  const [period, setPeriod] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; edit: BlmRow | null; duplicate: BlmRow | null }>({ open: false, edit: null, duplicate: null });
  const [asana, setAsana] = useState<AsanaStatus | null>(null);
  const [asanaOpen, setAsanaOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetStatus | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetImportOpen, setSheetImportOpen] = useState(false);

  const loadMeta = useCallback(() => {
    api<Meta>("/api/backlink-management/meta")
      .then((m) => {
        setMeta(m);
        setPeriod((p) => p || m.period);
        // โปรเจกต์ที่เลือกอยู่ถูกลบไปแล้ว → กลับไปทุกโปรเจกต์
        setProjectId((cur) => (cur && !m.projects.some((p) => p.id === cur) ? "" : cur));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMeta();
    api<AsanaStatus>("/api/backlink-management/asana").then(setAsana).catch(() => {});
    api<SheetStatus>("/api/backlink-management/sheet").then(setSheet).catch(() => {});
  }, [loadMeta]);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const canApprove = meta?.me.canApprove ?? ["ADMIN", "SEO_MANAGER"].includes(userRole);
  const connected = !!asana && asana.tokenSource !== "none" && !!asana.projectGid;
  const sheetConnected = !!sheet?.connected;

  // ซิงก์ลง Google Sheet เบื้องหลัง (เงียบ ไม่บล็อก UI) — เฉพาะเมื่อเชื่อมแล้ว
  const syncSheetBg = useCallback(() => {
    api<{ status: string }>("/api/backlink-management/sheet/sync", { method: "POST", json: {} })
      .then((r) => {
        if (r.status === "synced" || r.status === "error") {
          api<SheetStatus>("/api/backlink-management/sheet").then(setSheet).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!sheetConnected) return;
    const id = window.setTimeout(syncSheetBg, 1500);
    return () => window.clearTimeout(id);
  }, [sheetConnected, refreshKey, syncSheetBg]);
  useAutoRefresh(() => { if (sheetConnected) syncSheetBg(); });

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader
        title="Backlink Management"
        subtitle="คำขอ backlink งบประมาณ และการติดตามลิงก์"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAsanaOpen(true)} aria-label="ตั้งค่า Asana">
              <Chip tone={connected ? "ok" : "warn"} dot>
                {connected ? `Asana: เชื่อมแล้ว · ${asana?.projectName}` : "Asana: ยังไม่ได้เชื่อม"}
              </Chip>
            </button>
            <button type="button" onClick={() => setSheetOpen(true)} aria-label="ตั้งค่า Google Sheet">
              <Chip tone={sheetConnected ? (sheet?.lastError ? "warn" : "ok") : "muted"} dot>
                {sheetConnected ? "Google Sheet: เชื่อมแล้ว" : "Google Sheet: ยังไม่เชื่อม"}
              </Chip>
            </button>
            {canApprove ? (
              <button type="button" onClick={() => setSheetImportOpen(true)} className="rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-white">
                นำเข้าจาก Google Sheet
              </button>
            ) : null}
            <a href="/api/backlink-management/export" download className="rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-white">
              Export Excel
            </a>
          </div>
        }
      />

      <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />

      {tab !== "vendors" && tab !== "quota" ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect
            className="!w-auto min-w-[180px]"
            value={projectId}
            onChange={setProjectId}
            emptyLabel="ทุกโปรเจกต์"
            ariaLabel="โปรเจกต์"
            options={(meta?.projects ?? []).map((p) => ({ value: p.id, label: p.manual ? `${p.name} (เพิ่มเอง)` : p.name, hint: p.clientName || undefined }))}
          />
          <button type="button" className="text-xs text-gray-600 underline" onClick={() => setProjectsOpen(true)}>+ เพิ่มโปรเจกต์</button>
          {tab !== "report" ? (
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="เดือน"
              className="h-10 rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          ) : null}
          {tab !== "report" && period ? <button type="button" className="text-xs text-gray-500 underline" onClick={() => setPeriod("")}>ทุกเดือน</button> : null}
        </div>
      ) : null}

      {tab === "requests" ? (
        <RequestsTab projectId={projectId} period={period} refreshKey={refreshKey} onOpen={setOpenId} onCreate={() => setDialog({ open: true, edit: null, duplicate: null })} onDuplicate={(row) => setDialog({ open: true, edit: null, duplicate: row })} />
      ) : null}
      {tab === "vendors" ? <VendorsTab /> : null}
      {tab === "budget" ? <BudgetTab period={period} projectId={projectId} meta={meta} refreshKey={refreshKey} /> : null}
      {tab === "tracking" ? <TrackingTab projectId={projectId} period={period} refreshKey={refreshKey} onOpen={setOpenId} onChanged={bump} /> : null}
      {tab === "report" ? <ReportTab period={meta?.period ?? ""} projectId={projectId} onOpenQuota={() => setTab("quota")} /> : null}
      {tab === "quota" ? <QuotaTab meta={meta} refreshKey={refreshKey} onOpenSheets={() => setSheetOpen(true)} /> : null}

      <RequestDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        role={userRole}
        userId={meta?.me.id ?? ""}
        onChanged={bump}
        onEdit={(row) => setDialog({ open: true, edit: row, duplicate: null })}
        onDuplicate={(row) => { setOpenId(null); setDialog({ open: true, edit: null, duplicate: row }); }}
      />
      <RequestDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        meta={meta}
        edit={dialog.edit}
        duplicateFrom={dialog.duplicate}
        asana={asana}
        defaultProjectId={projectId}
        defaultPeriod={period || meta?.period || ""}
        onSaved={bump}
      />
      <ProjectsDialog open={projectsOpen} onOpenChange={setProjectsOpen} users={meta?.users} asana={asana} onChanged={() => { loadMeta(); bump(); }} />
      <SheetDialog open={sheetOpen} onOpenChange={setSheetOpen} status={sheet} canEdit={canApprove && (sheet?.canEdit ?? true)} onChanged={setSheet} onSourcesChanged={bump} />
      <SheetImportDialog open={sheetImportOpen} onClose={() => setSheetImportOpen(false)} onImported={bump} />
      <AsanaDialog open={asanaOpen} onOpenChange={setAsanaOpen} status={asana} canEdit={canApprove} onChanged={setAsana} />
    </div>
  );
}
