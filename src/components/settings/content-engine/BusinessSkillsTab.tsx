"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BUSINESS_SKILL_CARDS, RISK_OPTIONS, STATUS_OPTIONS } from "./constants";
import { ObjectCardForm, RepeatableCardForm, computeCompleteness } from "./FieldRenderer";
import { EmptyRow, ErrorBanner, ModeToggle, RawToFormNotice, RiskBadge, StatusBadge } from "./shared";
import type { BusinessSkillData, CEMode, CEScope, PromptRow } from "./types";
import { CE_TYPES, emptyBusinessSkill, scopeProjectId, tryParse } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  canEdit: boolean;
}

interface Draft {
  name: string;
  description: string;
  mode: CEMode;
  data: BusinessSkillData;
  rawText: string;
}

function parseItem(item: PromptRow): Draft {
  const parsed = tryParse<BusinessSkillData>(item.promptText);
  if (parsed) {
    return { name: item.name, description: item.description ?? "", mode: "form", data: { ...emptyBusinessSkill(), ...parsed }, rawText: item.promptText };
  }
  return { name: item.name, description: item.description ?? "", mode: "raw", data: emptyBusinessSkill(), rawText: item.promptText };
}

function newDraft(): Draft {
  return { name: "Business Skill ใหม่", description: "", mode: "form", data: emptyBusinessSkill(), rawText: "" };
}

export function BusinessSkillsTab({ items, scope, canEdit }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(items[0] ? parseItem(items[0]) : newDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawToFormNotice, setRawToFormNotice] = useState(false);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const locked = !!selected?.isActive; // Active ห้ามแก้ทับ

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
    const parsed = tryParse<BusinessSkillData>(draft.rawText);
    if (parsed) {
      setDraft({ ...draft, mode: "form", data: { ...emptyBusinessSkill(), ...parsed } });
      setRawToFormNotice(false);
    } else {
      setRawToFormNotice(true);
    }
  }

  function startFreshForm() {
    setDraft({ ...draft, mode: "form", data: emptyBusinessSkill() });
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
      setError("ต้องกรอกชื่อ Business Skill");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      type: CE_TYPES.BUSINESS_SKILL,
      promptText: buildPromptText(),
      projectId: scopeProjectId(scope),
    };

    if (selectedId) {
      const updated = await call(`/api/prompts/${selectedId}`, { method: "PUT", body: JSON.stringify(payload) }, "save");
      if (updated) {
        // sync isActive กับ status ใน JSON
        if (draft.mode === "form" && draft.data.status === "Active" && !selected?.isActive) {
          await call(`/api/prompts/${selectedId}/activate`, { method: "POST", body: JSON.stringify({ action: "activate" }) }, "save");
        } else if (draft.mode === "form" && draft.data.status !== "Active" && selected?.isActive) {
          await call(`/api/prompts/${selectedId}/activate`, { method: "POST", body: JSON.stringify({ action: "deactivate" }) }, "save");
        }
        toast.success("บันทึก Business Skill แล้ว");
        router.refresh();
      }
    } else {
      const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "save");
      if (created?.id) {
        setSelectedId(created.id);
        toast.success("สร้าง Business Skill แล้ว");
        router.refresh();
      }
    }
  }

  async function cloneAsDraft() {
    if (!selected) return;
    const clonedData: BusinessSkillData = { ...draft.data, status: "Draft" };
    const payload = {
      name: `${draft.name} (v${selected.version + 1})`,
      description: draft.description.trim(),
      type: CE_TYPES.BUSINESS_SKILL,
      promptText: draft.mode === "raw" ? draft.rawText : JSON.stringify(clonedData),
      projectId: scopeProjectId(scope),
    };
    const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "clone");
    if (created?.id) {
      setSelectedId(created.id);
      toast.success("Clone เป็น Draft ใหม่แล้ว — แก้ไขต่อได้");
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

  const completeness = draft.mode === "raw" ? 0 : computeCompleteness(BUSINESS_SKILL_CARDS, draft.data as unknown as Record<string, any>);

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* ── รายการ ─────────────────────────────────────────────── */}
        <aside className="space-y-2">
          {canEdit && (
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={startNew}>
              <Plus className="size-3.5" /> สร้าง Business Skill ใหม่
            </Button>
          )}
          {items.length === 0 && <EmptyRow>ยังไม่มี Business Skill</EmptyRow>}
          {items.map((item) => {
            const parsed = tryParse<BusinessSkillData>(item.promptText);
            const c = parsed ? computeCompleteness(BUSINESS_SKILL_CARDS, parsed as unknown as Record<string, any>) : 0;
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
                <p className="mt-0.5 truncate text-xs text-gray-400">{parsed?.industry || "—"}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {parsed && <StatusBadge status={parsed.status} />}
                  {parsed && <RiskBadge risk={parsed.riskLevel} />}
                  <span className="text-[11px] text-gray-400">v{item.version} · {c}% ครบ</span>
                </div>
              </button>
            );
          })}
        </aside>

        {/* ── ตัวแก้ไข ────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-brand-navy">{selectedId ? "แก้ไข Business Skill" : "สร้าง Business Skill ใหม่"}</h2>
                {locked && <p className="mt-0.5 text-xs text-amber-600">ชุดนี้กำลัง Active อยู่ — ห้ามแก้ทับ ต้อง Clone เป็น Draft ใหม่ก่อนแก้ไข</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeToggle mode={draft.mode} onChange={changeMode} disabled={!canEdit || locked} />
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
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">ชื่อ Business Skill</Label>
                <Input
                  value={draft.name}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Industry</Label>
                <Input
                  value={draft.data.industry}
                  disabled={!canEdit || locked}
                  placeholder="คลินิกเวชกรรม / ผิวหนัง / เลเซอร์"
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, industry: e.target.value } })}
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
                <Label className="text-xs text-gray-600">คำอธิบายสั้น</Label>
                <Input
                  value={draft.description}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            {draft.mode === "form" && (
              <p className="mt-2 text-xs text-gray-400">Completeness: {completeness}%</p>
            )}
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
            <div className="space-y-3">
              {BUSINESS_SKILL_CARDS.map((card) =>
                card.repeatable ? (
                  <RepeatableCardForm
                    key={card.key}
                    card={card}
                    rows={(draft.data as any)[card.key] ?? []}
                    disabled={!canEdit || locked}
                    onChange={(rows) => setDraft({ ...draft, data: { ...draft.data, [card.key]: rows } as BusinessSkillData })}
                  />
                ) : (
                  <ObjectCardForm
                    key={card.key}
                    card={card}
                    value={(draft.data as any)[card.key] ?? {}}
                    disabled={!canEdit || locked}
                    onChange={(v) => setDraft({ ...draft, data: { ...draft.data, [card.key]: v } as BusinessSkillData })}
                  />
                )
              )}
            </div>
          )}

          {!canEdit && <p className="text-xs text-gray-400">ดูได้อย่างเดียว — เฉพาะ Admin เท่านั้นที่แก้ไขได้</p>}
        </section>
      </div>
    </div>
  );
}
