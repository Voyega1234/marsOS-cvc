"use client";

// ข้อจำกัด (Restrictions) — คำต้องห้าม, กฎ, ข้อมูลสินค้าที่ละเอียดอ่อน, ไฟล์ข้อกำหนดขนาดใหญ่ (คำสั่งเจ้าของ 2026-10-26)
// layer นี้ไม่บังคับ: ไม่ตั้ง = เขียนบทความได้ตามเดิม, ตั้งแล้ว = ตัวเขียนทุกตัว + Validator ต้องถือตาม
// ไฟล์: เบราว์เซอร์อ่านเป็นข้อความก่อน (ไม่ส่งไฟล์ดิบ) ยาวเกินแถวเดียวแบ่งเป็นหลายส่วน — แถวไฟล์ไม่ผ่าน PUT
// (PUT เก็บ version ทั้งข้อความ และหน้านี้ได้แค่ตัวอย่างต้นไฟล์) แก้ประเภทไฟล์ = ลบแล้วอัปโหลดใหม่

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  RESTRICTION_FILES_TOTAL_MAX_CHARS,
  bannedTermsFromTable,
  emptyRestrictions,
  parseBannedTerms,
  parseRestrictions,
  type ProductRule,
  type ResearchRef,
  type RestrictionFileKind,
  type RestrictionsData,
} from "@/lib/ce-restrictions";
import { RESTRICTION_FILE_ACCEPT, readTermImport } from "@/lib/restriction-file-client";
import { linesToCandidates, type TermCandidate } from "@/lib/restriction-table";
import {
  KIND_LABEL,
  RestrictionFileList,
  api,
  newGroupId,
  useRestrictionFileUpload,
  useRestrictionFiles,
  type FileGroup,
} from "./restriction-files";
import { EmptyRow, ErrorBanner, SectionCard, useCERefresh } from "./shared";
import { TermImportDialog } from "./TermImportDialog";
import type { CEScope, PromptRow } from "./types";
import { CE_TYPES, scopeProjectId } from "./types";

/** ชนิดไฟล์ที่เลือกอัปโหลดในหน้านี้ — Comment อยู่แท็บของตัวเอง */
const UPLOAD_KINDS: RestrictionFileKind[] = ["rules", "reference", "product", "research", "criticized"];

/** ชุดใหม่เปิดเข้มงวดไว้ก่อน แถวที่มีอยู่แล้วใช้ค่าที่บันทึก ไม่เปลี่ยนเอง */
function initialData(promptText: string | null): RestrictionsData {
  return promptText !== null ? parseRestrictions(promptText) : { ...emptyRestrictions(), strictMode: true };
}

interface Props {
  items: PromptRow[];
  scope: CEScope;
  canEdit: boolean;
}

export function RestrictionsTab({ items, scope, canEdit }: Props) {
  const refresh = useCERefresh();
  const projectId = scopeProjectId(scope);
  const row = useMemo(() => items.find((i) => i.isActive) ?? items[0] ?? null, [items]);

  const [data, setData] = useState<RestrictionsData>(() => initialData(row ? row.promptText : null));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { allFiles, loadFiles } = useRestrictionFiles(projectId, setError);
  const files = useMemo(() => allFiles?.filter((g) => g.kind !== "comment") ?? null, [allFiles]);
  const [uploadKind, setUploadKind] = useState<RestrictionFileKind>("rules");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [termImport, setTermImport] = useState<{ fileName: string; candidates: TermCandidate[]; usedTerms: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const termsInputRef = useRef<HTMLInputElement>(null);

  // แถวหลักเปลี่ยน (บันทึกแล้ว refresh) — ทับร่างเฉพาะตอนที่ไม่ได้แก้ค้างไว้
  useEffect(() => {
    if (dirty) return;
    setData(initialData(row ? row.promptText : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.version, row?.promptText]);

  const usedChars = useMemo(() => (allFiles ?? []).reduce((n, g) => n + g.chars, 0), [allFiles]);
  const { uploading, setUploading, readFileText, upload, confirmDialog } = useRestrictionFileUpload(projectId, setError);
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

  function updateResearch(id: string, patch: Partial<ResearchRef>) {
    update({ research: data.research.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }

  function addResearch() {
    update({
      research: [...data.research, { id: newGroupId(), title: "", year: "", source: "", sample: "", finding: "", url: "", enabled: true }],
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

  /** ข้อมูลสินค้าที่กรอกไว้ในหน้านี้ — คำที่อยู่ในนี้ไม่ควรถูกห้ามโดยไม่รู้ตัว */
  function termsUsedInProductRules(terms: string[]): string[] {
    const haystack = data.productRules
      .map((p) => `${p.product} ${p.triggers} ${p.info}`)
      .join(" ")
      .toLowerCase()
      .replace(/\s+/g, "");
    return terms.filter((t) => haystack.includes(t.toLowerCase().replace(/\s+/g, "")));
  }

  async function openTermPreview(fileName: string, candidates: TermCandidate[]) {
    const terms = Array.from(new Set(candidates.filter((c) => c.kind === "banned").map((c) => c.term)));
    let usedInFiles: string[] = [];
    try {
      const res = await api<{ usedTerms?: string[] }>("/api/prompts/term-usage", {
        method: "POST",
        body: JSON.stringify({ projectId, terms: terms.slice(0, 3000) }),
      });
      usedInFiles = res.usedTerms ?? [];
    } catch (e) {
      toast.warning(`ตรวจคำกับไฟล์ข้อมูลสินค้าไม่สำเร็จ: ${(e as Error).message}`);
    }
    setTermImport({ fileName, candidates, usedTerms: [...usedInFiles, ...termsUsedInProductRules(terms)] });
  }

  async function importTerms(file: File) {
    setImporting(true);
    try {
      const result = await readTermImport(file);
      if (result.kind === "legacy") {
        // ตาราง 1-2 คอลัมน์: คอลัมน์แรก = คำ คอลัมน์ที่ 2 = คำแทน ทำงานเหมือนเดิม
        const lines = bannedTermsFromTable(result.text);
        if (!lines.trim()) {
          toast.error("ไม่พบคำในไฟล์ — คอลัมน์แรก = คำต้องห้าม, คอลัมน์ที่ 2 = คำแทน (ถ้ามี)");
          return;
        }
        const before = parseBannedTerms(data.bannedTerms).length;
        const merged = [data.bannedTerms.trim(), lines].filter(Boolean).join("\n");
        update({ bannedTerms: merged });
        toast.success(`เพิ่ม ${(parseBannedTerms(merged).length - before).toLocaleString()} คำ — กดบันทึกเพื่อใช้งาน`);
        return;
      }
      let candidates: TermCandidate[];
      if (result.kind === "candidates") {
        candidates = result.candidates;
      } else {
        const read = await readFileText(file);
        if (!read) return;
        candidates = linesToCandidates(read.text);
      }
      if (!candidates.length) {
        toast.error("ไม่พบคำในไฟล์");
        return;
      }
      await openTermPreview(file.name, candidates);
    } catch (e) {
      toast.error(`อ่านไฟล์ไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setUploading(null);
      setImporting(false);
    }
  }

  async function uploadFiles(list: File[]) {
    setError(null);
    // ยังไม่มีแถวหลัก = ตัวเขียนไม่โหลดไฟล์ (loadRestrictions อ่านจากแถวหลัก) — สร้างให้ก่อน
    if (!row && !(await saveMain(data, true))) return;
    if (await upload(list, uploadKind, usedChars)) await loadFiles();
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
  // ตัวอย่างที่ลูกค้าติไม่ใช่ข้อมูลของสินค้า
  const linkableFiles = (files ?? []).filter((g) => g.kind !== "criticized");

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
        <label className="mt-3 flex items-start gap-2 text-xs text-gray-600">
          <Switch checked={data.strictMode} disabled={disabled} onCheckedChange={(v) => update({ strictMode: v })} />
          <span>
            <span className="font-medium text-gray-700">เข้มงวดพิเศษ</span> — จับคำต้องห้ามที่เลี่ยงด้วยการเว้นวรรคหรือแทรกอักษรล่องหน, ตรวจข้อความ alt ของรูป และแก้ซ้ำ 2 รอบ
          </span>
        </label>
      </SectionCard>

      <SectionCard
        title="คำ/ข้อความต้องห้าม"
        description='บรรทัดละคำ — ใส่คำแทนได้ด้วย "คำ => คำแทน" (เช่น หายขาด => บรรเทาอาการ). หลังเขียนเสร็จ ระบบแทนคำที่มีคำแทนให้อัตโนมัติ และให้ AI แก้ประโยคที่ยังมีคำต้องห้ามเหลือ'
        action={
          <>
            <input
              ref={termsInputRef}
              type="file"
              accept={RESTRICTION_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importTerms(f);
              }}
            />
            <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled || importing} onClick={() => termsInputRef.current?.click()}>
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />} นำเข้าจากไฟล์
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

      <SectionCard
        title="คำ/ข้อความที่ใช้ได้"
        description="ถ้อยคำที่ฝ่ายกฎหมายของลูกค้าเห็นชอบ บรรทัดละข้อความ — ตัวเขียนใช้คำเหล่านี้แทนการเลี่ยงไปใช้คำกำกวม คำที่อยู่ในรายการต้องห้ามด้วยจะถือว่าห้าม"
      >
        <Textarea
          value={data.approvedTerms}
          disabled={disabled}
          onChange={(e) => update({ approvedTerms: e.target.value })}
          rows={5}
          className="font-mono text-xs"
          placeholder={"ฟื้นฟูความสมดุลฮอร์โมนในร่างกาย\nดูแลโดยแพทย์"}
        />
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
        title="งานวิจัยที่ใช้อ้างอิงได้"
        description="ตัวเขียนอ้างได้เฉพาะงานวิจัยในรายการนี้และในไฟล์ประเภทงานวิจัย ต้องมีชื่อและผลที่พบจึงจะถูกใช้ — ห้าม AI หางานวิจัยมาเติมเอง"
        action={
          <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled} onClick={addResearch}>
            <Plus className="size-3.5" /> เพิ่มงานวิจัย
          </Button>
        }
      >
        {data.research.length === 0 ? (
          <EmptyRow>ยังไม่มีงานวิจัย</EmptyRow>
        ) : (
          <div className="space-y-3">
            {data.research.map((r) => (
              <div key={r.id} className={cn("rounded-xl border p-3", r.enabled ? "border-gray-200" : "border-dashed border-gray-200 opacity-60")}>
                <div className="grid gap-2 md:grid-cols-[1fr_6rem]">
                  <div>
                    <Label className="text-xs">ชื่องานวิจัย</Label>
                    <Input value={r.title} disabled={disabled} onChange={(e) => updateResearch(r.id, { title: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">ปี</Label>
                    <Input value={r.year} disabled={disabled} onChange={(e) => updateResearch(r.id, { year: e.target.value })} />
                  </div>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">ผู้วิจัย / วารสาร / ประเทศ</Label>
                    <Input value={r.source} disabled={disabled} onChange={(e) => updateResearch(r.id, { source: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">กลุ่มตัวอย่าง</Label>
                    <Input value={r.sample} disabled={disabled} onChange={(e) => updateResearch(r.id, { sample: e.target.value })} />
                  </div>
                </div>
                <div className="mt-2">
                  <Label className="text-xs">ผลที่พบจริง</Label>
                  <Textarea value={r.finding} disabled={disabled} onChange={(e) => updateResearch(r.id, { finding: e.target.value })} rows={3} />
                </div>
                <div className="mt-2">
                  <Label className="text-xs">ลิงก์ (ถ้ามี)</Label>
                  <Input value={r.url} disabled={disabled} onChange={(e) => updateResearch(r.id, { url: e.target.value })} />
                </div>
                {!(r.title.trim() && r.finding.trim()) && (
                  <p className="mt-2 text-[11px] text-amber-600">ยังขาดชื่อหรือผลที่พบ ตัวเขียนจะไม่ใช้รายการนี้</p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <Switch checked={r.enabled} disabled={disabled} onCheckedChange={(v) => updateResearch(r.id, { enabled: v })} />
                    {r.enabled ? "ใช้งาน" : "ปิดไว้"}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-red-600 hover:text-red-700"
                    disabled={disabled}
                    onClick={() => update({ research: data.research.filter((x) => x.id !== r.id) })}
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
        title="ข้อมูลสินค้าที่ละเอียดอ่อน"
        description="ถ้า keyword/หัวข้อบทความเจอคำในช่อง คำที่บอกว่าพูดถึงสินค้านี้ หรือ AI ตัดสินว่าเรื่องเกี่ยวกันแม้ใช้คนละคำ ตัวเขียนจะใช้ข้อมูลนี้เป็นแหล่งหลักและอ้างอิงได้ เขียนเสริมได้แต่ห้ามขัดแย้ง ห้ามแต่งสเปก/สรรพคุณ/ราคาเอง สินค้าที่ไม่เกี่ยว ส่งไปแค่ชื่อ"
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
                {linkableFiles.length > 0 && (
                  <div className="mt-2">
                    <Label className="text-xs">ไฟล์ของสินค้านี้ (ส่งเฉพาะบทความที่เกี่ยวกับสินค้านี้)</Label>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {linkableFiles.map((g) => (
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
        title="ตัวอย่างบทความที่ลูกค้าติ"
        description="วางข้อความที่ลูกค้าไม่ชอบ ตัวเขียนใช้เป็นตัวอย่างสิ่งที่ห้ามทำ ไม่ใช่แหล่งข้อมูล บทความยาวอัปโหลดเป็นไฟล์ประเภทตัวอย่างที่ลูกค้าติด้านล่างได้"
      >
        <Textarea
          value={data.criticizedSamples}
          disabled={disabled}
          onChange={(e) => update({ criticizedSamples: e.target.value })}
          rows={5}
          placeholder="ข้อความหรือบทความที่ลูกค้าติ"
        />
      </SectionCard>

      <SectionCard
        title="ไฟล์ข้อกำหนด / ข้อมูลอ้างอิง"
        description="PDF, Word, PowerPoint, Excel, CSV, TXT, HTML, RTF และรูปภาพ — ไฟล์ใหญ่ได้ เบราว์เซอร์อ่านเป็นข้อความก่อนส่ง (ไม่อัปโหลดไฟล์ดิบ) ตอนเขียน ระบบเลือกเฉพาะส่วนที่ตรงหัวข้อบทความไปใช้"
        action={
          <div className="flex items-center gap-2">
            <select
              value={uploadKind}
              disabled={disabled || !!uploading}
              onChange={(e) => setUploadKind(e.target.value as RestrictionFileKind)}
              className="h-8 rounded-xl border border-gray-200 bg-white px-2.5 text-xs"
            >
              {UPLOAD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
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
        {uploading && <p className="mb-2 text-xs text-brand-blue">{uploading}</p>}
        <RestrictionFileList files={files} canEdit={canEdit} deleting={deleting} onDelete={(g) => void deleteGroup(g)} />
        <p className="mt-2 text-[11px] text-gray-400">
          ใช้ไป {usedChars.toLocaleString()} / {RESTRICTION_FILES_TOTAL_MAX_CHARS.toLocaleString()} ตัวอักษร (รวมไฟล์ Comment) · {KIND_LABEL.rules} = ต้องทำตาม,{" "}
          {KIND_LABEL.reference} = ใช้เป็นข้อเท็จจริง, {KIND_LABEL.product} = ข้อมูลหลักเมื่อเขียนถึงสินค้า, {KIND_LABEL.research} = อ้างอิงได้,{" "}
          {KIND_LABEL.criticized} = สิ่งที่ห้ามทำ · ไฟล์ที่ผูกกับสินค้า ส่งเฉพาะบทความของสินค้านั้น
        </p>
      </SectionCard>

      {confirmDialog}
      {termImport && (
        <TermImportDialog
          fileName={termImport.fileName}
          candidates={termImport.candidates}
          usedTerms={termImport.usedTerms}
          existingBanned={data.bannedTerms}
          existingApproved={data.approvedTerms}
          defaultKeywords={data.productRules
            .flatMap((p) => [p.product, p.triggers])
            .filter((t) => t.trim())
            .join(", ")}
          onClose={() => setTermImport(null)}
          onApply={(patch) => {
            update(patch);
            setTermImport(null);
            toast.success("เพิ่มรายการแล้ว — กดบันทึกเพื่อใช้งาน");
          }}
        />
      )}
    </div>
  );
}
