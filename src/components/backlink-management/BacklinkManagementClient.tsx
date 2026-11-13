"use client";

import { useCallback, useEffect, useState } from "react";
import { Chip, PageHeader, UnderlineTabs } from "@/components/ds";
import AsanaDialog, { type AsanaStatus } from "./AsanaDialog";
import BudgetTab from "./BudgetTab";
import ReportTab from "./ReportTab";
import RequestDialog from "./RequestDialog";
import RequestDrawer from "./RequestDrawer";
import RequestsTab from "./RequestsTab";
import TrackingTab from "./TrackingTab";
import VendorsTab from "./VendorsTab";
import { api, selectCls, type BlmRow, type Meta } from "./shared";

type TabId = "requests" | "vendors" | "budget" | "tracking" | "report";
const TABS: { id: TabId; label: string }[] = [
  { id: "requests", label: "คำขอ" },
  { id: "vendors", label: "คลังเว็บ" },
  { id: "budget", label: "งบประมาณ" },
  { id: "tracking", label: "ติดตามลิงก์" },
  { id: "report", label: "รายงาน" },
];

export default function BacklinkManagementClient({ userRole }: { userRole: string }) {
  const [tab, setTab] = useState<TabId>("requests");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [projectId, setProjectId] = useState("");
  const [period, setPeriod] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; edit: BlmRow | null }>({ open: false, edit: null });
  const [asana, setAsana] = useState<AsanaStatus | null>(null);
  const [asanaOpen, setAsanaOpen] = useState(false);

  useEffect(() => {
    api<Meta>("/api/backlink-management/meta").then((m) => { setMeta(m); setPeriod((p) => p || m.period); }).catch(() => {});
    api<AsanaStatus>("/api/backlink-management/asana").then(setAsana).catch(() => {});
  }, []);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const canApprove = meta?.me.canApprove ?? ["ADMIN", "SEO_MANAGER"].includes(userRole);
  const connected = !!asana && asana.tokenSource !== "none" && !!asana.projectGid;

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader
        title="Backlink Management"
        subtitle="คำขอ backlink งบประมาณ และการติดตามลิงก์"
        actions={
          <button type="button" onClick={() => setAsanaOpen(true)} aria-label="ตั้งค่า Asana">
            <Chip tone={connected ? "ok" : "warn"} dot>
              {connected ? `Asana: เชื่อมแล้ว · ${asana?.projectName}` : "Asana: ยังไม่ได้เชื่อม"}
            </Chip>
          </button>
        }
      />

      <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />

      {tab !== "vendors" ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select className={`${selectCls} !w-auto min-w-[180px]`} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="โปรเจกต์">
            <option value="">ทุกโปรเจกต์</option>
            {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {tab !== "report" ? (
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="เดือน"
              className="h-10 rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          ) : null}
          {tab !== "report" && period ? <button type="button" className="text-xs text-gray-500 underline" onClick={() => setPeriod("")}>ทุกเดือน</button> : null}
        </div>
      ) : null}

      {tab === "requests" ? (
        <RequestsTab projectId={projectId} period={period} refreshKey={refreshKey} onOpen={setOpenId} onCreate={() => setDialog({ open: true, edit: null })} />
      ) : null}
      {tab === "vendors" ? <VendorsTab /> : null}
      {tab === "budget" ? <BudgetTab period={period || meta?.period || ""} projectId={projectId} meta={meta} refreshKey={refreshKey} /> : null}
      {tab === "tracking" ? <TrackingTab projectId={projectId} period={period} refreshKey={refreshKey} onOpen={setOpenId} onChanged={bump} /> : null}
      {tab === "report" ? <ReportTab period={meta?.period ?? ""} /> : null}

      <RequestDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        role={userRole}
        userId={meta?.me.id ?? ""}
        onChanged={bump}
        onEdit={(row) => setDialog({ open: true, edit: row })}
      />
      <RequestDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        meta={meta}
        edit={dialog.edit}
        defaultProjectId={projectId}
        defaultPeriod={period || meta?.period || ""}
        onSaved={bump}
      />
      <AsanaDialog open={asanaOpen} onOpenChange={setAsanaOpen} status={asana} canEdit={canApprove} onChanged={setAsana} />
    </div>
  );
}
