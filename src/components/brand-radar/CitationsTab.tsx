"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Panel, SearchPill, Segmented } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { METRIC_DEFINITIONS, type CitationOwner, type CitationsDTO, type CitationView, type CitedPageRow } from "@/lib/brand-radar/types";
import { NO_DATA_MESSAGE, api, fmtNum, radarQuery, type TabProps } from "./shared";
import { CitedDomainsTable, LoadState, Pager, exportCitedCsv, useApiData } from "./PromptDialogs";
import { ColumnHelp } from "./ColumnHelp";

const PAGE_SIZE = 50;
const GAP_DEF = METRIC_DEFINITIONS.find((m) => m.key === "citationGap");

type ListMode = "domain" | "page";

function ownerLabel(ownerType: CitationOwner, competitorName: string): string {
  if (ownerType === "own") return "Own";
  if (ownerType === "competitor") return `Competitor: ${competitorName || "-"}`;
  return "External";
}

function ownerTone(ownerType: CitationOwner): "ok" | "warn" | "muted" {
  return ownerType === "own" ? "ok" : ownerType === "competitor" ? "warn" : "muted";
}

/** Only http(s) links are clickable; anything else renders as plain text */
function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

function CitedPagesTable({ rows, showNew }: { rows: CitedPageRow[]; showNew: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"><ColumnHelp k="citedRowNo">#</ColumnHelp></TableHead>
            <TableHead className="min-w-[260px]"><ColumnHelp k="citedPageUrl">หน้าเว็บ (URL)</ColumnHelp></TableHead>
            <TableHead><ColumnHelp k="pageDomain">โดเมน</ColumnHelp></TableHead>
            <TableHead><ColumnHelp k="ownerType">Owner</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="citedPageAnswers" align="end">คำตอบที่อ้างอิง</ColumnHelp></TableHead>
            <TableHead className="text-right"><ColumnHelp k="citedPagePlatforms" align="end">AI platforms</ColumnHelp></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const href = safeUrl(r.url);
            return (
              <TableRow key={r.url}>
                <TableCell className="tabular-nums text-gray-500">{i + 1}</TableCell>
                <TableCell>
                  <div className="max-w-[420px] break-words text-xs">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer nofollow" title={r.url} className="text-brand-blue hover:underline">{r.title || r.url}</a>
                    ) : <span>{r.title || r.url}</span>}
                    {showNew && r.isNew ? <Chip tone="info" className="ml-1.5 align-middle">ใหม่</Chip> : null}
                    {r.title ? <p className="truncate text-gray-400">{r.url}</p> : null}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{r.domain}</TableCell>
                <TableCell><Chip tone={ownerTone(r.ownerType)}>{ownerLabel(r.ownerType, r.competitorName)}</Chip></TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(r.answers)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(r.platforms)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CitationsTab({ projectId, filters, refreshKey, profile, onGoTab, clientView }: TabProps) {
  const [view, setView] = useState<CitationView>("external");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [vendorOnly, setVendorOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [mode, setMode] = useState<ListMode>("domain");

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [view, qDebounced, vendorOnly, projectId, filters.from, filters.to, filters.country, filters.language, filters.provider]);

  const extra = { view, q: qDebounced, vendorOnly: vendorOnly && !clientView ? 1 : undefined };
  const url = `/api/brand-radar/citations?${radarQuery(projectId, filters, { ...extra, page, pageSize: PAGE_SIZE })}`;
  const { data, loading, error, reload } = useApiData<CitationsDTO>(profile ? url : "", refreshKey, true);

  if (!profile) {
    return (
      <Panel>
        <EmptyState title={clientView ? "ยังไม่มีข้อมูลรายงานสำหรับแบรนด์นี้" : "ยังไม่ได้ตั้งค่า Brand Radar"} description={clientView ? undefined : "ตั้งค่าแบรนด์ที่ปุ่ม Settings มุมขวาบน ก่อน"}
          action={clientView ? undefined : <Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }

  async function exportAll() {
    setExporting(true);
    const r = await api<CitationsDTO>(`/api/brand-radar/citations?${radarQuery(projectId, filters, { ...extra, page: 1, pageSize: 1000 })}`);
    setExporting(false);
    if (!r.ok) {
      if (clientView) console.error("brand-radar citations export:", r.data.error);
      toast.error(clientView ? "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" : r.data.error || "Export ไม่สำเร็จ");
      return;
    }
    exportCitedCsv(`brand-radar-citations-${view}.csv`, r.data.rows ?? [], clientView);
  }

  const t = data?.totals;
  const cmp = data?.comparison;
  const newDomains = new Set(cmp?.available ? cmp.newDomains : []);
  const newOnPage = data ? data.rows.filter((r) => newDomains.has(r.domain)) : [];

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Citation = AI ใส่ลิงก์ไปที่เว็บนั้นในคำตอบ การที่ AI พูดชื่อแบรนด์โดยไม่มีลิงก์ <b>ไม่นับ</b>เป็น citation
          {clientView ? null : " เว็บภายนอกที่ถูกอ้างอิงบ่อยและอยู่ในคลัง Backlink (หรือเป็น PBN ของเรา) คือเป้าหมายที่ซื้อ/วางลิงก์ได้"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto"><Segmented<CitationView>
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "own", label: "Own", count: t?.own },
            { value: "competitor", label: "Competitor", count: t?.competitor },
            { value: "external", label: "External", count: t?.external },
            { value: "gap", label: "Citation Gap", count: t?.gap },
          ]}
        /></div>
        <div className="max-w-full overflow-x-auto"><Segmented<ListMode>
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "domain", label: "โดเมน" },
            { value: "page", label: "หน้า" },
          ]}
        /></div>
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหาโดเมน" className="w-full sm:w-56" />
        {clientView ? null : (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={vendorOnly} onChange={(e) => setVendorOnly(e.target.checked)} />
            เฉพาะเว็บที่ซื้อ backlink ได้
          </label>
        )}
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
          <LoadState loading={loading} error={error} onRetry={reload} clientView={clientView} />
        ) : data.rows.length === 0 ? (
          <EmptyState
            title="ไม่พบเว็บในมุมมองนี้"
            description={t && t.responses === 0 ? (clientView ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : NO_DATA_MESSAGE) : vendorOnly || qDebounced ? "ลองล้างตัวกรอง" : "ยังไม่มี AI answer ที่ใส่ลิงก์ในมุมมองนี้"}
          />
        ) : (
          mode === "page" ? (
            (data.pages ?? []).length === 0 ? (
              <EmptyState title="ยังไม่มีหน้าเว็บที่ถูกอ้างอิง" description="ลองเปลี่ยนมุมมองหรือล้างตัวกรอง" />
            ) : (
              <CitedPagesTable rows={data.pages ?? []} showNew={!!cmp?.available} />
            )
          ) : (
            <>
              {newOnPage.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 px-3 py-2 text-xs">
                  <Chip tone="info">ใหม่</Chip>
                  <span className="text-gray-500">โดเมนที่ไม่เคยถูกอ้างอิงในช่วงก่อนหน้า:</span>
                  {newOnPage.slice(0, 20).map((r) => <span key={r.domain} className="max-w-full truncate rounded-full bg-sky-50 px-2 py-0.5 text-sky-800">{r.domain}</span>)}
                  {newOnPage.length > 20 ? <span className="text-gray-400">+{newOnPage.length - 20}</span> : null}
                </div>
              ) : null}
              <CitedDomainsTable rows={data.rows} clientView={clientView} />
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )
        )}
      </Panel>

      {cmp?.available ? (
        <Panel title="หายไปจากช่วงก่อนหน้า" subtitle={`โดเมนที่ถูกอ้างอิงช่วง ${cmp.previousFrom} ถึง ${cmp.previousTo} แต่ไม่ถูกอ้างอิงในช่วงนี้ (สูงสุด 20)${vendorOnly && !clientView ? " · ไม่รวมตัวกรองเว็บ vendor" : ""}${view === "gap" ? " · ไม่แยกตามมุมมอง Gap" : ""}`}>
          {cmp.lostDomains.length === 0 ? (
            <p className="py-2 text-sm text-gray-500">ไม่มีโดเมนที่หายไป</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2 xl:grid-cols-3">
              {cmp.lostDomains.map((d) => (
                <li key={d.domain} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white/70 px-2.5 py-1.5">
                  <span className="min-w-0 truncate">{d.domain}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Chip tone={ownerTone(d.ownerType)}>{ownerLabel(d.ownerType, d.competitorName)}</Chip>
                    <span className="tabular-nums text-gray-500">{fmtNum(d.answers)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
