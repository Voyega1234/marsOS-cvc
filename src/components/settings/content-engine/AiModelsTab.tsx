"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, Save, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ceScopeKey, isModelIdSyntax, type CeAiModelChoice, type CeModelKind } from "@/lib/ce-ai-models";
import type { OrModelOption } from "@/lib/openrouter-models";
import { cn } from "@/lib/utils";
import { ErrorBanner, SectionCard } from "./shared";
import type { CEScope } from "./types";
import { fmtCost } from "@/lib/ai-cost-format";

interface ModelOptions {
  text: OrModelOption[];
  image: OrModelOption[];
  fetchedAt: string;
}

const EMPTY: CeAiModelChoice = { write: "", regenerate: "", image: "", translate: "" };
const MAX_ROWS = 60;
const DEFAULT_LABEL = "ค่าเริ่มต้นของระบบ";

const KIND_ROWS: { kind: CeModelKind; title: string; hint: string }[] = [
  { kind: "write", title: "เขียนบทความใหม่ / Generate", hint: "ใช้ตอนเขียนบทความใหม่ และตอน Generate จาก keyword / outline" },
  { kind: "regenerate", title: "Re-generate บทความ", hint: "ใช้ตอนเขียนใหม่ทับบทความเดิม และตอนแก้ตาม Comment" },
  { kind: "image", title: "รูปภาพ", hint: "ใช้วาดปกและรูปในบทความ (ขั้นเรียบเรียงบรีฟภาพยังใช้โมเดลกลางของระบบ)" },
  { kind: "translate", title: "Translate บทความ", hint: "ใช้ตอนแปลบทความและตรวจคำแปลเทียบต้นฉบับ (แท็บ Translate ของ Upload Article)" },
];

function fmtPrice(o: OrModelOption): string | null {
  const { promptPerM: a, completionPerM: b } = o;
  if (a === undefined && b === undefined) return null;
  if (a === 0 && b === 0) return "ฟรี";
  const f = (v: number | undefined) => (v === undefined || v === null ? "—" : fmtCost(v));
  return `เข้า ${f(a)} / ออก ${f(b)} ต่อ 1M`;
}

export function AiModelsTab({
  scope,
  canEdit,
  showTranslate = false,
}: {
  scope: CEScope;
  canEdit: boolean;
  /** the Translate row — only where a Translate tab exists (an Upload Article client) */
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

  // The lists each row can pick from. Cover images are drawn from reference images, so an
  // image model that cannot take one is left out.
  const lists = useMemo(() => {
    if (!options) return null;
    return { text: options.text, image: options.image.filter((o) => o.imageInput !== false) };
  }, [options]);

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
    <SectionCard
      title="AI Model"
      description="โมเดลที่ Content Engine นี้ใช้ — ไม่แชร์กับ Content Engine อื่น"
      action={
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            <Undo2 className="size-3.5" />
            ยกเลิก
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
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-sm text-amber-700">
          <span>ดึงรายการโมเดลจาก OpenRouter ไม่ได้ตอนนี้ — พิมพ์ id ของโมเดลเองได้</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            ลองใหม่
          </Button>
        </div>
      )}

      <Table className="min-w-[620px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[30%]">งาน</TableHead>
            <TableHead className="w-[32%]">ปัจจุบันใช้</TableHead>
            <TableHead>เลือกโมเดล</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {KIND_ROWS.filter((r) => r.kind !== "translate" || showTranslate).map(({ kind, title, hint }) => {
            const list = lists ? (kind === "image" ? lists.image : lists.text) : null;
            const all = options ? (kind === "image" ? options.image : options.text) : null;
            const inUse = saved[kind] || defaults[kind];
            const inUseName = all?.find((o) => o.id === inUse)?.name;
            const gone = !!saved[kind] && !!all && !all.some((o) => o.id === saved[kind]);
            const changed = draft[kind] !== saved[kind];

            return (
              <TableRow key={kind} className="hover:bg-transparent">
                <TableCell className="align-top">
                  <span className="font-medium text-gray-800" title={hint}>
                    {title}
                  </span>
                </TableCell>
                <TableCell className="align-top">
                  {inUse ? (
                    <>
                      <span className="block text-gray-800">{inUseName ?? inUse}</span>
                      {inUseName && <span className="block break-all font-mono text-[11px] text-gray-500">{inUse}</span>}
                    </>
                  ) : (
                    <span className="text-gray-500">{DEFAULT_LABEL}</span>
                  )}
                  {!saved[kind] && inUse && <span className="mt-0.5 block text-[11px] text-gray-500">{DEFAULT_LABEL}</span>}
                  {gone && <span className="mt-0.5 block text-[11px] text-amber-700">ไม่อยู่ในรายการของ OpenRouter แล้ว — เลือกใหม่</span>}
                </TableCell>
                <TableCell className="align-top">
                  <ModelPicker
                    value={draft[kind]}
                    onChange={(id) => setDraft((d) => ({ ...d, [kind]: id }))}
                    options={list}
                    defaultId={defaults[kind]}
                    disabled={disabled}
                    ariaLabel={`เลือกโมเดลสำหรับ ${title}`}
                  />
                  {changed && <span className="mt-1 block text-[11px] text-amber-700">ยังไม่ได้บันทึก</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </SectionCard>
  );
}

interface PickerEntry {
  value: string;
  label: string;
  hint?: string;
}

/**
 * One dropdown per row: open it and pick, or type to narrow the list. "" = the system default.
 * `options === null` means the OpenRouter list could not be fetched; then whatever is typed
 * in "vendor/model" form can be used as it is (the server only checks the form in that case).
 */
function ModelPicker({
  value,
  onChange,
  options,
  defaultId,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  options: OrModelOption[] | null;
  defaultId: string;
  disabled: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { entries, more } = useMemo(() => {
    const term = query.trim();
    const needle = term.toLowerCase();
    const all = options ?? [];
    const matches = needle ? all.filter((o) => o.name.toLowerCase().includes(needle) || o.id.toLowerCase().includes(needle)) : all;
    const out: PickerEntry[] = [];
    if (!needle) out.push({ value: "", label: DEFAULT_LABEL, hint: defaultId || undefined });
    for (const o of matches.slice(0, MAX_ROWS)) {
      const price = fmtPrice(o);
      out.push({ value: o.id, label: o.name, hint: price ? `${o.id} · ${price}` : o.id });
    }
    if (options === null && isModelIdSyntax(term)) out.push({ value: term, label: `ใช้ ${term}`, hint: "id ที่พิมพ์เอง" });
    return { entries: out, more: Math.max(0, matches.length - MAX_ROWS) };
  }, [query, options, defaultId]);

  const selectedName = value ? options?.find((o) => o.id === value)?.name : undefined;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      // the default entry is first, so a chosen model sits one row below its index in the list
      const index = value ? (options ?? []).slice(0, MAX_ROWS).findIndex((o) => o.id === value) + 1 : 0;
      setActive(Math.max(0, index));
    }
  };

  const pick = (entry: PickerEntry) => {
    onChange(entry.value);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(entries.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[active];
      if (entry) pick(entry);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          disabled={disabled}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-input bg-white/90 px-3.5 text-left text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>
            {value ? selectedName ?? value : DEFAULT_LABEL}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 opacity-50" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={options === null ? "พิมพ์ id ของโมเดล เช่น vendor/model" : "พิมพ์ชื่อหรือ id ของโมเดล"}
            aria-label="ค้นหาโมเดล"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {entries.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">ไม่พบโมเดลที่ค้นหา</p>}
          {entries.map((entry, i) => {
            const isSelected = entry.value === value;
            return (
              <button
                key={entry.value || "__default"}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-index={i}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(entry)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                  i === active && "bg-accent text-accent-foreground"
                )}
              >
                <Check className={cn("size-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.label}</span>
                  {entry.hint && <span className="block truncate text-xs text-muted-foreground">{entry.hint}</span>}
                </span>
              </button>
            );
          })}
          {more > 0 && <p className="px-3 py-2 text-xs text-muted-foreground">มีอีก {more.toLocaleString()} รายการ — พิมพ์เพื่อค้นหา</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
