"use client";

// Comment ลูกค้า — สิ่งที่ลูกค้าติหรือขอให้ปรับ เป็นข้อความหรือไฟล์ ตัวเขียนอ่านทุกบทความของสโคปนี้
// ไม่กรอกหรือปิดไว้ = prompt เท่าเดิม · ลำดับต่ำกว่าข้อจำกัดเสมอ

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_COMMENT_BUDGET, emptyClientComments, parseClientComments, type ClientCommentsData } from "@/lib/ce-client-comments";
import { RESTRICTION_FILE_ACCEPT } from "@/lib/restriction-file-client";
import { cn } from "@/lib/utils";
import { RestrictionFileList, api, newGroupId, useRestrictionFileUpload, useRestrictionFiles, type FileGroup } from "./restriction-files";
import { EmptyRow, ErrorBanner, SectionCard, useCERefresh } from "./shared";
import type { CEScope, PromptRow } from "./types";
import { CE_TYPES, scopeProjectId } from "./types";

interface Props {
  items: PromptRow[];
  scope: CEScope;
  canEdit: boolean;
}

export function ClientCommentsTab({ items, scope, canEdit }: Props) {
  const refresh = useCERefresh();
  const projectId = scopeProjectId(scope);
  const row = useMemo(() => items.find((i) => i.isActive) ?? items[0] ?? null, [items]);

  const [data, setData] = useState<ClientCommentsData>(() => (row ? parseClientComments(row.promptText) : emptyClientComments()));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { allFiles, loadFiles } = useRestrictionFiles(projectId, setError);
  const { uploading, upload, confirmDialog } = useRestrictionFileUpload(projectId, setError);
  const files = useMemo(() => allFiles?.filter((g) => g.kind === "comment") ?? null, [allFiles]);
  const usedChars = useMemo(() => (allFiles ?? []).reduce((n, g) => n + g.chars, 0), [allFiles]);

  // แถวเปลี่ยน (บันทึกแล้ว refresh) — ทับร่างเฉพาะตอนที่ไม่ได้แก้ค้างไว้
  useEffect(() => {
    if (dirty) return;
    setData(row ? parseClientComments(row.promptText) : emptyClientComments());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.version, row?.promptText]);

  function update(patch: Partial<ClientCommentsData>) {
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
  }

  function updateComment(id: string, text: string) {
    update({ comments: data.comments.map((c) => (c.id === id ? { ...c, text } : c)) });
  }

  function addComment() {
    update({ comments: [...data.comments, { id: newGroupId(), text: "", date: new Date().toISOString().slice(0, 10), enabled: true }] });
  }

  async function save(next: ClientCommentsData, quiet = false): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: row?.name ?? "Comment ลูกค้า",
        description: row?.description ?? "",
        type: CE_TYPES.CLIENT_COMMENTS,
        promptText: JSON.stringify(next),
        projectId,
      };
      let id: string | undefined = row?.id;
      let isActive = row?.isActive ?? false;
      if (row) {
        await api(`/api/prompts/${row.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        const created = await api<{ id?: string; isActive?: boolean }>("/api/prompts", { method: "POST", body: JSON.stringify(payload) });
        id = created.id;
        isActive = created.isActive ?? false;
      }
      if (id && next.status === "Active" && !isActive) {
        await api(`/api/prompts/${id}/activate`, { method: "POST", body: JSON.stringify({ action: "activate" }) });
      } else if (id && next.status === "Draft" && isActive) {
        await api(`/api/prompts/${id}/activate`, { method: "POST", body: JSON.stringify({ action: "deactivate" }) });
      }
      setDirty(false);
      if (!quiet) toast.success("บันทึก Comment แล้ว");
      refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(list: File[]) {
    setError(null);
    // ยังไม่มีแถวหลัก = ตัวเขียนไม่โหลดไฟล์ Comment — สร้างให้ก่อน
    if (!row && !(await save(data, true))) return;
    if (await upload(list, "comment", usedChars)) await loadFiles();
  }

  async function deleteGroup(g: FileGroup) {
    if (!confirm(`ลบไฟล์ "${g.name}"?`)) return;
    setDeleting(g.key);
    setError(null);
    try {
      for (const id of g.ids) await api(`/api/prompts/${id}`, { method: "DELETE" });
      toast.success(`ลบ ${g.name} แล้ว`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
      await loadFiles();
    }
  }

  const disabled = !canEdit || saving;
  const textChars = data.comments.filter((c) => c.enabled).reduce((n, c) => n + c.text.length, 0);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Comment ลูกค้า"
        description="สิ่งที่ลูกค้าติหรือขอให้ปรับ ตัวเขียนบทความอ่านทุกบทความของสโคปนี้ ถ้าขัดกับข้อจำกัด ระบบยึดข้อจำกัดก่อน (ไม่บังคับตั้ง)"
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <Switch checked={data.status === "Active"} disabled={disabled} onCheckedChange={(v) => update({ status: v ? "Active" : "Draft" })} />
              {data.status === "Active" ? "ใช้งาน" : "ปิดไว้ (Draft)"}
            </label>
            <Button size="sm" className="gap-1.5" disabled={disabled || !dirty} onClick={() => void save(data)}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              บันทึก
            </Button>
          </div>
        }
      >
        <ErrorBanner message={error} />
        {dirty && <p className="mt-2 text-xs text-amber-600">มีการแก้ไขที่ยังไม่บันทึก</p>}
      </SectionCard>

      <SectionCard
        title="ข้อความ Comment"
        description={`Comment ล่าสุดสำคัญกว่า ส่งเข้าตัวเขียนได้ไม่เกิน ${CLIENT_COMMENT_BUDGET.text.toLocaleString()} ตัวอักษร`}
        action={
          <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled} onClick={addComment}>
            <Plus className="size-3.5" /> เพิ่ม Comment
          </Button>
        }
      >
        {data.comments.length === 0 ? (
          <EmptyRow>ยังไม่มี Comment</EmptyRow>
        ) : (
          <div className="space-y-3">
            {data.comments.map((c) => (
              <div key={c.id} className={cn("rounded-xl border p-3", c.enabled ? "border-gray-200" : "border-dashed border-gray-200 opacity-60")}>
                <Textarea value={c.text} disabled={disabled} onChange={(e) => updateComment(c.id, e.target.value)} rows={4} placeholder="สิ่งที่ลูกค้าติหรือขอให้ปรับ" />
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <Switch
                      checked={c.enabled}
                      disabled={disabled}
                      onCheckedChange={(v) => update({ comments: data.comments.map((x) => (x.id === c.id ? { ...x, enabled: v } : x)) })}
                    />
                    {c.enabled ? "ใช้งาน" : "ปิดไว้"}
                    {c.date && <span className="text-gray-400">{c.date}</span>}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-red-600 hover:text-red-700"
                    disabled={disabled}
                    onClick={() => update({ comments: data.comments.filter((x) => x.id !== c.id) })}
                  >
                    <Trash2 className="size-3.5" /> ลบ
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className={cn("mt-2 text-[11px]", textChars > CLIENT_COMMENT_BUDGET.text ? "text-amber-600" : "text-gray-400")}>
          {textChars.toLocaleString()} / {CLIENT_COMMENT_BUDGET.text.toLocaleString()} ตัวอักษร
          {textChars > CLIENT_COMMENT_BUDGET.text ? " — เกินงบ Comment เก่าสุดจะไม่ถูกส่ง" : ""}
        </p>
      </SectionCard>

      <SectionCard
        title="ไฟล์ Comment"
        description={`อัปโหลดไฟล์ที่ลูกค้าส่งมาได้ทุกประเภท ไฟล์สั้นส่งครบ ไฟล์ยาวเลือกส่วนที่ตรงหัวข้อบทความ ไฟล์รวมส่งเข้าตัวเขียนได้ไม่เกิน ${CLIENT_COMMENT_BUDGET.files.toLocaleString()} ตัวอักษร`}
        action={
          <>
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
          </>
        }
      >
        {uploading && <p className="mb-2 text-xs text-indigo-600">{uploading}</p>}
        <RestrictionFileList files={files} canEdit={canEdit} deleting={deleting} onDelete={(g) => void deleteGroup(g)} />
      </SectionCard>
      {confirmDialog}
    </div>
  );
}
