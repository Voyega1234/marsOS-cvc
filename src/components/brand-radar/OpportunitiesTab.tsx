"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Panel, Segmented } from "@/components/ds";
import {
  OPPORTUNITY_SCORING, OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABEL,
  type OpportunityDTO, type OpportunityListRes, type OpportunityStatus, type OpportunityType,
} from "@/lib/brand-radar/types";
import { replaceUrlParams } from "@/lib/url-state";
import { NA, api, fmtNum, postJson, type TabProps } from "./shared";
import { LoadState, Pager, useApiData } from "./PromptDialogs";

const PAGE_SIZE = 30;
const PRIORITY_TONE = { high: "bad", medium: "warn", low: "muted" } as const;
const CONF_TONE = { high: "ok", medium: "info", low: "muted" } as const;

function evidenceValue(v: string | number | null): string {
  if (v === null || v === undefined || v === "") return NA;
  return typeof v === "number" ? fmtNum(v) : v;
}

export default function OpportunitiesTab({ projectId, refreshKey, profile, onGoTab, onChanged }: TabProps) {
  const [type, setType] = useState<"" | OpportunityType>("");
  const [status, setStatus] = useState<OpportunityStatus>("OPEN");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { setPage(1); }, [type, status, projectId]);

  const p = new URLSearchParams({ projectId, status, page: String(page), pageSize: String(PAGE_SIZE) });
  if (type) p.set("type", type);
  const { data, loading, error, reload } = useApiData<OpportunityListRes>(profile ? `/api/brand-radar/opportunities?${p.toString()}` : "", refreshKey, true);

  if (!profile) {
    return (
      <Panel>
        <EmptyState title="ยังไม่ได้ตั้งค่า Brand Radar" description="ตั้งค่าแบรนด์ที่แท็บ Settings ก่อน"
          action={<Button size="sm" onClick={() => onGoTab("settings")}>ไปที่ Settings</Button>} />
      </Panel>
    );
  }

  async function setOppStatus(o: OpportunityDTO, next: OpportunityStatus) {
    setBusyId(o.id);
    const r = await api(`/api/brand-radar/opportunities/${o.id}`, postJson({ projectId, status: next }, "PATCH"));
    setBusyId("");
    if (!r.ok) { toast.error(r.data.error || "เปลี่ยนสถานะไม่สำเร็จ"); return; }
    reload();
    onChanged();
  }

  async function recompute() {
    setRefreshing(true);
    const r = await api<{ total: number }>("/api/brand-radar/opportunities/refresh", postJson({ projectId }));
    setRefreshing(false);
    if (!r.ok) { toast.error(r.data.error || "คำนวณไม่สำเร็จ"); return; }
    toast.success(`คำนวณใหม่แล้ว พบ ${fmtNum(r.data.total)} โอกาส`);
    reload();
    onChanged();
  }

  function openPrompt(id: string) {
    replaceUrlParams({ prompt: id });
    onGoTab("prompts");
  }

  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
        โอกาสเหล่านี้เป็นข้อเสนอแนะจากคำตอบ AI ที่เก็บได้ ไม่ใช่การรับประกันผลลัพธ์
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={type === ""} tone={type === "" ? "info" : "muted"} onClick={() => setType("")}>ทั้งหมด</Chip>
        {OPPORTUNITY_TYPES.map((t) => (
          <Chip key={t} active={type === t} tone={type === t ? "info" : "muted"} onClick={() => setType(t)}>
            {OPPORTUNITY_TYPE_LABEL[t]}{counts ? ` · ${counts[t]}` : ""}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<OpportunityStatus>
          size="sm"
          value={status}
          onChange={setStatus}
          options={[
            { value: "OPEN", label: "Open" },
            { value: "DONE", label: "Done" },
            { value: "DISMISSED", label: "Dismissed" },
          ]}
        />
        <Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => void recompute()} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          คำนวณใหม่
        </Button>
      </div>

      <details className="rounded-2xl border border-gray-100 bg-white/70 p-3 text-xs text-gray-600">
        <summary className="cursor-pointer font-medium text-brand-navy">วิธีคิดคะแนน</summary>
        <p className="mt-2">{OPPORTUNITY_SCORING}</p>
      </details>

      {loading || error || !data ? (
        <Panel><LoadState loading={loading} error={error} onRetry={reload} /></Panel>
      ) : data.rows.length === 0 ? (
        <Panel>
          <EmptyState title="ยังไม่มีโอกาสในมุมมองนี้" description="กด คำนวณใหม่ หลังสแกนเสร็จ หรือเปลี่ยนตัวกรอง" />
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.rows.map((o) => {
              const ev = Object.entries(o.evidence);
              return (
                <Panel key={o.id} className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone="info">{o.typeLabel || OPPORTUNITY_TYPE_LABEL[o.type]}</Chip>
                    <Chip tone={PRIORITY_TONE[o.priority]}>priority: {o.priority}</Chip>
                    <Chip tone={CONF_TONE[o.confidence]}>confidence: {o.confidence}</Chip>
                    <span className="ml-auto text-sm font-semibold tabular-nums text-brand-navy" title="คะแนน 0–100">{fmtNum(o.score)}<span className="text-xs font-normal text-gray-400">/100</span></span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-brand-navy">{o.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{o.detail}</p>
                  {ev.length > 0 ? (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-gray-50 p-2 text-xs">
                      {ev.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-gray-500">{k}</dt>
                          <dd className="break-all text-right tabular-nums">{evidenceValue(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {o.suggestedAction ? (
                    <p className="mt-2 text-sm"><span className="font-medium">สิ่งที่ควรทำ: </span>{o.suggestedAction}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
                    {o.promptId ? <Button size="sm" variant="outline" onClick={() => openPrompt(o.promptId as string)}>ดู Prompt</Button> : null}
                    <div className="ml-auto flex gap-2">
                      {o.status === "OPEN" ? (
                        <>
                          <Button size="sm" disabled={busyId === o.id} onClick={() => void setOppStatus(o, "DONE")}>Done</Button>
                          <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => void setOppStatus(o, "DISMISSED")}>Dismiss</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => void setOppStatus(o, "OPEN")}>Reopen</Button>
                      )}
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
