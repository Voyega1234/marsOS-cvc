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
import { IMAGE_PROMPT_PLACEHOLDER, IMAGE_PROMPT_VARIABLES } from "./constants";
import { EmptyRow, ErrorBanner, ModeToggle } from "./shared";
import type { CEMode, CEScope, PromptRow } from "./types";
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
  promptText: string;
}

// Image Prompt ไม่มีโครง JSON แยก — promptText เป็นข้อความ prompt ตรงๆ อยู่แล้วทั้งสองโหมด
// "กรอกฟอร์ม" = ช่องกรอกพร้อมตัวแปรช่วยเติม, "วาง Prompt ดิบ" = ช่องข้อความเปล่าล้วน ทั้งคู่ผูกกับ promptText เดียวกัน
function parseItem(item: PromptRow): Draft {
  const isJsonObject = tryParse(item.promptText) !== null;
  return { name: item.name, description: item.description ?? "", mode: isJsonObject ? "form" : "raw", promptText: item.promptText };
}

function newDraft(): Draft {
  return { name: "Image Prompt ใหม่", description: "", mode: "form", promptText: "" };
}

export function ImagePromptsTab({ items, scope, canEdit }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(items[0] ? parseItem(items[0]) : newDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setSelectedId(item.id);
    setDraft(parseItem(item));
  }

  function startNew() {
    setError(null);
    setSelectedId(null);
    setDraft(newDraft());
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

  async function save() {
    if (!draft.name.trim()) {
      setError("ต้องกรอกชื่อ Image Prompt");
      return;
    }
    if (!draft.promptText.trim()) {
      setError("ต้องกรอกเนื้อหา Prompt");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      type: CE_TYPES.IMAGE_PROMPT,
      promptText: draft.promptText,
      projectId: scopeProjectId(scope),
    };
    if (selectedId) {
      const updated = await call(`/api/prompts/${selectedId}`, { method: "PUT", body: JSON.stringify(payload) }, "save");
      if (updated) {
        toast.success("บันทึก Image Prompt แล้ว");
        router.refresh();
      }
    } else {
      const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "save");
      if (created?.id) {
        setSelectedId(created.id);
        toast.success("สร้าง Image Prompt แล้ว");
        router.refresh();
      }
    }
  }

  async function cloneAsDraft() {
    if (!selected) return;
    const payload = {
      name: `${draft.name} (v${selected.version + 1})`,
      description: draft.description.trim(),
      type: CE_TYPES.IMAGE_PROMPT,
      promptText: draft.promptText,
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

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-2">
          {canEdit && (
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={startNew}>
              <Plus className="size-3.5" /> สร้าง Image Prompt ใหม่
            </Button>
          )}
          {items.length === 0 && <EmptyRow>ยังไม่มี Image Prompt</EmptyRow>}
          {items.map((item) => (
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
              <p className="mt-0.5 truncate text-xs text-gray-400">{item.description || "—"}</p>
              <span className="mt-1.5 inline-block text-[11px] text-gray-400">v{item.version}</span>
            </button>
          ))}
        </aside>

        <section className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-brand-navy">{selectedId ? "แก้ไข Image Prompt" : "สร้าง Image Prompt ใหม่"}</h2>
                {locked && <p className="mt-0.5 text-xs text-amber-600">ชุดนี้กำลัง Active อยู่ — ห้ามแก้ทับ ต้อง Clone เป็น Draft ใหม่ก่อนแก้ไข</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeToggle mode={draft.mode} onChange={(m) => setDraft({ ...draft, mode: m })} disabled={!canEdit || locked} />
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
                <Label className="text-xs text-gray-600">ชื่อ Image Prompt</Label>
                <Input value={draft.name} disabled={!canEdit || locked} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">คำอธิบายสั้น</Label>
                <Input
                  value={draft.description}
                  disabled={!canEdit || locked}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs text-gray-600">Prompt Text</Label>
              {draft.mode === "form" && (
                <div className="flex flex-wrap gap-1.5">
                  {IMAGE_PROMPT_VARIABLES.map((v) => (
                    <span key={v} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[11px] text-gray-500">
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Textarea
              value={draft.promptText}
              disabled={!canEdit || locked}
              placeholder={draft.mode === "form" ? IMAGE_PROMPT_PLACEHOLDER : undefined}
              onChange={(e) => setDraft({ ...draft, promptText: e.target.value })}
              className="min-h-[300px] font-mono text-xs"
            />
            {draft.mode === "form" ? (
              <p className="mt-2 text-xs text-gray-400">
                ใช้ตัวแปร {"{{keyword}}"}, {"{{title}}"}, {"{{site_name}}"}, {"{{brand_tone}}"}, {"{{accent_color}}"} ได้ — ระบบจะแทนค่าให้ตอนสร้างภาพ
              </p>
            ) : (
              <p className="mt-2 text-xs text-gray-400">
                วางเป็นข้อความ prompt ตรงๆ ได้เลย — ระบบใช้ข้อความนี้ตามลำดับ layer ตอน compile
              </p>
            )}
          </div>

          {!canEdit && <p className="text-xs text-gray-400">ดูได้อย่างเดียว — เฉพาะ Admin เท่านั้นที่แก้ไขได้</p>}
        </section>
      </div>
    </div>
  );
}
