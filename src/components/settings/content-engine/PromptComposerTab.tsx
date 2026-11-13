"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, Loader2, MinusCircle, Play, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CE_FILES_CHANGED_EVENT, commentsLayerStatus, restrictionsLayerStatus, type LayerStatusRow } from "@/lib/ce-layer-status";
import { CE_RESTRICTION_FILE } from "@/lib/ce-restrictions";
import type { DryRunLayer, DryRunWarning, WriterDryRun } from "@/lib/ce-writer-dry-run";
import { cn } from "@/lib/utils";
import { SectionCard } from "./shared";
import { FileFunnel, LayerBarChart, RunStepLine } from "./WriterRunFlow";
import { scopeProjectId, type CEScope, type PromptRow } from "./types";

interface Props {
  scope: CEScope;
  businessSkills: PromptRow[];
  masterPrompts: PromptRow[];
  briefTemplates: PromptRow[];
  restrictions: PromptRow[];
  clientComments: PromptRow[];
  validatorPacks: PromptRow[];
  imagePrompts?: PromptRow[];
}

interface PlanKeyword {
  id: string;
  keyword: string;
  title: string;
  note: string;
}

const STATE_LABEL: Record<DryRunLayer["state"], string> = {
  sent: "ส่งเข้า AI",
  missing: "ขาด",
  off: "ไม่ได้ใช้",
  later: "ใช้ขั้นอื่น",
};

const FILE_STATUS_LABEL = { whole: "ส่งครบ", partial: "ส่งบางส่วน", none: "ไม่ได้ส่ง" } as const;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function WarningRow({ warning }: { warning: DryRunWarning }) {
  const Icon = warning.level === "error" ? XCircle : warning.level === "warn" ? AlertTriangle : Info;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        warning.level === "error" && "text-red-700",
        warning.level === "warn" && "text-amber-700",
        warning.level === "info" && "text-gray-500"
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" /> <span>{warning.text}</span>
    </p>
  );
}

function LayerRow({ layer }: { layer: DryRunLayer }) {
  const Icon = layer.state === "sent" ? CheckCircle2 : layer.state === "missing" ? XCircle : MinusCircle;
  return (
    <details className="group rounded-2xl border border-white/80 bg-white/60">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            layer.state === "sent" && "text-green-600",
            layer.state === "missing" && "text-red-600",
            (layer.state === "off" || layer.state === "later") && "text-gray-400"
          )}
        />
        <span className="font-semibold text-gray-700">{layer.label}</span>
        {layer.source && <span className="min-w-0 break-words text-gray-500">{layer.source}</span>}
        <span className="ml-auto whitespace-nowrap text-gray-500">
          {STATE_LABEL[layer.state]}
          {layer.state === "sent" ? ` · ${fmt(layer.chars)} ตัวอักษร` : ""}
        </span>
      </summary>
      <div className="space-y-2 border-t border-gray-100 px-3 py-2">
        {layer.details.length > 0 && (
          <ul className="space-y-1 text-xs text-gray-600">
            {layer.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {layer.text ? (
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-brand-mist p-3 text-xs text-gray-700">{layer.text}</pre>
        ) : (
          layer.details.length === 0 && <p className="text-xs text-gray-400">ไม่มีข้อความส่งเข้า AI</p>
        )}
      </div>
    </details>
  );
}

export function PromptComposerTab({ scope, businessSkills, masterPrompts, briefTemplates, restrictions, clientComments, validatorPacks, imagePrompts = [] }: Props) {
  const [keywords, setKeywords] = useState<PlanKeyword[]>([]);
  const [keywordId, setKeywordId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WriterDryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<LayerStatusRow[]>([]);

  const scopeQuery = useMemo(() => {
    const id = scopeProjectId(scope);
    return id ? `projectId=${encodeURIComponent(id)}` : "scope=studio";
  }, [scope]);
  const url = `/api/prompts/writer-dry-run?${scopeQuery}`;

  // แถวข้อจำกัดไม่รวมไฟล์ — ไม่นับไฟล์จะแสดงว่าไม่ได้ใช้ ทั้งที่ไฟล์ถูกส่งอยู่
  useEffect(() => {
    let alive = true;
    fetch(`/api/prompts?${scopeQuery}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: LayerStatusRow[]) => {
        if (alive) setFileRows((Array.isArray(rows) ? rows : []).filter((r) => r.type === CE_RESTRICTION_FILE));
      })
      .catch(() => {
        if (alive) setFileRows([]);
      });
    const onFiles = (e: Event) => setFileRows((e as CustomEvent<LayerStatusRow[]>).detail ?? []);
    window.addEventListener(CE_FILES_CHANGED_EVENT, onFiles);
    return () => {
      alive = false;
      window.removeEventListener(CE_FILES_CHANGED_EVENT, onFiles);
    };
  }, [scopeQuery]);

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : { keywords: [] }))
      .then((d: { keywords?: PlanKeyword[] }) => {
        if (alive) setKeywords(Array.isArray(d.keywords) ? d.keywords : []);
      })
      .catch(() => {
        if (alive) setKeywords([]);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  // ใช้กติกาเดียวกับตัวโหลดตอนเขียนจริง — แถว Draft ไม่นับว่าใช้งาน
  const optional = useMemo(() => {
    const rows: LayerStatusRow[] = [...restrictions, ...clientComments, ...fileRows];
    return { restrictions: restrictionsLayerStatus(rows), comments: commentsLayerStatus(rows) };
  }, [restrictions, clientComments, fileRows]);

  const required = [
    { label: "Business Skill", row: businessSkills.find((i) => i.isActive) },
    { label: "Master Prompt", row: masterPrompts.find((i) => i.isActive) },
    { label: "Article Brief", row: briefTemplates.find((i) => i.isActive) },
    { label: "Validator Pack", row: validatorPacks.find((i) => i.isActive) },
    { label: "Image Prompt", row: imagePrompts.find((i) => i.isActive) },
  ];

  const canRun = Boolean(keywordId || keyword.trim());

  async function runTest() {
    if (!canRun) {
      toast.error("เลือกหรือใส่ keyword ก่อน");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keywordId ? { keywordId } : { keyword, title, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Run Test ไม่สำเร็จ (${res.status})`);
      setResult(data as WriterDryRun);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function exportDebug() {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ ...result, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `writer-run-test-${Date.now().toString(36)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  const alerts = result?.warnings.filter((w) => w.level !== "info") ?? [];
  const notes = result?.warnings.filter((w) => w.level === "info") ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <aside className="space-y-3">
        <SectionCard title="Layer ของสโคปนี้" description="สิ่งที่ตั้งค่าไว้ กด Run Test เพื่อดูว่าบทความแต่ละชิ้นได้อะไรจริง">
          <div className="space-y-2">
            {required.map((l) => (
              <div key={l.label} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-2xl border border-white/80 bg-white/60 px-3 py-2 text-xs">
                <span className="text-gray-600">{l.label}</span>
                {l.row ? (
                  <span className="inline-flex min-w-0 items-center gap-1 font-medium text-green-700">
                    <CheckCircle2 className="size-3.5 shrink-0" /> <span className="break-words">{l.row.name}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-red-600">
                    <XCircle className="size-3.5" /> ไม่มี Active
                  </span>
                )}
              </div>
            ))}
            {[optional.restrictions, optional.comments].map((s) => (
              <div key={s.label} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-2xl border border-white/80 bg-white/60 px-3 py-2 text-xs">
                <span className="text-gray-600">{s.label}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-medium",
                    s.state === "on" && "text-green-700",
                    s.state === "off" && "text-gray-500",
                    s.state === "blocked" && "text-amber-700"
                  )}
                >
                  {s.state === "on" ? <CheckCircle2 className="size-3.5" /> : s.state === "blocked" ? <AlertTriangle className="size-3.5" /> : <MinusCircle className="size-3.5" />}
                  {s.detail}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="บทความที่จะทดสอบ">
          <div className="space-y-2">
            {keywords.length > 0 && (
              <div>
                <Label className="text-xs" htmlFor="dry-run-keyword-plan">เลือกจากแผน keyword</Label>
                <select
                  id="dry-run-keyword-plan"
                  value={keywordId}
                  onChange={(e) => setKeywordId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-gray-200 bg-white px-2.5 text-sm"
                >
                  <option value="">พิมพ์เอง</option>
                  {keywords.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.title || k.keyword}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!keywordId && (
              <>
                <div>
                  <Label className="text-xs" htmlFor="dry-run-keyword">Keyword</Label>
                  <Input id="dry-run-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="dry-run-title">Title (ไม่บังคับ)</Label>
                  <Input id="dry-run-title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="dry-run-note">Note (ไม่บังคับ)</Label>
                  <Textarea id="dry-run-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 text-sm" />
                </div>
              </>
            )}
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button size="sm" className="gap-1.5" onClick={runTest} disabled={running || !canRun}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run Test
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportDebug} disabled={!result}>
            <Download className="size-3.5" /> Export Debug
          </Button>
        </div>
        <p className="text-[11px] text-gray-500">ไม่เรียก AI ไม่เสียเงิน ไม่สร้างบทความ ประกอบ prompt ด้วยฟังก์ชันเดียวกับตอนเขียนจริง</p>
      </aside>

      <section className="min-w-0 space-y-3">
        {error && <p className="rounded-2xl border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-700">{error}</p>}
        {!result && !error && (
          <SectionCard title="ผล Run Test">
            <p className="text-xs text-gray-500">เลือก keyword แล้วกด Run Test เพื่อดูว่าการเขียนใช้อะไรบ้าง มีขั้นตอนอะไร และ prompt ที่ส่งจริงคืออะไร</p>
          </SectionCard>
        )}

        {result && (
          <>
            <SectionCard
              title={result.canWrite ? "พร้อมเขียน" : "เขียนไม่ได้"}
              description={`${result.task.title} · keyword: ${result.task.keyword}${result.task.model ? ` · โมเดล: ${result.task.model}` : ""}`}
            >
              {alerts.length > 0 ? (
                <div className="space-y-1.5">
                  {alerts.map((w) => (
                    <WarningRow key={w.text} warning={w} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">ไม่พบปัญหาในการตั้งค่า</p>
              )}
            </SectionCard>

            <SectionCard title="การเขียนใช้อะไรบ้าง" description="เรียงตามลำดับใน prompt กดแต่ละแถวเพื่อดูข้อความจริง">
              <div className="space-y-1.5">
                {result.layers.map((l) => (
                  <LayerRow key={l.key} layer={l} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="ขนาดข้อมูลที่ส่งเข้า AI" description="คำนวณจาก prompt ที่ประกอบจริงรอบนี้ ตารางด้านบนคือข้อมูลชุดเดียวกัน">
              <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
                <LayerBarChart layers={result.layers} />
                <FileFunnel files={result.files} />
              </div>
            </SectionCard>

            {result.files.length > 0 && (
              <SectionCard title="ไฟล์ที่อัปโหลด" description="ไฟล์ใหญ่ไม่ถูกส่งทั้งไฟล์ ส่งตามหัวข้อของบทความนี้เท่านั้น">
                <div className="space-y-1.5">
                  {result.files.map((f) => (
                    <div key={`${f.layer}-${f.id}`} className="rounded-2xl border border-white/80 bg-white/60 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="min-w-0 break-words font-medium text-gray-700">{f.name}</span>
                        <span className="text-gray-400">{f.layer}</span>
                        <span
                          className={cn(
                            "ml-auto whitespace-nowrap font-medium",
                            f.status === "whole" && "text-green-700",
                            f.status === "partial" && "text-gray-600",
                            f.status === "none" && "text-amber-700"
                          )}
                        >
                          {FILE_STATUS_LABEL[f.status]} · {fmt(f.sentChars)}/{fmt(f.totalChars)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-gray-500">{f.reason}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            <SectionCard title="เส้นทางการเขียน" description="เส้นทึบ = Run Test ทำให้ดูจริง เส้นประ = เกิดตอนกดเขียนจริง">
              <RunStepLine steps={result.steps} />
              {notes.length > 0 && (
                <div className="mt-3 space-y-1">
                  {notes.map((w) => (
                    <WarningRow key={w.text} warning={w} />
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title={result.promptExact ? "Prompt ที่จะส่งจริง" : "โครง Prompt"}
              description={result.promptExact ? `system ${fmt(result.systemPrompt.length)} + user ${fmt(result.userPrompt.length)} ตัวอักษร` : "เรียงตามลำดับจริง ตัวจริงมีข้อมูลเว็บ CTA ตัวอย่างบทความ และผู้เขียนเพิ่ม"}
            >
              <div className="space-y-1.5">
                {[
                  { label: "System prompt", text: result.systemPrompt },
                  { label: "User prompt", text: result.userPrompt },
                ].map((p) => (
                  <details key={p.label} className="rounded-2xl border border-white/80 bg-white/60">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700">{p.label}</summary>
                    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words border-t border-gray-100 bg-brand-mist p-3 text-xs text-gray-700">{p.text}</pre>
                  </details>
                ))}
              </div>
            </SectionCard>
          </>
        )}
      </section>
    </div>
  );
}
