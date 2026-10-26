"use client";

// ข้อจำกัด (Restrictions) — คำต้องห้าม, กฎ, ข้อมูลสินค้าที่ละเอียดอ่อน, ไฟล์ข้อกำหนดขนาดใหญ่ (คำสั่งเจ้าของ 2026-10-26)
// layer นี้ไม่บังคับ: ไม่ตั้ง = เขียนบทความได้ตามเดิม, ตั้งแล้ว = ตัวเขียนทุกตัว + Validator ต้องถือตาม
// ไฟล์: เบราว์เซอร์อ่านเป็นข้อความก่อน (ไม่ส่งไฟล์ดิบ) ยาวเกินแถวเดียวแบ่งเป็นหลายส่วน — แถวไฟล์ไม่ผ่าน PUT
// (PUT เก็บ version ทั้งข้อความ และหน้านี้ได้แค่ตัวอย่างต้นไฟล์) แก้ประเภทไฟล์ = ลบแล้วอัปโหลดใหม่

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FileUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  RESTRICTION_FILE_MAX_CHARS,
  RESTRICTION_FILES_TOTAL_MAX_CHARS,
  bannedTermsFromTable,
  chunkText,
  emptyRestrictions,
  parseBannedTerms,
  parseRestrictionFileMeta,
  parseRestrictions,
  type ProductRule,
  type RestrictionFileKind,
  type RestrictionFileMeta,
  type RestrictionsData,
} from "@/lib/ce-restrictions";
import {
  BANNED_TERMS_ACCEPT,
  RESTRICTION_FILE_ACCEPT,
  extractRestrictionFileText,
  readBannedTermsTable,
} from "@/lib/restriction-file-client";
import { EmptyRow, ErrorBanner, SectionCard, useCERefresh } from "./shared";
import type { CEScope, PromptRow } from "./types";
import { CE_TYPES, scopeProjectId } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  canEdit: boolean;
}

interface FileApiRow {
  id: string;
  name: string;
  description: string | null;
  promptText: string;
  type: string;
  createdAt?: string;
}

interface FileGroup {
  key: string;
  name: string;
  kind: RestrictionFileKind;
  ids: string[];
  chars: number;
  size: number;
  pages?: number;
  preview: string;
}

const PART_SUFFIX_RE = / \(ส่วน \d+\/\d+\)$/;

const KIND_LABEL: Record<RestrictionFileKind, string> = {
  rules: "ข้อกำหนด/ข้อห้าม",
  reference: "ข้อมูลอ้างอิง",
};

function groupFiles(rows: FileApiRow[]): FileGroup[] {
  const groups = new Map<string, FileGroup & { firstPart: number }>();
  for (const r of rows) {
    const meta = parseRestrictionFileMeta(r.description);
    const key = meta.group ?? r.id;
    const part = meta.part ?? 1;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        key,
        name: r.name.replace(PART_SUFFIX_RE, ""),
        kind: meta.kind,
        ids: [r.id],
        chars: meta.chars || r.promptText.length,
        size: meta.size,
        pages: meta.pages,
        preview: r.promptText,
        firstPart: part,
      });
    } else {
      g.ids.push(r.id);
      g.chars += meta.chars || r.promptText.length;
      if (part < g.firstPart) {
        g.firstPart = part;
        g.preview = r.promptText;
      }
    }
  }
  return Array.from(groups.values()).map(({ firstPart: _firstPart, ...g }) => g);
}

function newGroupId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function formatBytes(n: number): string {
  if (!n) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export function RestrictionsTab({ items, scope, canEdit }: Props) {
  const refresh = useCERefresh();
  const projectId = scopeProjectId(scope);
  const row = useMemo(() => items.find((i) => i.isActive) ?? items[0] ?? null, [items]);

  const [data, setData] = useState<RestrictionsData>(() => (row ? parseRestrictions(row.promptText) : emptyRestrictions()));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [files, setFiles] = useState<FileGroup[] | null>(null);
  const [uploadKind, setUploadKind] = useState<RestrictionFileKind>("rules");
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const termsInputRef = useRef<HTMLInputElement>(null);

  // แถวหลักเปลี่ยน (บันทึกแล้ว refresh) — ทับร่างเฉพาะตอนที่ไม่ได้แก้ค้างไว้
  useEffect(() => {
    if (dirty) return;
    setData(row ? parseRestrictions(row.promptText) : emptyRestrictions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.version, row?.promptText]);

  const loadFiles = useCallback(async () => {
    try {
      const url = projectId ? `/api/prompts?projectId=${encodeURIComponent(projectId)}` : "/api/prompts?scope=studio";
      const rows = await api<FileApiRow[]>(url);
      setFiles(groupFiles((Array.isArray(rows) ? rows : []).filter((r) => r.type === CE_TYPES.RESTRICTION_FILE)));
    } catch (e) {
      setError(`โหลดรายการไฟล์ไม่สำเร็จ: ${(e as Error).message}`);
      setFiles([]);
    }
  }, [projectId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const usedChars = useMemo(() => (files ?? []).reduce((n, g) => n + g.chars, 0), [files]);
  const termCount = useMemo(() => parseBannedTerms(data.bannedTerms).length, [data.bannedTerms]);

  function update(patch: Partial<RestrictionsData>) {
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
  }

  function updateRule(id: string, patch: Partial<ProductRule>) {
    update({ productRules: data.productRules.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }

  function addRule() {
    update({
      productRules: [
        ...data.productRules,
        { id: newGroupId(), product: "", triggers: "", info: "", fileIds: [], enabled: true },
      ],
    });
  }

  /** บันทึกแถวหลัก (สร้างใหม่ถ้ายังไม่มี) — คืน true เมื่อสำเร็จ */
  async function saveMain(next: RestrictionsData, quiet = false): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: row?.name ?? "ข้อจำกัด",
        description: row?.description ?? "",
        type: CE_TYPES.RESTRICTIONS,
        promptText: JSON.stringify(next),
        projectId,
      };
      if (row) {
        await api(`/api/prompts/${row.id}`, { method: "PUT", body: JSON.stringify(payload) });
        if (next.status === "Active" && !row.isActive) {
          await api(`/api/prompts/${row.id}/activate`, { method: "POST", body: JSON.stringify({ action: "activate" }) });
        } else if (next.status === "Draft" && row.isActive) {
          await api(`/api/prompts/${row.id}/activate`, { method: "POST", body: JSON.stringify({ action: "deactivate" }) });
        }
      } else {
        const created = await api<{ id?: string; isActive?: boolean }>("/api/prompts", { method: "POST", body: JSON.stringify(payload) });
        if (created.id && next.status === "Active" && !created.isActive) {
          await api(`/api/prompts/${created.id}/activate`, { method: "POST", body: JSON.stringify({ action: "activate" }) });
        } else if (created.id && next.status === "Draft" && created.isActive) {
          await api(`/api/prompts/${created.id}/activate`, { method: "POST", body: JSON.stringify({ action: "deactivate" }) });
        }
      }
      setDirty(false);
      if (!quiet) toast.success("บันทึกข้อจำกัดแล้ว");
      refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function importTerms(file: File) {
    try {
      const lines = bannedTermsFromTable(await readBannedTermsTable(file));
      if (!lines.trim()) {
        toast.error("ไม่พบคำในไฟล์ — คอลัมน์แรก = คำต้องห้าม, คอลัมน์ที่ 2 = คำแทน (ถ้ามี)");
        return;
      }
      const before = parseBannedTerms(data.bannedTerms).length;
      const merged = [data.bannedTerms.trim(), lines].filter(Boolean).join("\n");
      update({ bannedTerms: merged });
      toast.success(`เพิ่ม ${(parseBannedTerms(merged).length - before).toLocaleString()} คำ — กดบันทึกเพื่อใช้งาน`);
    } catch (e) {
      toast.error(`อ่านไฟล์ไม่สำเร็จ: ${(e as Error).message}`);
    }
  }

  async function uploadFiles(list: File[]) {
    setError(null);
    let used = usedChars;
    let added = 0;
    // ยังไม่มีแถวหลัก = ตัวเขียนไม่โหลดไฟล์ (loadRestrictions อ่านจากแถวหลัก) — สร้างให้ก่อน
    if (!row && !(await saveMain(data, true))) return;
    for (const file of list) {
      try {
        setUploading(`กำลังอ่าน ${file.name}…`);
        const { text, pages } = await extractRestrictionFileText(file);
        if (!text) throw new Error("ไม่พบข้อความในไฟล์ (PDF ที่สแกนเป็นรูปอ่านไม่ได้ — ต้องเป็นไฟล์ที่เลือกข้อความได้)");
        if (used + text.length > RESTRICTION_FILES_TOTAL_MAX_CHARS) {
          throw new Error(
            `ข้อความ ${text.length.toLocaleString()} ตัวอักษร ทำให้ไฟล์รวมเกิน ${RESTRICTION_FILES_TOTAL_MAX_CHARS.toLocaleString()} — ลบไฟล์ที่ไม่ใช้ก่อน`,
          );
        }
        const parts = text.length > RESTRICTION_FILE_MAX_CHARS ? chunkText(text, RESTRICTION_FILE_MAX_CHARS) : [text];
        const group = parts.length > 1 ? newGroupId() : undefined;
        const createdIds: string[] = [];
        try {
          for (let i = 0; i < parts.length; i++) {
            setUploading(parts.length > 1 ? `กำลังบันทึก ${file.name} ส่วน ${i + 1}/${parts.length}…` : `กำลังบันทึก ${file.name}…`);
            const meta: RestrictionFileMeta = {
              kind: uploadKind,
              chars: parts[i].length,
              size: file.size,
              ...(pages ? { pages } : {}),
              ...(group ? { group, part: i + 1, parts: parts.length } : {}),
            };
            const created = await api<{ id?: string }>("/api/prompts", {
              method: "POST",
              body: JSON.stringify({
                name: group ? `${file.name} (ส่วน ${i + 1}/${parts.length})` : file.name,
                type: CE_TYPES.RESTRICTION_FILE,
                description: JSON.stringify(meta),
                promptText: parts[i],
                projectId,
              }),
            });
            if (created.id) createdIds.push(created.id);
          }
        } catch (e) {
          // ส่วนที่บันทึกไปแล้วของไฟล์นี้ลบทิ้ง ไม่ให้เหลือไฟล์ครึ่ง ๆ
          await Promise.all(createdIds.map((id) => fetch(`/api/prompts/${id}`, { method: "DELETE" }).catch(() => null)));
          throw e;
        }
        used += text.length;
        added++;
        toast.success(`${file.name}: ${text.length.toLocaleString()} ตัวอักษร${parts.length > 1 ? ` (${parts.length} ส่วน)` : ""}`);
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      }
    }
    setUploading(null);
    if (added) await loadFiles();
  }

  async function deleteGroup(g: FileGroup) {
    if (!confirm(`ลบไฟล์ "${g.name}"?`)) return;
    setDeleting(g.key);
    setError(null);
    try {
      for (const id of g.ids) await api(`/api/prompts/${id}`, { method: "DELETE" });
      const ids = new Set(g.ids);
      if (data.productRules.some((p) => p.fileIds.some((id) => ids.has(id)))) {
        const next = { ...data, productRules: data.productRules.map((p) => ({ ...p, fileIds: p.fileIds.filter((id) => !ids.has(id)) })) };
        setData(next);
        if (row) await saveMain(next, true);
      }
      toast.success(`ลบ ${g.name} แล้ว`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
      await loadFiles();
    }
  }

  function toggleRuleFile(rule: ProductRule, g: FileGroup, on: boolean) {
    const rest = rule.fileIds.filter((id) => !g.ids.includes(id));
    updateRule(rule.id, { fileIds: on ? [...rest, ...g.ids] : rest });
  }

  const disabled = !canEdit || saving;

  return (
    <div className="space-y-4">
      <SectionCard
        title="ข้อจำกัด (Restrictions)"
        description="คำ/ข้อความที่ห้ามใช้ กฎที่ต้องทำตาม และข้อมูลสินค้าที่ละเอียดอ่อน — ตัวเขียนบทความทุกตัวและ Validator ดึงไปใช้ทุกบทความของสโคปนี้ (ไม่บังคับตั้ง)"
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <Switch
                checked={data.status === "Active"}
                disabled={disabled}
                onCheckedChange={(v) => update({ status: v ? "Active" : "Draft" })}
              />
              {data.status === "Active" ? "ใช้งาน" : "ปิดไว้ (Draft)"}
            </label>
            <Button size="sm" className="gap-1.5" disabled={disabled || !dirty} onClick={() => void saveMain(data)}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              บันทึก
            </Button>
          </div>
        }
      >
        <ErrorBanner message={error} />
        {!row && (
          <p className="mt-2 text-xs text-gray-500">สโคปนี้ยังไม่มีข้อจำกัด — กรอกแล้วกดบันทึก หรืออัปโหลดไฟล์ได้เลย</p>
        )}
        {dirty && <p className="mt-2 text-xs text-amber-600">มีการแก้ไขที่ยังไม่บันทึก</p>}
      </SectionCard>

      <SectionCard
        title="คำ/ข้อความต้องห้าม"
        description='บรรทัดละคำ — ใส่คำแทนได้ด้วย "คำ => คำแทน" (เช่น หายขาด => บรรเทาอาการ). หลังเขียนเสร็จ ระบบแทนคำที่มีคำแทนให้อัตโนมัติ และให้ AI แก้ประโยคที่ยังมีคำต้องห้ามเหลือ'
        action={
          <>
            <input
              ref={termsInputRef}
              type="file"
              accept={BANNED_TERMS_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importTerms(f);
              }}
            />
            <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled} onClick={() => termsInputRef.current?.click()}>
              <FileUp className="size-3.5" /> นำเข้าจาก Excel/CSV
            </Button>
          </>
        }
      >
        <Textarea
          value={data.bannedTerms}
          disabled={disabled}
          onChange={(e) => update({ bannedTerms: e.target.value })}
          rows={8}
          className="font-mono text-xs"
          placeholder={"หายขาด => บรรเทาอาการ\nรักษาได้ 100%\nดีที่สุดในโลก"}
        />
        <p className="mt-1 text-[11px] text-gray-400">{termCount.toLocaleString()} คำ · ขึ้นต้นบรรทัดด้วย # = หมายเหตุ ไม่นับ</p>
      </SectionCard>

      <SectionCard title="กฎที่ต้องทำตามทุกบทความ" description="ข้อห้าม/ข้อบังคับที่เป็นประโยค เช่น ห้ามวินิจฉัยโรค, ห้ามเปรียบเทียบกับคู่แข่ง, ต้องแนะนำให้ปรึกษาแพทย์">
        <Textarea
          value={data.rules}
          disabled={disabled}
          onChange={(e) => update({ rules: e.target.value })}
          rows={6}
          placeholder={"- ห้ามอ้างว่ารักษาโรคได้\n- ทุกบทความเรื่องยา ต้องแนะนำให้ปรึกษาแพทย์หรือเภสัชกร"}
        />
      </SectionCard>

      <SectionCard
        title="ข้อมูลสินค้าที่ละเอียดอ่อน"
        description="ถ้า keyword/หัวข้อบทความเจอคำในช่อง คำที่บอกว่าพูดถึงสินค้านี้ ตัวเขียนต้องใช้ข้อมูลของสินค้านั้นเท่านั้น ห้ามแต่งสเปก/สรรพคุณ/ราคาเอง สินค้าที่บทความไม่ได้พูดถึง ส่งไปแค่ชื่อ"
        action={
          <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled} onClick={addRule}>
            <Plus className="size-3.5" /> เพิ่มสินค้า
          </Button>
        }
      >
        {data.productRules.length === 0 ? (
          <EmptyRow>ยังไม่มีสินค้า</EmptyRow>
        ) : (
          <div className="space-y-3">
            {data.productRules.map((p) => (
              <div key={p.id} className={cn("rounded-xl border p-3", p.enabled ? "border-gray-200" : "border-dashed border-gray-200 opacity-60")}>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">ชื่อสินค้า/บริการ</Label>
                    <Input value={p.product} disabled={disabled} onChange={(e) => updateRule(p.id, { product: e.target.value })} placeholder="เช่น Sentricon" />
                  </div>
                  <div>
                    <Label className="text-xs">คำที่บอกว่าพูดถึงสินค้านี้ (คั่นด้วย ,)</Label>
                    <Input
                      value={p.triggers}
                      disabled={disabled}
                      onChange={(e) => updateRule(p.id, { triggers: e.target.value })}
                      placeholder="เว้นว่าง = ใช้ชื่อสินค้า"
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <Label className="text-xs">ข้อมูลที่ต้องใช้เมื่อเขียนถึงสินค้านี้</Label>
                  <Textarea
                    value={p.info}
                    disabled={disabled}
                    onChange={(e) => updateRule(p.id, { info: e.target.value })}
                    rows={4}
                    placeholder="สเปก ข้อความที่อนุญาต คำเตือน ราคา ฯลฯ"
                  />
                </div>
                {files && files.length > 0 && (
                  <div className="mt-2">
                    <Label className="text-xs">ไฟล์ของสินค้านี้ (ส่งเฉพาะบทความที่พูดถึงสินค้านี้)</Label>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {files.map((g) => (
                        <label key={g.key} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={g.ids.every((id) => p.fileIds.includes(id))}
                            onChange={(e) => toggleRuleFile(p, g, e.target.checked)}
                          />
                          {g.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <Switch checked={p.enabled} disabled={disabled} onCheckedChange={(v) => updateRule(p.id, { enabled: v })} />
                    {p.enabled ? "ใช้งาน" : "ปิดไว้"}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-red-600 hover:text-red-700"
                    disabled={disabled}
                    onClick={() => update({ productRules: data.productRules.filter((x) => x.id !== p.id) })}
                  >
                    <Trash2 className="size-3.5" /> ลบ
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="ไฟล์ข้อกำหนด / ข้อมูลอ้างอิง"
        description="PDF, Word (.docx), Excel, CSV, TXT — ไฟล์ใหญ่ได้ เบราว์เซอร์อ่านเป็นข้อความก่อนส่ง (ไม่อัปโหลดไฟล์ดิบ) ตอนเขียน ระบบเลือกเฉพาะส่วนที่ตรงหัวข้อบทความไปใช้"
        action={
          <div className="flex items-center gap-2">
            <select
              value={uploadKind}
              disabled={disabled || !!uploading}
              onChange={(e) => setUploadKind(e.target.value as RestrictionFileKind)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs"
            >
              <option value="rules">{KIND_LABEL.rules}</option>
              <option value="reference">{KIND_LABEL.reference}</option>
            </select>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={RESTRICTION_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (list.length) void uploadFiles(list);
              }}
            />
            <Button size="sm" className="gap-1.5" disabled={disabled || !!uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />}
              อัปโหลดไฟล์
            </Button>
          </div>
        }
      >
        {uploading && <p className="mb-2 text-xs text-indigo-600">{uploading}</p>}
        {files === null ? (
          <p className="text-xs text-gray-400">กำลังโหลด…</p>
        ) : files.length === 0 ? (
          <EmptyRow>ยังไม่มีไฟล์</EmptyRow>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {files.map((g) => (
              <details key={g.key} className="group px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-700">{g.name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      g.kind === "rules" ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-700",
                    )}
                  >
                    {KIND_LABEL[g.kind]}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {g.chars.toLocaleString()} ตัวอักษร
                    {g.pages ? ` · ${g.pages} หน้า` : ""}
                    {g.size ? ` · ${formatBytes(g.size)}` : ""}
                    {g.ids.length > 1 ? ` · ${g.ids.length} ส่วน` : ""}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      title="ลบไฟล์"
                      disabled={deleting === g.key}
                      onClick={(e) => {
                        e.preventDefault();
                        void deleteGroup(g);
                      }}
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      {deleting === g.key ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    </button>
                  )}
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-[11px] text-gray-600">
                  {g.preview}
                  {g.chars > g.preview.length ? "\n…" : ""}
                </pre>
              </details>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          ใช้ไป {usedChars.toLocaleString()} / {RESTRICTION_FILES_TOTAL_MAX_CHARS.toLocaleString()} ตัวอักษร · {KIND_LABEL.rules} = ต้องทำตาม,{" "}
          {KIND_LABEL.reference} = ใช้เป็นข้อเท็จจริง · ไฟล์ที่ผูกกับสินค้า ส่งเฉพาะบทความของสินค้านั้น
        </p>
      </SectionCard>
    </div>
  );
}
