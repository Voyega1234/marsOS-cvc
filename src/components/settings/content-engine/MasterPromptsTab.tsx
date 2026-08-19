"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CONTENT_TYPES,
  DEFAULT_MASTER_PROMPT,
  DEFAULT_MASTER_PROMPT_NAME,
  MASTER_PROMPT_VARIABLES,
  RISK_OPTIONS,
  STATUS_OPTIONS,
} from "./constants";
import { EmptyRow, ErrorBanner, ModeToggle, RawToFormNotice, RiskBadge, SectionCard, StatusBadge } from "./shared";
import type { CEMode, CEScope, MasterPromptData, PromptRow } from "./types";
import { CE_TYPES, emptyMasterPrompt, scopeProjectId, tryParse } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  canEdit: boolean;
}

interface Draft {
  name: string;
  description: string;
  mode: CEMode;
  data: MasterPromptData;
  rawText: string;
}

function parseItem(item: PromptRow): Draft {
  const parsed = tryParse<MasterPromptData>(item.promptText);
  if (parsed) return { name: item.name, description: item.description ?? "", mode: "form", data: { ...emptyMasterPrompt(), ...parsed }, rawText: item.promptText };
  return { name: item.name, description: item.description ?? "", mode: "raw", data: emptyMasterPrompt(), rawText: item.promptText };
}

function newDraft(): Draft {
  return { name: "Master Prompt ใหม่", description: "", mode: "form", data: emptyMasterPrompt(), rawText: "" };
}

function VariableChips({
  label,
  selected,
  other,
  disabled,
  onToggle,
}: {
  label: string;
  selected: string[];
  other: string[];
  disabled?: boolean;
  onToggle: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-gray-600">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {MASTER_PROMPT_VARIABLES.map((v) => {
          const active = selected.includes(v);
          const disabledChip = disabled || (other.includes(v) && !active);
          return (
            <button
              key={v}
              type="button"
              disabled={disabledChip}
              onClick={() => onToggle(v)}
              className={cn(
                "rounded-full border px-2 py-1 font-mono text-[11px] transition-colors",
                active
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
                disabledChip && "cursor-not-allowed opacity-40"
              )}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MasterPromptsTab({ items, scope, canEdit }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(items[0] ? parseItem(items[0]) : newDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawToFormNotice, setRawToFormNotice] = useState(false);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const locked = !!selected?.isActive;

  useEffect(() => {
    if (!selectedId) return;
    const found = items.find((i) => i.id === selectedId);
    if (found) setDraft(parseItem(found));
    else {
      setSelectedId(items[0]?.id ?? null);
      setDraft(items[0] ? parseItem(items[0]) : newDraft());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function selectItem(item: PromptRow) {
    setError(null);
    setRawToFormNotice(false);
    setSelectedId(item.id);
    setDraft(parseItem(item));
  }

  function startNew() {
    setError(null);
    setRawToFormNotice(false);
    setSelectedId(null);
    setDraft(newDraft());
  }

  function changeMode(next: CEMode) {
    if (next === draft.mode) return;
    if (next === "raw") {
      setDraft({ ...draft, mode: "raw", rawText: JSON.stringify(draft.data, null, 2) });
      setRawToFormNotice(false);
      return;
    }
    const parsed = tryParse<MasterPromptData>(draft.rawText);
    if (parsed) {
      setDraft({ ...draft, mode: "form", data: { ...emptyMasterPrompt(), ...parsed } });
      setRawToFormNotice(false);
    } else {
      setRawToFormNotice(true);
    }
  }

  function startFreshForm() {
    setDraft({ ...draft, mode: "form", data: emptyMasterPrompt() });
    setRawToFormNotice(false);
  }

  function useDefault() {
    setDraft({ ...draft, name: DEFAULT_MASTER_PROMPT_NAME, data: { ...DEFAULT_MASTER_PROMPT } });
    toast.success("เติมค่า Default Master Prompt แล้ว");
  }

  async function call(url: string, init: RequestInit, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      return await res.json().catch(() => ({}));
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  function buildPromptText() {
    return draft.mode === "raw" ? draft.rawText : JSON.stringify(draft.data);
  }

  async function save() {
    if (!draft.name.trim()) {
      setError("ต้องกรอกชื่อ Master Prompt");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      type: CE_TYPES.MASTER_PROMPT,
      promptText: buildPromptText(),
      projectId: scopeProjectId(scope),
    };
    if (selectedId) {
      const updated = await call(`/api/prompts/${selectedId}`, { method: "PUT", body: JSON.stringify(payload) }, "save");
      if (updated) {
        if (draft.mode === "form" && draft.data.status === "Active" && !selected?.isActive) {
          await call(`/api/prompts/${selectedId}/activate`, { method: "POST", body: JSON.stringify({ action: "activate" }) }, "save");
        } else if (draft.mode === "form" && draft.data.status !== "Active" && selected?.isActive) {
          await call(`/api/prompts/${selectedId}/activate`, { method: "POST", body: JSON.stringify({ action: "deactivate" }) }, "save");
        }
        toast.success("บันทึก Master Prompt แล้ว");
        router.refresh();
      }
    } else {
      const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "save");
      if (created?.id) {
        setSelectedId(created.id);
        toast.success("สร้าง Master Prompt แล้ว");
        router.refresh();
      }
    }
  }

  async function cloneAsDraft() {
    if (!selected) return;
    const clonedData: MasterPromptData = { ...draft.data, status: "Draft" };
    const payload = {
      name: `${draft.name} (v${selected.version + 1})`,
      description: draft.description.trim(),
      type: CE_TYPES.MASTER_PROMPT,
      promptText: draft.mode === "raw" ? draft.rawText : JSON.stringify(clonedData),
      projectId: scopeProjectId(scope),
    };
    const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "clone");
    if (created?.id) {
      setSelectedId(created.id);
      toast.success("Clone เป็น Draft ใหม่แล้ว");
      router.refresh();
    }
  }

  async function toggleActive(item: PromptRow) {
    const done = await call(
      `/api/prompts/${item.id}/activate`,
      { method: "POST", body: JSON.stringify({ action: item.isActive ? "deactivate" : "activate" }) },
      `activate-${item.id}`
    );
    if (done) {
      toast.success(item.isActive ? "ปิดใช้งานแล้ว" : "ใช้งานชุดนี้แล้ว");
      router.refresh();
    }
  }

  function toggleVariable(list: "requiredVariables" | "optionalVariables", v: string) {
    const cur = draft.data[list];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    setDraft({ ...draft, data: { ...draft.data, [list]: next } });
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-2">
          {canEdit && (
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={startNew}>
              <Plus className="size-3.5" /> สร้าง Master Prompt ใหม่
            </Button>
          )}
          {items.length === 0 && <EmptyRow>ยังไม่มี Master Prompt</EmptyRow>}
          {items.map((item) => {
            const parsed = tryParse<MasterPromptData>(item.promptText);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectItem(item)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selectedId === item.id ? "border-indigo-300 bg-indigo-50/60" : "border-gray-200 bg-white hover:bg-gray-50"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-brand-navy">{item.name}</span>
                  {item.isActive && (
                    <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">ACTIVE</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-400">
                  {parsed?.contentType || "—"} · {parsed?.industryScope || "All Industries"}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {parsed && <StatusBadge status={parsed.status} />}
                  {parsed && <RiskBadge risk={parsed.riskLevel} />}
                  <span className="text-[11px] text-gray-400">v{item.version}</span>
                </div>
                <p className="mt-1 text-[11px] text-gray-400">Clients assigned: — · Test: Not run</p>
              </button>
            );
          })}
        </aside>

        <section className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-brand-navy">{selectedId ? "แก้ไข Master Prompt" : "สร้าง Master Prompt ใหม่"}</h2>
                {locked && <p className="mt-0.5 text-xs text-amber-600">ชุดนี้กำลัง Active อยู่ — ห้ามแก้ทับ ต้อง Clone เป็น Draft ใหม่ก่อนแก้ไข</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeToggle mode={draft.mode} onChange={changeMode} disabled={!canEdit || locked} />
                {canEdit && !locked && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={useDefault}>
                    <Sparkles className="size-3.5" /> ใช้ Default Master Prompt
                  </Button>
                )}
                {selected && canEdit && (
                  <Button
                    variant={selected.isActive ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    disabled={busy !== null}
                    onClick={() => toggleActive(selected)}
                  >
                    {busy === `activate-${selected.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    {selected.isActive ? "ปิดใช้งาน" : "ใช้ชุดนี้"}
                  </Button>
                )}
                {canEdit && locked && (
                  <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={cloneAsDraft}>
                    {busy === "clone" ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                    Clone เป็น Draft ใหม่
                  </Button>
                )}
                {canEdit && !locked && (
                  <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={save}>
                    {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    บันทึก
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-xs text-gray-600">Prompt Name</Label>
                <Input value={draft.name} disabled={!canEdit || locked} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Content Type</Label>
                <select
                  value={draft.data.contentType}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, contentType: e.target.value } })}
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm disabled:opacity-60"
                >
                  {CONTENT_TYPES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Industry Scope</Label>
                <Input
                  value={draft.data.industryScope}
                  disabled={!canEdit || locked}
                  placeholder="All Industries"
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, industryScope: e.target.value } })}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Risk Level</Label>
                <select
                  value={draft.data.riskLevel}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, riskLevel: e.target.value as any } })}
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm disabled:opacity-60"
                >
                  {RISK_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Status</Label>
                <select
                  value={draft.data.status}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, status: e.target.value as any } })}
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm disabled:opacity-60"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                <Label className="text-xs text-gray-600">Description</Label>
                <Input value={draft.description} disabled={!canEdit || locked} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="h-9 text-sm" />
              </div>
            </div>
          </div>

          {draft.mode === "raw" ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              {rawToFormNotice && <RawToFormNotice onStartFresh={startFreshForm} />}
              <Textarea
                value={draft.rawText}
                disabled={!canEdit || locked}
                onChange={(e) => setDraft({ ...draft, rawText: e.target.value })}
                className="min-h-[300px] font-mono text-xs"
              />
              <p className="mt-2 text-xs text-gray-400">
                วางเป็นข้อความ prompt ตรงๆ ได้เลย — ระบบใช้ข้อความนี้ตามลำดับ layer ตอน compile
              </p>
            </div>
          ) : (
            <>
              <SectionCard title="Variables">
                <div className="space-y-3">
                  <VariableChips
                    label="Required Variables"
                    selected={draft.data.requiredVariables}
                    other={draft.data.optionalVariables}
                    disabled={!canEdit || locked}
                    onToggle={(v) => toggleVariable("requiredVariables", v)}
                  />
                  <VariableChips
                    label="Optional Variables"
                    selected={draft.data.optionalVariables}
                    other={draft.data.requiredVariables}
                    disabled={!canEdit || locked}
                    onToggle={(v) => toggleVariable("optionalVariables", v)}
                  />
                </div>
              </SectionCard>

              <SectionCard title="System Instruction">
                <Textarea
                  value={draft.data.systemInstruction}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, systemInstruction: e.target.value } })}
                  className="min-h-[160px] font-mono text-xs"
                />
              </SectionCard>

              <SectionCard title="Writing Instruction">
                <Textarea
                  value={draft.data.writingInstruction}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, writingInstruction: e.target.value } })}
                  className="min-h-[260px] font-mono text-xs"
                />
              </SectionCard>

              <div className="grid gap-3 lg:grid-cols-2">
                <SectionCard title="Output Format">
                  <Textarea
                    value={draft.data.outputFormat}
                    disabled={!canEdit || locked}
                    onChange={(e) => setDraft({ ...draft, data: { ...draft.data, outputFormat: e.target.value } })}
                    className="min-h-[100px] font-mono text-xs"
                  />
                </SectionCard>
                <SectionCard title="Prohibited Behavior">
                  <Textarea
                    value={draft.data.prohibitedBehavior}
                    disabled={!canEdit || locked}
                    onChange={(e) => setDraft({ ...draft, data: { ...draft.data, prohibitedBehavior: e.target.value } })}
                    className="min-h-[100px] font-mono text-xs"
                  />
                </SectionCard>
                <SectionCard title="Fallback Behavior">
                  <Textarea
                    value={draft.data.fallbackBehavior}
                    disabled={!canEdit || locked}
                    onChange={(e) => setDraft({ ...draft, data: { ...draft.data, fallbackBehavior: e.target.value } })}
                    className="min-h-[80px] text-xs"
                  />
                </SectionCard>
                <SectionCard title="Test Cases">
                  <Textarea
                    value={draft.data.testCases}
                    disabled={!canEdit || locked}
                    onChange={(e) => setDraft({ ...draft, data: { ...draft.data, testCases: e.target.value } })}
                    className="min-h-[80px] text-xs"
                  />
                </SectionCard>
              </div>

              <SectionCard title="Version Note">
                <Input
                  value={draft.data.versionNote}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, versionNote: e.target.value } })}
                  className="h-9 text-sm"
                />
              </SectionCard>
            </>
          )}

          {!canEdit && <p className="text-xs text-gray-400">ดูได้อย่างเดียว — เฉพาะ Admin เท่านั้นที่แก้ไขได้</p>}
        </section>
      </div>
    </div>
  );
}
