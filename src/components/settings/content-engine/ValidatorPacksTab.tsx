"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DEFAULT_VALIDATORS, RISK_OPTIONS, STATUS_OPTIONS, VALIDATOR_OUTPUT_SCHEMA } from "./constants";
import { EmptyRow, ErrorBanner, ModeToggle, RawToFormNotice, RiskBadge, SectionCard, StatusBadge } from "./shared";
import type { CEMode, CEScope, PromptRow, ValidatorPackData } from "./types";
import { CE_TYPES, scopeProjectId, tryParse } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  canEdit: boolean;
}

interface Draft {
  name: string;
  description: string;
  mode: CEMode;
  data: ValidatorPackData;
  rawText: string;
}

function emptyValidatorPack(): ValidatorPackData {
  return { status: "Draft", industryScope: "All Industries", riskScope: "medium", validators: DEFAULT_VALIDATORS.map((v) => ({ ...v })) };
}

function parseItem(item: PromptRow): Draft {
  const parsed = tryParse<ValidatorPackData>(item.promptText);
  if (parsed) {
    // เติม validator ที่ขาดจาก default (เผื่อ pack เก่าไม่ครบ 11 ตัว)
    const byId = new Map(parsed.validators?.map((v) => [v.id, v]) ?? []);
    const validators = DEFAULT_VALIDATORS.map((d) => ({ ...d, ...(byId.get(d.id) ?? {}) }));
    return { name: item.name, description: item.description ?? "", mode: "form", data: { ...emptyValidatorPack(), ...parsed, validators }, rawText: item.promptText };
  }
  return { name: item.name, description: item.description ?? "", mode: "raw", data: emptyValidatorPack(), rawText: item.promptText };
}

function newDraft(): Draft {
  return { name: "Validator Pack ใหม่", description: "", mode: "form", data: emptyValidatorPack(), rawText: "" };
}

export function ValidatorPacksTab({ items, scope, canEdit }: Props) {
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
    const parsed = tryParse<ValidatorPackData>(draft.rawText);
    if (parsed) {
      const byId = new Map(parsed.validators?.map((v) => [v.id, v]) ?? []);
      const validators = DEFAULT_VALIDATORS.map((d) => ({ ...d, ...(byId.get(d.id) ?? {}) }));
      setDraft({ ...draft, mode: "form", data: { ...emptyValidatorPack(), ...parsed, validators } });
      setRawToFormNotice(false);
    } else {
      setRawToFormNotice(true);
    }
  }

  function startFreshForm() {
    setDraft({ ...draft, mode: "form", data: emptyValidatorPack() });
    setRawToFormNotice(false);
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
      setError("ต้องกรอกชื่อ Validator Pack");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      type: CE_TYPES.VALIDATOR_PACK,
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
        toast.success("บันทึก Validator Pack แล้ว");
        router.refresh();
      }
    } else {
      const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "save");
      if (created?.id) {
        setSelectedId(created.id);
        toast.success("สร้าง Validator Pack แล้ว");
        router.refresh();
      }
    }
  }

  async function cloneAsDraft() {
    if (!selected) return;
    const clonedData: ValidatorPackData = { ...draft.data, status: "Draft" };
    const payload = {
      name: `${draft.name} (v${selected.version + 1})`,
      description: draft.description.trim(),
      type: CE_TYPES.VALIDATOR_PACK,
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

  function updateValidator(id: string, patch: Partial<ValidatorPackData["validators"][number]>) {
    setDraft({
      ...draft,
      data: { ...draft.data, validators: draft.data.validators.map((v) => (v.id === id ? { ...v, ...patch } : v)) },
    });
  }

  const disabled = !canEdit || locked;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-2">
          {canEdit && (
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={startNew}>
              <Plus className="size-3.5" /> สร้าง Validator Pack ใหม่
            </Button>
          )}
          {items.length === 0 && <EmptyRow>ยังไม่มี Validator Pack</EmptyRow>}
          {items.map((item) => {
            const parsed = tryParse<ValidatorPackData>(item.promptText);
            const enabledCount = parsed?.validators?.filter((v) => v.enabled).length ?? 0;
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
                <p className="mt-0.5 truncate text-xs text-gray-400">{parsed ? `${enabledCount}/11 validators เปิดใช้งาน` : "—"}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {parsed && <StatusBadge status={parsed.status} />}
                  {parsed && <RiskBadge risk={parsed.riskScope} />}
                  <span className="text-[11px] text-gray-400">v{item.version}</span>
                </div>
              </button>
            );
          })}
        </aside>

        <section className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-brand-navy">{selectedId ? "แก้ไข Validator Pack" : "สร้าง Validator Pack ใหม่"}</h2>
                {locked && <p className="mt-0.5 text-xs text-amber-600">ชุดนี้กำลัง Active อยู่ — ห้ามแก้ทับ ต้อง Clone เป็น Draft ใหม่ก่อนแก้ไข</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeToggle mode={draft.mode} onChange={changeMode} disabled={disabled} />
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
                <Label className="text-xs text-gray-600">ชื่อ Pack</Label>
                <Input value={draft.name} disabled={disabled} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Industry Scope</Label>
                <Input
                  value={draft.data.industryScope}
                  disabled={disabled}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, industryScope: e.target.value } })}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Risk Scope</Label>
                <select
                  value={draft.data.riskScope}
                  disabled={disabled}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, riskScope: e.target.value as any } })}
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
                  disabled={disabled}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, status: e.target.value as any } })}
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm disabled:opacity-60"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                <Label className="text-xs text-gray-600">คำอธิบายสั้น</Label>
                <Input value={draft.description} disabled={disabled} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="h-9 text-sm" />
              </div>
            </div>
          </div>

          {draft.mode === "raw" ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              {rawToFormNotice && <RawToFormNotice onStartFresh={startFreshForm} />}
              <Textarea
                value={draft.rawText}
                disabled={disabled}
                onChange={(e) => setDraft({ ...draft, rawText: e.target.value })}
                className="min-h-[300px] font-mono text-xs"
              />
              <p className="mt-2 text-xs text-gray-400">
                วางเป็นข้อความ prompt ตรงๆ ได้เลย — ระบบใช้ข้อความนี้ตามลำดับ layer ตอน compile
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {draft.data.validators
                  .slice()
                  .sort((a, b) => a.executionOrder - b.executionOrder)
                  .map((v) => (
                    <SectionCard
                      key={v.id}
                      title={`${v.executionOrder}. ${v.name}`}
                      action={
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">เปิดใช้งาน</span>
                          <Switch checked={v.enabled} disabled={disabled} onCheckedChange={(checked) => updateValidator(v.id, { enabled: checked })} />
                        </div>
                      }
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2">
                          <span className="text-xs text-gray-600">Blocking{v.blockingLocked && " (locked)"}</span>
                          <Switch checked={v.blocking} disabled={disabled || v.blockingLocked} onCheckedChange={(checked) => updateValidator(v.id, { blocking: checked })} />
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2">
                          <span className="text-xs text-gray-600">Auto-fix{v.autoFixLocked && " (locked)"}</span>
                          <Switch
                            checked={v.autoFixAllowed}
                            disabled={disabled || v.autoFixLocked}
                            onCheckedChange={(checked) => updateValidator(v.id, { autoFixAllowed: checked })}
                          />
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2">
                          <span className="text-xs text-gray-600">Human Review</span>
                          <Switch
                            checked={v.humanReviewRequired}
                            disabled={disabled}
                            onCheckedChange={(checked) => updateValidator(v.id, { humanReviewRequired: checked })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-gray-600">Execution Order</Label>
                          <Input value={v.executionOrder} disabled className="h-9 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-gray-600">Pass Threshold</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={v.passThreshold}
                            disabled={disabled}
                            onChange={(e) => updateValidator(v.id, { passThreshold: Number(e.target.value) || 0 })}
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-gray-600">Warning Threshold</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={v.warningThreshold}
                            disabled={disabled}
                            onChange={(e) => updateValidator(v.id, { warningThreshold: Number(e.target.value) || 0 })}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                      <div className="mt-3 space-y-1">
                        <Label className="text-xs text-gray-600">Prompt</Label>
                        <Textarea
                          value={v.prompt}
                          disabled={disabled}
                          onChange={(e) => updateValidator(v.id, { prompt: e.target.value })}
                          className="min-h-[80px] text-xs"
                        />
                      </div>
                    </SectionCard>
                  ))}
              </div>

              <SectionCard title="Common Output Schema (read-only — ใช้ร่วมกันทุก Validator)">
                <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 text-xs text-gray-600">{VALIDATOR_OUTPUT_SCHEMA}</pre>
              </SectionCard>
            </>
          )}

          {!canEdit && <p className="text-xs text-gray-400">ดูได้อย่างเดียว — เฉพาะ Admin เท่านั้นที่แก้ไขได้</p>}
        </section>
      </div>
    </div>
  );
}
