"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Eye, FileUp, Info, Plus, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Chip, EmptyState, Panel, SearchPill, Segmented } from "@/components/ds";
import {
  PRIORITIES, PROMPT_INTENTS, PROMPT_INTENT_LABEL, PROMPT_SOURCES, PROMPT_SOURCE_LABEL,
  type Priority, type PromptBulkAction, type PromptListDTO, type PromptRowDTO, type PromptStatus,
} from "@/lib/brand-radar/types";
import { useUrlState } from "@/hooks/use-url-state";
import { api, fmtDateTime, fmtNum, fmtPct, isSmallSample, postJson, radarQuery, providerLabelFor, type TabProps } from "./shared";
import PromptDetail from "./PromptDetail";
import ResponseViewer, { type ViewerTarget } from "./ResponseViewer";
import {
  GeneratePromptsDialog, ImportPromptsDialog, LoadState, Pager, PromptFormDialog, SELECT_CLS, useApiData,
} from "./PromptDialogs";

type StatusFilter = "" | PromptStatus;
const PAGE_SIZE = 50;

const STATUS_LABEL: Record<PromptStatus, string> = {
  ACTIVE: "Monitoring", CANDIDATE: "Candidate", INACTIVE: "Inactive", REJECTED: "Rejected",
};
const STATUS_TONE: Record<PromptStatus, "ok" | "info" | "muted" | "bad"> = {
  ACTIVE: "ok", CANDIDATE: "info", INACTIVE: "muted", REJECTED: "bad",
};
const SORTS = [
  { value: "recent", label: "ล่าสุด" },
  { value: "mention_rate_asc", label: "Mention rate ต่ำ → สูง" },
  { value: "mention_rate_desc", label: "Mention rate สูง → ต่ำ" },
  { value: "volume_desc", label: "Search volume" },
  { value: "priority", label: "Priority" },
];

export default function PromptsTab(props: TabProps) {
  const [prompt, setPrompt] = useUrlState<string>("prompt", "");
  if (prompt) {
    return (
      <PromptDetail
        projectId={props.projectId}
        filters={props.filters}
        promptId={prompt}
        refreshKey={props.refreshKey}
        onBack={() => setPrompt("")}
      />
    );
  }
  return <PromptList {...props} onOpen={setPrompt} />;
}

function changeProviders(r: PromptRowDTO, kind: "gained" | "lost", clientView?: boolean): string {
  const list = r.runChangeProviders?.[kind] ?? [];
  return list.length > 0 ? ` (${list.map((p) => providerLabelFor(p, clientView)).join(", ")})` : "";
}

function PromptList({ projectId, filters, refreshKey, profile, onGoTab, onChanged, onOpen, clientView }: TabProps & { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<StatusFilter>("");
  const [source, setSource] = useState("");
  const [intent, setIntent] = useState("");
  const [topic, setTopic] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"" | "add" | "generate" | "import">("");
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);
  const [editing, setEditing] = useState<PromptRowDTO | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPriority, setBulkPriority] = useState<Priority>("high");

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const url = `/api/brand-radar/prompts?${radarQuery(projectId, filters, { status, source, intent, topic, q: qDebounced, sort, page, pageSize: PAGE_SIZE })}`;
  const { data, loading, error, reload } = useApiData<PromptListDTO>(profile ? url : "", refreshKey, true);

  // Reset the selection only when the request changes (filters / page); background refreshes keep it.
  useEffect(() => { setSelected(new Set()); }, [url]);
  // Drop selected ids that are no longer on the current page (derived, not wiped).
  const visibleIds = new Set((data?.rows ?? []).map((r) => r.id));
  const selectedIds = Array.from(selected).filter((id) => visibleIds.has(id));
  useEffect(() => { setPage(1); }, [status, source, intent, topic, qDebounced, sort, projectId]);

  if (!profile) {
    return (
      <Panel>
        <EmptyState
          title="ยังไม่ได้ตั้งค่า Brand Radar"
          description="ตั้งค่าแบรนด์ คู่แข่ง และ AI platform ที่แท็บ Settings ก่อน จึงจะเพิ่ม Prompt ได้"
          action={<Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>}
        />
      </Panel>
    );
  }

  const rows = data?.rows ?? [];
  const counts = data?.counts;
  const total = counts ? counts.ACTIVE + counts.CANDIDATE + counts.INACTIVE + counts.REJECTED : undefined;
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function bulk(action: PromptBulkAction, priority?: Priority) {
    const ids = selectedIds;
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`ลบ ${ids.length} Prompt? ข้อมูลคำตอบของ Prompt เหล่านี้จะหายด้วย`)) return;
    setBulkBusy(true);
    const r = await api<{ affected: number }>("/api/brand-radar/prompts/bulk", postJson({ projectId, ids, action, priority }));
    setBulkBusy(false);
    if (!r.ok) { toast.error(r.data.error || "ทำรายการไม่สำเร็จ"); return; }
    toast.success(`อัปเดตแล้ว ${r.data.affected} รายการ`);
    setSelected(new Set());
    reload();
    onChanged();
  }

  function saved() {
    reload();
    onChanged();
  }

  const exportHref = `/api/brand-radar/prompts/export?${radarQuery(projectId, filters, { status })}`;

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Prompt ที่ AI สร้างไม่ใช่คำถามจริงของผู้ใช้ — ใช้ติดตามว่า AI ตอบถึงแบรนด์เราบ่อยแค่ไหนเท่านั้น Prompt ที่ติดตาม (Monitoring) เท่านั้นที่ถูกส่งไปถาม AI ตอนสแกน</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<StatusFilter>
          size="sm"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "All", count: total },
            { value: "ACTIVE", label: "Monitoring", count: counts?.ACTIVE },
            { value: "CANDIDATE", label: "Candidates", count: counts?.CANDIDATE },
            { value: "INACTIVE", label: "Inactive", count: counts?.INACTIVE },
            { value: "REJECTED", label: "Rejected", count: counts?.REJECTED },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button size="sm" variant="outline" onClick={() => setDialog("generate")}><SearchIcon className="mr-1.5 h-3.5 w-3.5" /> หา Prompt</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("import")}><FileUp className="mr-1.5 h-3.5 w-3.5" /> นำเข้า CSV</Button>
          <a href={exportHref} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>
          <Button size="sm" onClick={() => setDialog("add")}><Plus className="mr-1.5 h-3.5 w-3.5" /> เพิ่ม Prompt</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหา Prompt" className="w-full sm:w-64" />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className={SELECT_CLS}>
          <option value="">ทุก Source</option>
          {PROMPT_SOURCES.map((s) => <option key={s} value={s}>{PROMPT_SOURCE_LABEL[s]}</option>)}
        </select>
        <select value={intent} onChange={(e) => setIntent(e.target.value)} aria-label="Intent" className={SELECT_CLS}>
          <option value="">ทุก Intent</option>
          {PROMPT_INTENTS.map((i) => <option key={i} value={i}>{PROMPT_INTENT_LABEL[i]}</option>)}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" className={SELECT_CLS}>
          <option value="">ทุก Topic</option>
          {(data?.topics ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className={SELECT_CLS}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-blue/30 bg-brand-mist/60 px-3 py-2 text-sm">
          <span className="font-medium">เลือก {selectedIds.length} รายการ</span>
          <Button size="sm" disabled={bulkBusy} onClick={() => void bulk("activate")}>Monitor (เริ่มติดตาม)</Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void bulk("deactivate")}>หยุดติดตาม</Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void bulk("reject")}>Reject</Button>
          <span className="inline-flex items-center gap-1">
            <select value={bulkPriority} onChange={(e) => setBulkPriority(e.target.value as Priority)} aria-label="Priority" className={SELECT_CLS}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void bulk("set_priority", bulkPriority)}>Set priority</Button>
          </span>
          <Button size="sm" variant="outline" disabled={bulkBusy} className="text-red-600" onClick={() => void bulk("delete")}>Delete</Button>
        </div>
      ) : null}

      <Panel padded={false}>
        {loading || error ? (
          <LoadState loading={loading} error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="ไม่พบ Prompt"
            description={status || source || intent || topic || qDebounced ? "ลองล้างตัวกรอง" : "เพิ่ม Prompt เอง นำเข้า CSV หรือกด หา Prompt เพื่อเริ่มต้น"}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><input type="checkbox" aria-label="เลือกทั้งหมด" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></TableHead>
                    <TableHead className="min-w-[260px]">Prompt</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Responses</TableHead>
                    <TableHead className="text-right">Our mention rate</TableHead>
                    <TableHead>Top competitor</TableHead>
                    <TableHead>Last scan</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><input type="checkbox" aria-label="เลือกแถว" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></TableCell>
                      <TableCell>
                        <button type="button" onClick={() => onOpen(r.id)} className="text-left font-medium text-brand-blue hover:underline">{r.text}</button>
                        {r.runChange === "gained" ? <Chip tone="ok" className="ml-1.5 align-middle" title={`รอบก่อนหน้าไม่ถูกพูดถึง รอบล่าสุดถูกพูดถึง${changeProviders(r, "gained", clientView)}`}>ได้ใหม่</Chip> : null}
                        {r.runChange === "lost" ? <Chip tone="warn" className="ml-1.5 align-middle" title={`รอบก่อนหน้าถูกพูดถึง รอบล่าสุดไม่ถูกพูดถึง${changeProviders(r, "lost", clientView)}`}>หลุด</Chip> : null}
                      </TableCell>
                      <TableCell className="text-xs">{r.topic || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{PROMPT_INTENT_LABEL[r.intent]}</TableCell>
                      <TableCell>
                        <Chip tone={r.source === "ai_generated" ? "warn" : "muted"} title={PROMPT_SOURCE_LABEL[r.source]}>
                          {r.source === "ai_generated" ? "AI generated" : PROMPT_SOURCE_LABEL[r.source]}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.searchVolume)}</TableCell>
                      <TableCell className="text-xs">{r.priority}</TableCell>
                      <TableCell><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip></TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.stats.responses)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPct(r.stats.mentionRate)}
                        {r.stats.mentionRate !== null && r.stats.responses > 0 ? (
                          <div className="text-[11px] text-gray-500">
                            n={r.stats.responses}
                            {isSmallSample(r.stats.responses) ? (
                              <span title="ถามน้อยกว่า 10 รอบ ตัวเลขยังแกว่งมาก" className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">ตัวอย่างน้อย</span>
                            ) : null}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.stats.topCompetitor ? `${r.stats.topCompetitor.name} · ${fmtPct(r.stats.topCompetitor.mentionRate)}` : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.stats.lastCollectedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Button size="sm" variant="ghost" disabled={r.stats.responses === 0} title="ดูคำตอบเต็มของ AI"
                          onClick={() => setViewing({ promptId: r.id })}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> ดูคำตอบ
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>แก้ไข</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pager page={data?.page ?? page} pageSize={data?.pageSize ?? PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Panel>

      {dialog === "add" ? (
        <PromptFormDialog projectId={projectId} prompt={null} topics={data?.topics ?? []} onClose={() => setDialog("")} onSaved={saved} />
      ) : null}
      {editing ? (
        <PromptFormDialog projectId={projectId} prompt={editing} topics={data?.topics ?? []} onClose={() => setEditing(null)} onSaved={saved} />
      ) : null}
      {dialog === "generate" ? <GeneratePromptsDialog projectId={projectId} onClose={() => setDialog("")} onSaved={saved} /> : null}
      {dialog === "import" ? <ImportPromptsDialog projectId={projectId} onClose={() => setDialog("")} onSaved={saved} /> : null}
      <ResponseViewer projectId={projectId} filters={filters} target={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
