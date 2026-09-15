"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Plus, Save, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { IMAGE_PROMPT_PLACEHOLDER, IMAGE_PROMPT_VARIABLES } from "./constants";
import { LayerScanCard } from "./LayerScanCard";
import { EmptyRow, ErrorBanner, ModeToggle, useCERefresh } from "./shared";
import type { CEMode, CEScope, PromptRow } from "./types";
import { CE_TYPES, scopeProjectId, tryParse } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  canEdit: boolean;
}

// ── Reference & Brand assets (คำสั่งเจ้าของ — Image Prompt item 2) ────────────
// เก็บรวมกับ promptText เดิมในรูป JSON เดียว { promptText, referenceImages, logoImage, brandName, contactInfo, swapPeople }
// เมื่อไม่มี asset ใดเลยยังบันทึกเป็นข้อความดิบเหมือนเดิม (backward compatible กับ Image Prompt เก่า)
const MAX_REFERENCE_IMAGES = 5;
const MAX_LAYER_JSON_BYTES = Math.round(2.5 * 1024 * 1024); // เพดาน ~2.5MB กัน Vercel body limit 4.5MB ตอน save

interface Draft {
  name: string;
  description: string;
  mode: CEMode;
  promptText: string;
  referenceImages: string[];
  logoImage: string | null;
  brandName: string;
  contactInfo: string;
  swapPeople: boolean;
}

function hasAssetData(d: Draft): boolean {
  return (
    d.referenceImages.length > 0 ||
    !!d.logoImage ||
    d.brandName.trim().length > 0 ||
    d.contactInfo.trim().length > 0 ||
    d.swapPeople !== true
  );
}

/** ประกอบ promptText ที่จะส่งไปบันทึก — มี asset ค่อยห่อเป็น JSON ไม่งั้นเก็บดิบเหมือนเดิม */
function buildPromptTextPayload(d: Draft): string {
  if (!hasAssetData(d)) return d.promptText;
  return JSON.stringify({
    promptText: d.promptText,
    referenceImages: d.referenceImages,
    logoImage: d.logoImage,
    brandName: d.brandName,
    contactInfo: d.contactInfo,
    swapPeople: d.swapPeople,
  });
}

function jsonByteSize(d: Draft): number {
  return new TextEncoder().encode(buildPromptTextPayload(d)).length;
}

function formatKB(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** ย่อรูปฝั่ง client ก่อนเก็บเป็น data URL — จำกัดด้านยาวสุดไม่ให้ JSON บวมเกิน */
function downscaleToDataUrl(file: File, maxSize: number, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("โหลดรูปไม่สำเร็จ — ไฟล์อาจไม่ใช่รูปภาพ"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("สร้าง canvas ไม่สำเร็จ")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Image Prompt ไม่มีโครง JSON แยก — promptText เป็นข้อความ prompt ตรงๆ อยู่แล้วทั้งสองโหมด
// "กรอกฟอร์ม" = ช่องกรอกพร้อมตัวแปรช่วยเติม, "วาง Prompt ดิบ" = ช่องข้อความเปล่าล้วน ทั้งคู่ผูกกับ promptText เดียวกัน
// ── จำนวนรูปประกอบกลางบทความ — เก็บเป็นบรรทัด "จำนวนรูปประกอบ: N" ใน promptText ──
//  pipeline (/api/article/write) อ่านบรรทัดนี้ตอน generate · ไม่มีบรรทัด = 1 (default)
const MID_IMAGE_RE = /^\s*จำนวนรูปประกอบ\s*[:：]\s*(\d+)\s*$/m;

function readMidImageCount(promptText: string): number {
  const m = promptText.match(MID_IMAGE_RE);
  if (!m) return 1;
  return Math.min(7, Math.max(1, parseInt(m[1], 10) || 1));
}

function writeMidImageCount(promptText: string, count: number): string {
  const stripped = promptText.replace(MID_IMAGE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  if (count <= 1) return stripped; // default 1 = ไม่ต้องมีบรรทัด
  return `${stripped}\n\nจำนวนรูปประกอบ: ${count}`;
}

function parseItem(item: PromptRow): Draft {
  const parsed = tryParse<Record<string, unknown>>(item.promptText);
  if (parsed) {
    const text =
      (typeof parsed.promptText === "string" && parsed.promptText) ||
      (typeof parsed.template === "string" && parsed.template) ||
      (typeof parsed.text === "string" && parsed.text) ||
      "";
    const referenceImages = Array.isArray(parsed.referenceImages)
      ? parsed.referenceImages.filter((v): v is string => typeof v === "string").slice(0, MAX_REFERENCE_IMAGES)
      : [];
    const logoImage = typeof parsed.logoImage === "string" && parsed.logoImage ? parsed.logoImage : null;
    const brandName = typeof parsed.brandName === "string" ? parsed.brandName : "";
    const contactInfo = typeof parsed.contactInfo === "string" ? parsed.contactInfo : "";
    const swapPeople = typeof parsed.swapPeople === "boolean" ? parsed.swapPeople : true;
    return { name: item.name, description: item.description ?? "", mode: "form", promptText: text, referenceImages, logoImage, brandName, contactInfo, swapPeople };
  }
  return { name: item.name, description: item.description ?? "", mode: "raw", promptText: item.promptText, referenceImages: [], logoImage: null, brandName: "", contactInfo: "", swapPeople: true };
}

function newDraft(): Draft {
  return { name: "Image Prompt ใหม่", description: "", mode: "form", promptText: "", referenceImages: [], logoImage: null, brandName: "", contactInfo: "", swapPeople: true };
}

export function ImagePromptsTab({ items, scope, canEdit }: Props) {
  const refresh = useCERefresh();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(items[0] ? parseItem(items[0]) : newDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      promptText: buildPromptTextPayload(draft),
      projectId: scopeProjectId(scope),
    };
    if (selectedId) {
      const updated = await call(`/api/prompts/${selectedId}`, { method: "PUT", body: JSON.stringify(payload) }, "save");
      if (updated) {
        toast.success("บันทึก Image Prompt แล้ว");
        refresh();
      }
    } else {
      const created = await call("/api/prompts", { method: "POST", body: JSON.stringify(payload) }, "save");
      if (created?.id) {
        setSelectedId(created.id);
        toast.success("สร้าง Image Prompt แล้ว");
        refresh();
      }
    }
  }

  async function cloneAsDraft() {
    if (!selected) return;
    const payload = {
      name: `${draft.name} (v${selected.version + 1})`,
      description: draft.description.trim(),
      type: CE_TYPES.IMAGE_PROMPT,
      promptText: buildPromptTextPayload(draft),
      projectId: scopeProjectId(scope),
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

  // ── Reference & Brand assets handlers ────────────────────────────────────────

  async function addReferenceImages(files: FileList | File[]) {
    if (!canEdit) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    let next = draft;
    for (const file of list) {
      if (next.referenceImages.length >= MAX_REFERENCE_IMAGES) {
        toast.error(`ใส่ภาพอ้างอิงได้สูงสุด ${MAX_REFERENCE_IMAGES} ภาพ`);
        break;
      }
      try {
        const dataUrl = await downscaleToDataUrl(file, 768, 0.8);
        const candidate = { ...next, referenceImages: [...next.referenceImages, dataUrl] };
        if (jsonByteSize(candidate) > MAX_LAYER_JSON_BYTES) {
          toast.error("ข้อมูล Image Prompt รวมภาพอ้างอิงจะเกิน 2.5MB — ลบภาพเดิมออกก่อนเพิ่ม");
          break;
        }
        next = candidate;
      } catch (err) {
        toast.error((err as Error).message);
        break;
      }
    }
    if (next !== draft) setDraft(next);
  }

  function removeReferenceImage(idx: number) {
    setDraft({ ...draft, referenceImages: draft.referenceImages.filter((_, i) => i !== idx) });
  }

  async function setLogoImage(file: File) {
    if (!canEdit || !file.type.startsWith("image/")) return;
    try {
      const dataUrl = await downscaleToDataUrl(file, 512, 0.8);
      const candidate = { ...draft, logoImage: dataUrl };
      if (jsonByteSize(candidate) > MAX_LAYER_JSON_BYTES) {
        toast.error("ข้อมูล Image Prompt รวมโลโก้จะเกิน 2.5MB — ลบภาพอ้างอิงบางส่วนก่อน");
        return;
      }
      setDraft(candidate);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function removeLogoImage() {
    setDraft({ ...draft, logoImage: null });
  }

  // ผลสแกน (ลิงก์/ข้อความ) ของชั้น Image Prompt มีช่องเดียวคือ promptText
  function applyLayerScan(fields: Record<string, string>) {
    if (fields.promptText) setDraft({ ...draft, promptText: fields.promptText });
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
          {canEdit && (
            <LayerScanCard
              key={selectedId ?? "new"}
              layer="CE_IMAGE_PROMPT"
              projectId={scopeProjectId(scope)}
              onApply={applyLayerScan}
              title="ร่าง Image Prompt จากเว็บไซต์/ข้อความ"
              description="วางลิงก์เว็บลูกค้าหรือวางข้อความบริบท ระบบจะร่าง prompt สร้างภาพให้ แก้ต่อได้ทุกช่อง"
            />
          )}
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-brand-navy">{selectedId ? "แก้ไข Image Prompt" : "สร้าง Image Prompt ใหม่"}</h2>
                {isActiveRow && <p className="mt-0.5 text-xs text-amber-600">ชุดนี้ Active อยู่ — บันทึกแล้วมีผลกับบทความใหม่ทันที (เวอร์ชันเดิมดูได้ที่ Versions &amp; Audit)</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeToggle mode={draft.mode} onChange={(m) => setDraft({ ...draft, mode: m })} disabled={!canEdit} />
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
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">ชื่อ Image Prompt</Label>
                <Input value={draft.name} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">คำอธิบายสั้น</Label>
                <Input
                  value={draft.description}
                  disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <Label className="text-xs text-gray-600">Prompt Text</Label>
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] text-gray-500">รูปประกอบกลางบทความ</Label>
                  <select
                    value={readMidImageCount(draft.promptText)}
                    disabled={!canEdit}
                    onChange={(e) => setDraft({ ...draft, promptText: writeMidImageCount(draft.promptText, parseInt(e.target.value, 10)) })}
                    className="h-7 rounded-md border border-gray-200 bg-white px-1.5 text-xs text-brand-navy disabled:opacity-50"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={n}>{n} รูป</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-gray-400">(+ปก 1 · default 1)</span>
                </div>
              </div>
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
              disabled={!canEdit}
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

          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs text-gray-600">Reference &amp; Brand assets</Label>
              <span className="text-[11px] text-gray-400">
                ขนาดข้อมูลชั้นนี้: {formatKB(jsonByteSize(draft))} / {formatKB(MAX_LAYER_JSON_BYTES)}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">ภาพอ้างอิง (สูงสุด {MAX_REFERENCE_IMAGES} ภาพ)</Label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (canEdit) addReferenceImages(e.dataTransfer.files); }}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-3",
                  !canEdit && "opacity-60"
                )}
              >
                {draft.referenceImages.map((src, idx) => (
                  <div key={idx} className="relative h-20 w-20 overflow-hidden rounded-md border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`ภาพอ้างอิง ${idx + 1}`} className="h-full w-full object-cover" />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeReferenceImage(idx)}
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
                {canEdit && draft.referenceImages.length < MAX_REFERENCE_IMAGES && (
                  <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-gray-300 bg-white text-gray-400 hover:bg-gray-50">
                    <Upload className="size-4" />
                    <span className="text-[10px]">เพิ่มภาพ</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { if (e.target.files) addReferenceImages(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                )}
              </div>
              <p className="text-[11px] text-gray-400">ลากไฟล์มาวาง หรือกด &quot;เพิ่มภาพ&quot; — ระบบย่อภาพให้อัตโนมัติก่อนบันทึก</p>
            </div>

            <div className="mt-3 space-y-1.5">
              <Label className="text-xs text-gray-600">โลโก้แบรนด์</Label>
              <div className="flex items-center gap-2">
                {draft.logoImage ? (
                  <div className="relative h-16 w-16 overflow-hidden rounded-md border border-gray-200 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draft.logoImage} alt="โลโก้แบรนด์" className="h-full w-full object-contain" />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={removeLogoImage}
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ) : (
                  canEdit && (
                    <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 bg-gray-50/50 text-gray-400 hover:bg-gray-50">
                      <Upload className="size-4" />
                      <span className="text-[10px]">โลโก้</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { if (e.target.files?.[0]) setLogoImage(e.target.files[0]); e.target.value = ""; }}
                      />
                    </label>
                  )
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">ชื่อแบรนด์</Label>
                <Input
                  value={draft.brandName}
                  disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, brandName: e.target.value })}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">ข้อมูลติดต่อ (เบอร์โทร / LINE / เว็บไซต์)</Label>
                <Textarea
                  value={draft.contactInfo}
                  disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, contactInfo: e.target.value })}
                  className="min-h-[38px] text-sm"
                  placeholder={"เบอร์โทร\nLINE: @xxx\nwww.example.com"}
                />
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={draft.swapPeople}
                disabled={!canEdit}
                onChange={(e) => setDraft({ ...draft, swapPeople: e.target.checked })}
                className="size-4 rounded border-gray-300"
              />
              ถ้าในภาพอ้างอิงมีคน ให้สุ่ม/เปลี่ยนคนใหม่ทุกครั้ง
            </label>
          </div>

          {!canEdit && <p className="text-xs text-gray-400">ดูได้อย่างเดียว — เฉพาะ Admin เท่านั้นที่แก้ไขได้</p>}
        </section>
      </div>
    </div>
  );
}
