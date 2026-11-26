"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ceScopeKey, type CeAiModelChoice, type CeModelKind } from "@/lib/ce-ai-models";
import type { OrModelOption } from "@/lib/openrouter-models";
import { cn } from "@/lib/utils";
import { ErrorBanner, SectionCard } from "./shared";
import type { CEScope } from "./types";
import { fmtThb } from "@/lib/ai-cost-format";

interface ModelOptions {
  text: OrModelOption[];
  image: OrModelOption[];
  fetchedAt: string;
}

const EMPTY: CeAiModelChoice = { write: "", regenerate: "", image: "", translate: "" };
const MAX_ROWS = 60;

const KIND_CARDS: { kind: CeModelKind; title: string; hint: string }[] = [
  { kind: "write", title: "เขียนบทความใหม่ / Generate", hint: "ใช้ตอนเขียนบทความใหม่ และตอน Generate จาก keyword / outline" },
  { kind: "regenerate", title: "Re-generate บทความ", hint: "ใช้ตอนเขียนใหม่ทับบทความเดิม และตอนแก้ตาม Comment" },
  { kind: "image", title: "รูปภาพ", hint: "ใช้วาดปกและรูปในบทความ (ขั้นเรียบเรียงบรีฟภาพยังใช้โมเดลกลางของระบบ)" },
  { kind: "translate", title: "Translate บทความ", hint: "ใช้ตอนแปลบทความและตรวจคำแปลเทียบต้นฉบับ (แท็บ Translate ของ Upload Article)" },
];

/** 200000 -> "200K", 1000000 -> "1M" */
function fmtTokens(n: number | undefined): string | null {
  if (n === undefined || n === null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function fmtPrice(o: OrModelOption): string {
  const { promptPerM: a, completionPerM: b } = o;
  if (a === 0 && b === 0) return "ฟรี";
  const f = (v: number | undefined) => (v === undefined || v === null ? "—" : fmtThb(v));
  return `เข้า ${f(a)} / ออก ${f(b)} ต่อ 1M tokens`;
}

export function AiModelsTab({
  scope,
  canEdit,
  showTranslate = false,
}: {
  scope: CEScope;
  canEdit: boolean;
  /** the Translate card — only where a Translate tab exists (an Upload Article client) */
  showTranslate?: boolean;
}) {
  const key = ceScopeKey(scope);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CeAiModelChoice>(EMPTY);
  const [draft, setDraft] = useState<CeAiModelChoice>(EMPTY);
  const [defaults, setDefaults] = useState<CeAiModelChoice>(EMPTY);
  const [options, setOptions] = useState<ModelOptions | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState<Record<CeModelKind, string>>({ write: "", regenerate: "", image: "", translate: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/content-engine/ai-models?scope=${encodeURIComponent(key)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      const models: CeAiModelChoice = { ...EMPTY, ...(body.models ?? {}) };
      setSaved(models);
      setDraft(models);
      setDefaults({ ...EMPTY, ...(body.defaults ?? {}) });
      setOptions(body.options ?? null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    draft.write !== saved.write ||
    draft.regenerate !== saved.regenerate ||
    draft.image !== saved.image ||
    draft.translate !== saved.translate;

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/content-engine/ai-models?scope=${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ write: draft.write, regenerate: draft.regenerate, image: draft.image, translate: draft.translate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      const models: CeAiModelChoice = { ...EMPTY, ...(body.models ?? {}) };
      setSaved(models);
      setDraft(models);
      if (body.defaults) setDefaults({ ...EMPTY, ...body.defaults });
      toast.success("บันทึก AI Model แล้ว");
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Filtered lists per kind (memoized). write and regenerate share the text list.
  const q = search;
  const filtered = useMemo(() => {
    const run = (list: OrModelOption[], term: string) => {
      const t = term.trim().toLowerCase();
      return t ? list.filter((o) => o.name.toLowerCase().includes(t) || o.id.toLowerCase().includes(t)) : list;
    };
    const text = options?.text ?? [];
    const image = options?.image ?? [];
    return {
      write: run(text, q.write),
      regenerate: run(text, q.regenerate),
      image: run(image, q.image),
      translate: run(text, q.translate),
    } as Record<CeModelKind, OrModelOption[]>;
  }, [options, q]);

  const disabled = !canEdit || saving;

  if (loading) {
    return (
      <SectionCard title="AI Model">
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="size-4 animate-spin" /> กำลังโหลด…
        </p>
      </SectionCard>
    );
  }

  if (loadError) {
    return (
      <SectionCard title="AI Model">
        <ErrorBanner message={loadError} />
        <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          ลองใหม่
        </Button>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="AI Model"
        description="เลือกโมเดล AI ที่ Content Engine นี้ใช้ — ค่านี้ใช้เฉพาะที่นี่ ไม่แชร์กับ Content Engine อื่น"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
              <Undo2 className="size-3.5" />
              ยกเลิกการแก้ไข
            </Button>
            <Button size="sm" className="gap-1.5" disabled={!canEdit || !dirty || saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              บันทึก
            </Button>
          </div>
        }
      >
        <ErrorBanner message={saveError} />
        {options === null && (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-sm text-amber-700">
            <span>ดึงรายการโมเดลจาก OpenRouter ไม่ได้ตอนนี้</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()}>
              <RefreshCw className="size-3.5" />
              ลองใหม่
            </Button>
          </div>
        )}
      </SectionCard>

      {KIND_CARDS.filter((c) => c.kind !== "translate" || showTranslate).map(({ kind, title, hint }) => {
        const current = draft[kind];
        const list = options ? (kind === "image" ? options.image : options.text) : null;
        const found = current && list ? list.find((o) => o.id === current) : undefined;
        const matches = filtered[kind];
        const shown = matches.slice(0, MAX_ROWS);
        const more = matches.length - shown.length;
        const missing = !!current && !!list && !found;
        const defaultId = defaults[kind];

        return (
          <SectionCard key={kind} title={title} description={hint}>
            <p className="text-sm text-gray-700">
              <span className="text-gray-500">ตอนนี้ใช้ </span>
              {current ? (
                <>
                  {found && <span className="font-medium">{found.name} </span>}
                  <span className="font-mono text-xs text-gray-500">{current}</span>
                </>
              ) : (
                <>
                  <span className="font-medium">ค่าเริ่มต้นของระบบ</span>
                  {defaultId && <span className="font-mono text-xs text-gray-500"> {defaultId}</span>}
                </>
              )}
            </p>
            {missing && (
              <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-700">
                โมเดลนี้ไม่อยู่ในรายการของ OpenRouter แล้ว — เลือกใหม่ หรือกลับไปใช้ค่าเริ่มต้น
              </p>
            )}

            {list === null ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-sm font-mono text-xs"
                  value={current}
                  disabled={disabled}
                  placeholder="vendor/model"
                  onChange={(e) => setDraft((d) => ({ ...d, [kind]: e.target.value.trim() }))}
                />
                <Button size="sm" variant="outline" disabled={disabled || !current} onClick={() => setDraft((d) => ({ ...d, [kind]: "" }))}>
                  ใช้ค่าเริ่มต้นของระบบ
                </Button>
              </div>
            ) : (
              <>
                <Input
                  className="mt-3"
                  value={search[kind]}
                  placeholder="ค้นหาชื่อหรือ id ของโมเดล"
                  onChange={(e) => setSearch((s) => ({ ...s, [kind]: e.target.value }))}
                />
                <div className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-gray-100 p-1.5">
                  <ModelRow
                    selected={current === ""}
                    disabled={disabled}
                    onClick={() => setDraft((d) => ({ ...d, [kind]: "" }))}
                  >
                    <span className="text-sm font-medium">ใช้ค่าเริ่มต้นของระบบ</span>
                    {defaultId && <span className="font-mono text-[11px] opacity-70">{defaultId}</span>}
                  </ModelRow>
                  {shown.map((o) => (
                    <ModelRow
                      key={o.id}
                      selected={current === o.id}
                      disabled={disabled || (kind === "image" && o.imageInput === false)}
                      onClick={() => setDraft((d) => ({ ...d, [kind]: o.id }))}
                    >
                      <span className="text-sm font-medium">{o.name}</span>
                      <span className="font-mono text-[11px] opacity-70">{o.id}</span>
                      {kind === "image" ? (
                        <span
                          className={cn(
                            "mt-0.5 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            o.imageInput
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          )}
                        >
                          {o.imageInput ? "รับภาพอ้างอิงได้" : "ไม่รับภาพอ้างอิง — เลือกไม่ได้"}
                        </span>
                      ) : (
                        <span className="text-[11px] opacity-70">
                          {fmtPrice(o)}
                          {fmtTokens(o.contextLength) && ` · context ${fmtTokens(o.contextLength)}`}
                          {fmtTokens(o.maxOutput) && ` · output สูงสุด ${fmtTokens(o.maxOutput)}`}
                        </span>
                      )}
                    </ModelRow>
                  ))}
                  {more > 0 && <p className="px-3 py-2 text-xs text-gray-400">มีอีก {more.toLocaleString()} รายการ — พิมพ์เพื่อค้นหา</p>}
                  {matches.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">ไม่พบโมเดลที่ค้นหา</p>}
                </div>
                {kind === "image" && (
                  <p className="mt-2 text-xs text-gray-500">เลือกได้เฉพาะโมเดลที่รับภาพอ้างอิง เพราะปกวาดจากภาพอ้างอิงและโลโก้ของ Content Engine</p>
                )}
              </>
            )}
          </SectionCard>
        );
      })}

      <p className="px-1 text-xs text-gray-400">ราคาเป็นราคาตามรายการของ OpenRouter ค่าใช้จ่ายจริงดูได้ที่หน้า AI Cost</p>
    </div>
  );
}

function ModelRow({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "bg-brand-blue text-white shadow-sm" : "text-gray-700 hover:bg-white/80"
      )}
    >
      {children}
    </button>
  );
}
