"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Plus, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DEFAULT_VALIDATORS, RISK_OPTIONS, STATUS_OPTIONS, VALIDATOR_OUTPUT_SCHEMA } from "./constants";
import {
  BRIEF_JUDGE_INPUTS,
  BRIEF_JUDGE_SYSTEM_PROMPT,
  BRIEF_MATCH_DEFAULT_PROMPT,
  BRIEF_MATCH_ID,
  BRIEF_MATCH_NAME,
  BRIEF_SYSTEM_HANDLED,
  packHasBriefMatchEntry,
  readBriefMatchConfig,
  writeBriefMatchVariables,
  type BriefMatchConfig,
} from "@/lib/ce-brief-match";
import { LayerScanCard } from "./LayerScanCard";
import { CompiledPromptPanel, EmptyRow, ErrorBanner, ModeToggle, RawToFormNotice, RiskBadge, SectionCard, StatusBadge, useCERefresh } from "./shared";
import type { CEMode, CEScope, PromptRow, RiskLevel, ValidatorPackData } from "./types";
import { CE_TYPES, scopeProjectId, tryParse } from "./types";

// รวมผลสแกน (key = validator id) เข้ากับฟอร์ม Validator Pack ปัจจุบัน — ปรับเฉพาะ prompt ของแต่ละ validator
// ทับเฉพาะตัวที่สแกนเจอ ตัวที่สแกนไม่เจอยังเก็บ prompt เดิมไว้ — ทีมแก้ต่อได้ทุกช่องก่อนบันทึก
function applyValidatorPackFields(current: ValidatorPackData, fields: Record<string, string>): ValidatorPackData {
  const next: ValidatorPackData = { ...current };
  if (fields.industryScope) next.industryScope = fields.industryScope;
  if (fields.riskScope && (RISK_OPTIONS as string[]).includes(fields.riskScope)) next.riskScope = fields.riskScope as RiskLevel;
  next.validators = current.validators.map((v) => (fields[v.id] ? { ...v, prompt: fields[v.id] } : v));
  return next;
}

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
  /** Brief Match setting of a free-text pack — saved beside the text, never inside it. */
  briefMatch: BriefMatchConfig;
}

/** Carry a free-text pack's Brief Match setting into the form's own entry (item 12). */
function withBriefMatch(data: ValidatorPackData, config: BriefMatchConfig): ValidatorPackData {
  return {
    ...data,
    validators: data.validators.map((v) => (v.id === BRIEF_MATCH_ID ? { ...v, enabled: config.enabled, prompt: config.criteria } : v)),
  };
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
    return {
      name: item.name,
      description: item.description ?? "",
      mode: "form",
      data: { ...emptyValidatorPack(), ...parsed, validators },
      rawText: item.promptText,
      briefMatch: readBriefMatchConfig(item.promptText, item.variables),
    };
  }
  return {
    name: item.name,
    description: item.description ?? "",
    mode: "raw",
    data: emptyValidatorPack(),
    rawText: item.promptText,
    briefMatch: readBriefMatchConfig(item.promptText, item.variables),
  };
}

function newDraft(): Draft {
  return { name: "Validator Pack ใหม่", description: "", mode: "form", data: emptyValidatorPack(), rawText: "", briefMatch: readBriefMatchConfig(null) };
}

export function ValidatorPacksTab({ items, scope, canEdit }: Props) {
  const refresh = useCERefresh();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(items[0] ? parseItem(items[0]) : newDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawToFormNotice, setRawToFormNotice] = useState(false);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  // ชุด Active แก้ทับได้ (คำสั่งเจ้าของ 2026-09-14: บันทึกแล้วต้องมีผลทันที) — ทุกการบันทึกเก็บเวอร์ชันเดิมไว้ใน Versions & Audit
  const isActiveRow = !!selected?.isActive;

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
    setDraft({ ...draft, mode: "form", data: withBriefMatch(emptyValidatorPack(), draft.briefMatch) });
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

  // A free-text pack keeps its Brief Match setting beside the text (the row's `variables`), so the text the
  // writer receives is never touched. A pack whose text lists the validator itself (form / JSON) needs nothing here.
  const briefMatchInText = draft.mode === "raw" && packHasBriefMatchEntry(draft.rawText);
  const briefMatchShown = briefMatchInText ? readBriefMatchConfig(draft.rawText) : draft.briefMatch;
  function briefMatchVariables(): { variables?: string } {
    if (draft.mode !== "raw" || briefMatchInText) return {};
    return { variables: writeBriefMatchVariables(selected?.variables, draft.briefMatch) };
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
      ...briefMatchVariables(),
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
        refresh();
      }
    } else {
      const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "save");
      if (created?.id) {
        setSelectedId(created.id);
        toast.success("สร้าง Validator Pack แล้ว");
        refresh();
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
      ...briefMatchVariables(),
    };
    const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "clone");
    if (created?.id) {
      setSelectedId(created.id);
      toast.success("Clone เป็น Draft ใหม่แล้ว");
      refresh();
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
      refresh();
    }
  }

  function updateValidator(id: string, patch: Partial<ValidatorPackData["validators"][number]>) {
    setDraft({
      ...draft,
      data: { ...draft.data, validators: draft.data.validators.map((v) => (v.id === id ? { ...v, ...patch } : v)) },
    });
  }

  // สแกนเว็บ/ข้อความ → ปรับ prompt ของ validator ให้ตรงบริบทธุรกิจ (ร่างเท่านั้น ยังไม่บันทึกจนกว่าทีมกดบันทึก)
  function applyLayerScan(fields: Record<string, string>) {
    setDraft((d) => {
      if (d.mode === "raw") {
        const parsed = tryParse<ValidatorPackData>(d.rawText);
        let base: ValidatorPackData;
        if (parsed) {
          const byId = new Map(parsed.validators?.map((v) => [v.id, v]) ?? []);
          const validators = DEFAULT_VALIDATORS.map((dv) => ({ ...dv, ...(byId.get(dv.id) ?? {}) }));
          base = { ...emptyValidatorPack(), ...parsed, validators };
        } else {
          base = withBriefMatch(emptyValidatorPack(), d.briefMatch);
        }
        return { ...d, mode: "form", data: applyValidatorPackFields(base, fields) };
      }
      return { ...d, data: applyValidatorPackFields(d.data, fields) };
    });
  }

  const disabled = !canEdit;

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
            // นับจากรายการ default รวมกับค่าที่บันทึกไว้ — validator ที่เพิ่มทีหลัง (เช่น Brief Match) เปิดใช้เป็นค่าเริ่มต้นแม้ pack เก่ายังไม่มี
            const storedById = new Map((parsed?.validators ?? []).map((v) => [v.id, v]));
            const enabledCount = DEFAULT_VALIDATORS.filter((d) => (storedById.get(d.id) ?? d).enabled).length;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectItem(item)}
                className={cn(
                  "w-full rounded-2xl border px-3 py-2.5 text-left transition-colors",
                  selectedId === item.id ? "border-brand-blue/40 bg-brand-blue/10" : "border-white/80 bg-white/70 hover:bg-brand-mist"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-brand-navy">{item.name}</span>
                  {item.isActive && (
                    <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">ACTIVE</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-400">
                  {parsed
                    ? `${enabledCount}/${DEFAULT_VALIDATORS.length} validators เปิดใช้งาน`
                    : `ข้อความอิสระ · Brief Match ${readBriefMatchConfig(item.promptText, item.variables).enabled ? "เปิด" : "ปิด"}`}
                </p>
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
          <div className="rounded-3xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-brand-navy">{selectedId ? "แก้ไข Validator Pack" : "สร้าง Validator Pack ใหม่"}</h2>
                {isActiveRow && <p className="mt-0.5 text-xs text-amber-600">ชุดนี้ Active อยู่ — บันทึกแล้วมีผลกับบทความใหม่ทันที (เวอร์ชันเดิมดูได้ที่ Versions &amp; Audit)</p>}
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
                {canEdit && selected && (
                  <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={cloneAsDraft}>
                    {busy === "clone" ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                    Clone เป็น Draft ใหม่
                  </Button>
                )}
                {canEdit && (
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
                  className="h-9 w-full rounded-xl border border-gray-200 bg-white px-2.5 text-sm disabled:opacity-60"
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
                  className="h-9 w-full rounded-xl border border-gray-200 bg-white px-2.5 text-sm disabled:opacity-60"
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

          {canEdit && draft.mode === "form" && (
            <LayerScanCard
              key={selectedId ?? "new"}
              layer="CE_VALIDATOR_PACK"
              projectId={scopeProjectId(scope)}
              onApply={applyLayerScan}
              title="ปรับ Validator Pack ให้ตรงบริบทธุรกิจ"
              description="วางลิงก์เว็บลูกค้าหรือวางข้อความบริบท ระบบจะปรับ prompt ของแต่ละ validator ให้ตรงอุตสาหกรรม/ความเสี่ยงของธุรกิจนี้ แก้ต่อได้ทุกช่อง"
            />
          )}
          {canEdit && draft.mode === "raw" && (
            <p className="rounded-2xl border border-dashed border-gray-200 bg-white/50 px-4 py-3 text-xs text-gray-400">
              สลับเป็นโหมดฟอร์มก่อน ถึงจะใช้ “ปรับ Validator Pack ให้ตรงบริบทธุรกิจ” ได้
            </p>
          )}

          {draft.mode === "form" && (
            <CompiledPromptPanel
              promptId={selectedId}
              data={draft.data as unknown as Record<string, unknown>}
              canEdit={canEdit}
              locked={false}
              onChange={(next) => setDraft({ ...draft, data: next as unknown as typeof draft.data })}
            />
          )}

          {draft.mode === "raw" ? (
            <>
              <BriefMatchCard
                config={briefMatchShown}
                lockedByText={briefMatchInText}
                disabled={disabled}
                onChange={(next) => setDraft({ ...draft, briefMatch: next })}
              />
              <div className="rounded-3xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur md:p-5">
                {rawToFormNotice && <RawToFormNotice onStartFresh={startFreshForm} />}
                <Label className="text-xs text-gray-600">ข้อความ Validator Pack (ส่งให้ตัวเขียนตามนี้ทุกตัวอักษร)</Label>
                <Textarea
                  value={draft.rawText}
                  disabled={disabled}
                  onChange={(e) => setDraft({ ...draft, rawText: e.target.value })}
                  className="mt-1 min-h-[300px] font-mono text-xs"
                />
                <p className="mt-2 text-xs text-gray-400">
                  วางเป็นข้อความ prompt ตรงๆ ได้เลย — ระบบใช้ข้อความนี้ตามลำดับ layer ตอน compile
                </p>
              </div>
            </>
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
                        <div className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/60 px-3 py-2">
                          <span className="text-xs text-gray-600">Blocking{v.blockingLocked && " (locked)"}</span>
                          <Switch checked={v.blocking} disabled={disabled || v.blockingLocked} onCheckedChange={(checked) => updateValidator(v.id, { blocking: checked })} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/60 px-3 py-2">
                          <span className="text-xs text-gray-600">Auto-fix{v.autoFixLocked && " (locked)"}</span>
                          <Switch
                            checked={v.autoFixAllowed}
                            disabled={disabled || v.autoFixLocked}
                            onCheckedChange={(checked) => updateValidator(v.id, { autoFixAllowed: checked })}
                          />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/60 px-3 py-2">
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
                      {v.id === BRIEF_MATCH_ID && <BriefMatchJudgeDetails />}
                    </SectionCard>
                  ))}
              </div>

              <SectionCard title="Common Output Schema (read-only — ใช้ร่วมกันทุก Validator)">
                <pre className="overflow-x-auto rounded-2xl bg-brand-mist p-3 text-xs text-gray-600">{VALIDATOR_OUTPUT_SCHEMA}</pre>
              </SectionCard>
            </>
          )}

          {!canEdit && <p className="text-xs text-gray-400">ดูได้อย่างเดียว — เฉพาะ Admin เท่านั้นที่แก้ไขได้</p>}
        </section>
      </div>
    </div>
  );
}

/** What the judge model is told, shown read-only so the team can see everything behind the switch. */
function BriefMatchJudgeDetails() {
  return (
    <details className="mt-3 rounded-2xl border border-gray-200 bg-white/60 px-3 py-2 text-xs text-gray-600">
      <summary className="cursor-pointer select-none font-medium text-brand-navy">ดูคำสั่งเต็มที่ส่งให้ AI ตรวจ</summary>
      <div className="mt-3 space-y-3">
        <div>
          <p className="font-medium text-gray-700">1. คำสั่งของผู้ตรวจ (ระบบกำหนด แก้ในหน้านี้ไม่ได้)</p>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-brand-mist p-3 font-mono text-[11px] leading-relaxed text-gray-700">{BRIEF_JUDGE_SYSTEM_PROMPT}</pre>
        </div>
        <div>
          <p className="font-medium text-gray-700">2. ข้อมูลที่ส่งไปให้ตรวจ เรียงตามลำดับ</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {BRIEF_JUDGE_INPUTS.map((input) => (
              <li key={input.heading}>
                <span className="font-medium text-gray-700">{input.heading}</span> — {input.note}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <p className="font-medium text-gray-700">3. สิ่งที่ระบบเติมเองหลังเขียน (ไม่นับว่าบทความขาด)</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {BRIEF_SYSTEM_HANDLED.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <p className="text-gray-500">
          ทุกจุดที่ AI รายงานถูกตรวจซ้ำกับข้อความจริงก่อนส่งกลับไปเขียนใหม่: กฎต้องมีอยู่ในคำสั่งคำต่อคำ และท่อนที่ยกมาต้องมีอยู่ในบทความ จุดที่ AI แต่งขึ้นเองจะถูกตัดทิ้ง
        </p>
      </div>
    </details>
  );
}

/** Brief Match for a free-text pack: a separate check after writing, so it gets its own card above the text. */
function BriefMatchCard({
  config,
  lockedByText,
  disabled,
  onChange,
}: {
  config: BriefMatchConfig;
  /** The pack text is a form (JSON) that lists this validator itself — edit it in form mode. */
  lockedByText: boolean;
  disabled: boolean;
  onChange: (next: BriefMatchConfig) => void;
}) {
  const locked = disabled || lockedByText;
  const isDefault = config.criteria.trim() === BRIEF_MATCH_DEFAULT_PROMPT;
  return (
    <div
      className={cn(
        "rounded-3xl border p-4 shadow-sm backdrop-blur md:p-5",
        config.enabled ? "border-brand-blue/30 bg-brand-blue/5" : "border-gray-200 bg-white/70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-2xl",
              config.enabled ? "bg-brand-blue/15 text-brand-blue" : "bg-gray-100 text-gray-400"
            )}
          >
            <ShieldCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-brand-navy">{BRIEF_MATCH_NAME}</h3>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  config.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                )}
              >
                {config.enabled ? "เปิดอยู่" : "ปิดอยู่"}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-600">
              ขั้นตรวจแยก ทำงานหลัง AI เขียนบทความเสร็จ — ไม่ได้อยู่ในข้อความ Validator Pack ด้านล่าง และไม่เปลี่ยน prompt ของตัวเขียน
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-gray-500">เปิดใช้งาน</span>
          <Switch checked={config.enabled} disabled={locked} onCheckedChange={(checked) => onChange({ ...config, enabled: checked })} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/80 bg-white/60 px-3 py-2">
          <p className="font-medium text-gray-700">ตรวจบทความเทียบกับ</p>
          <p className="mt-0.5">Master Prompt · Article Brief · Template / โครงสร้าง · ข้อจำกัด · Comment ลูกค้า</p>
        </div>
        <div className="rounded-2xl border border-white/80 bg-white/60 px-3 py-2">
          <p className="font-medium text-gray-700">ถ้าไม่ตรง</p>
          <p className="mt-0.5">ส่งกลับไปเขียนใหม่ สูงสุด 2 รอบ ยังไม่ผ่านจะบันทึกพร้อมคำเตือน “ยังไม่ตรง …” ให้ทีมเห็น</p>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-gray-600">Prompt เกณฑ์ตรวจ (แก้ได้)</Label>
          {!locked && !isDefault && (
            <button
              type="button"
              onClick={() => onChange({ ...config, criteria: BRIEF_MATCH_DEFAULT_PROMPT })}
              className="flex items-center gap-1 text-[11px] text-brand-blue hover:underline"
            >
              <RotateCcw className="size-3" /> คืนค่าเริ่มต้น
            </button>
          )}
        </div>
        <Textarea
          value={config.criteria}
          disabled={locked}
          onChange={(e) => onChange({ ...config, criteria: e.target.value })}
          className="min-h-[72px] text-xs"
        />
        <p className="text-[11px] text-gray-400">
          {lockedByText
            ? "ข้อความ pack นี้เป็นแบบฟอร์ม (JSON) ที่มีรายการนี้อยู่แล้ว — เปิด/ปิดหรือแก้เกณฑ์ที่โหมดกรอกฟอร์ม ข้อ 12"
            : "เปลี่ยนสวิตช์หรือเกณฑ์แล้วกด “บันทึก” ถึงจะมีผล ปล่อยว่าง = ใช้เกณฑ์เริ่มต้น"}
        </p>
      </div>

      <BriefMatchJudgeDetails />
    </div>
  );
}
