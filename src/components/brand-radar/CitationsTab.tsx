"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, SearchPill, Segmented } from "@/components/ds";
import { METRIC_DEFINITIONS, type CitationsDTO, type CitationView } from "@/lib/brand-radar/types";
import { NO_DATA_MESSAGE, api, fmtNum, radarQuery, type TabProps } from "./shared";
import { CitedDomainsTable, LoadState, Pager, exportCitedCsv, useApiData } from "./PromptDialogs";

const PAGE_SIZE = 50;
const GAP_DEF = METRIC_DEFINITIONS.find((m) => m.key === "citationGap");

export default function CitationsTab({ projectId, filters, refreshKey, profile, onGoTab }: TabProps) {
  const [view, setView] = useState<CitationView>("external");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [vendorOnly, setVendorOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [view, qDebounced, vendorOnly, projectId]);

  const extra = { view, q: qDebounced, vendorOnly: vendorOnly ? 1 : undefined };
  const url = `/api/brand-radar/citations?${radarQuery(projectId, filters, { ...extra, page, pageSize: PAGE_SIZE })}`;
  const { data, loading, error, reload } = useApiData<CitationsDTO>(profile ? url : "", refreshKey);

  if (!profile) {
    return (
      <Panel>
        <EmptyState title="ยังไม่ได้ตั้งค่า Brand Radar" description="ตั้งค่าแบรนด์ที่แท็บ Settings ก่อน"
          action={<Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }

  async function exportAll() {
    setExporting(true);
    const r = await api<CitationsDTO>(`/api/brand-radar/citations?${radarQuery(projectId, filters, { ...extra, page: 1, pageSize: 1000 })}`);
    setExporting(false);
    if (!r.ok) { toast.error(r.data.error || "Export ไม่สำเร็จ"); return; }
    exportCitedCsv(`brand-radar-citations-${view}.csv`, r.data.rows ?? []);
  }

  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Citation = AI ใส่ลิงก์ไปที่เว็บนั้นในคำตอบ การที่ AI พูดชื่อแบรนด์โดยไม่มีลิงก์ <b>ไม่นับ</b>เป็น citation
          เว็บภายนอกที่ถูกอ้างอิงบ่อยและอยู่ในคลัง Backlink (หรือเป็น PBN ของเรา) คือเป้าหมายที่ซื้อ/วางลิงก์ได้
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<CitationView>
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "own", label: "Own", count: t?.own },
            { value: "competitor", label: "Competitor", count: t?.competitor },
            { value: "external", label: "External", count: t?.external },
            { value: "gap", label: "Citation Gap", count: t?.gap },
          ]}
        />
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหาโดเมน" className="w-full sm:w-56" />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={vendorOnly} onChange={(e) => setVendorOnly(e.target.checked)} />
          เฉพาะเว็บที่ซื้อ backlink ได้
        </label>
        <Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => void exportAll()} disabled={exporting || !data || data.total === 0}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> {exporting ? "กำลัง Export..." : "Export CSV"}
        </Button>
      </div>

      {view === "gap" && GAP_DEF ? (
        <p className="rounded-2xl border border-gray-100 bg-white/70 p-3 text-xs text-gray-600">
          <b>{GAP_DEF.name}</b>: {GAP_DEF.formula}. {GAP_DEF.note}
        </p>
      ) : null}

      {t ? (
        <p className="text-xs text-gray-600">
          Citations {fmtNum(t.citations)} รายการ · คำตอบที่มีลิงก์อ้างอิง {fmtNum(t.responsesWithCitations)} / {fmtNum(t.responses)} คำตอบ
        </p>
      ) : null}

      <Panel padded={false}>
        {loading || error || !data ? (
          <LoadState loading={loading} error={error} onRetry={reload} />
        ) : data.rows.length === 0 ? (
          <EmptyState
            title="ไม่พบเว็บในมุมมองนี้"
            description={t && t.responses === 0 ? NO_DATA_MESSAGE : vendorOnly || qDebounced ? "ลองล้างตัวกรอง" : "ยังไม่มี AI answer ที่ใส่ลิงก์ในมุมมองนี้"}
          />
        ) : (
          <>
            <CitedDomainsTable rows={data.rows} />
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
