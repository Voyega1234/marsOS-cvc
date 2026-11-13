"use client";

// ส่วนที่แท็บข้อจำกัดและแท็บ Comment ใช้ร่วมกัน: รายการไฟล์ การอ่าน การอัปโหลด
// แถวไฟล์ไม่ผ่าน PUT เพราะ GET ส่งมาแค่ตัวอย่างต้นไฟล์ แก้ประเภทไฟล์ = ลบแล้วอัปโหลดใหม่

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  RESTRICTION_FILE_MAX_CHARS,
  RESTRICTION_FILES_TOTAL_MAX_CHARS,
  chunkText,
  parseRestrictionFileMeta,
  type RestrictionFileKind,
  type RestrictionFileMeta,
} from "@/lib/ce-restrictions";
import {
  IMAGE_PAGES_MAX,
  extractRestrictionFileText,
  isImageFile,
  readImageFileWithAI,
  readImagePagesWithAI,
} from "@/lib/restriction-file-client";
import { CE_FILES_CHANGED_EVENT } from "@/lib/ce-layer-status";
import { cn } from "@/lib/utils";
import { EmptyRow } from "./shared";
import { CE_TYPES } from "./types";

interface FileApiRow {
  id: string;
  name: string;
  description: string | null;
  promptText: string;
  type: string;
}

export interface FileGroup {
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

export const KIND_LABEL: Record<RestrictionFileKind, string> = {
  rules: "ข้อกำหนด/ข้อห้าม",
  reference: "ข้อมูลอ้างอิง",
  product: "ข้อมูลสินค้าที่ละเอียดอ่อน",
  research: "งานวิจัย",
  criticized: "ตัวอย่างที่ลูกค้าติ",
  comment: "Comment",
};

const KIND_BADGE: Record<RestrictionFileKind, string> = {
  rules: "bg-red-50 text-red-700",
  reference: "bg-sky-50 text-sky-700",
  product: "bg-violet-50 text-violet-700",
  research: "bg-emerald-50 text-emerald-700",
  criticized: "bg-orange-50 text-orange-700",
  comment: "bg-amber-50 text-amber-700",
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

export function newGroupId(): string {
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

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json().catch(() => ({}))) as T;
}

/** ไฟล์ทุกประเภทของ scope นี้ — เพดานตัวอักษรนับรวมทั้งหมด */
export function useRestrictionFiles(projectId: string | null, onError: (message: string) => void) {
  const [allFiles, setAllFiles] = useState<FileGroup[] | null>(null);
  const loadFiles = useCallback(async () => {
    try {
      const url = projectId ? `/api/prompts?projectId=${encodeURIComponent(projectId)}` : "/api/prompts?scope=studio";
      const rows = await api<FileApiRow[]>(url);
      const fileRows = (Array.isArray(rows) ? rows : []).filter((r) => r.type === CE_TYPES.RESTRICTION_FILE);
      setAllFiles(groupFiles(fileRows));
      window.dispatchEvent(new CustomEvent(CE_FILES_CHANGED_EVENT, { detail: fileRows }));
    } catch (e) {
      onError(`โหลดรายการไฟล์ไม่สำเร็จ: ${(e as Error).message}`);
      setAllFiles([]);
    }
  }, [projectId, onError]);
  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);
  return { allFiles, loadFiles };
}

interface ImageAsk {
  fileName: string;
  /** เลขหน้าที่เป็นรูป — ไฟล์รูปไม่มีเลขหน้า */
  pages: number[] | null;
  hasText: boolean;
  resolve: (ok: boolean) => void;
}

/** อ่านไฟล์ + ถามก่อนใช้ AI อ่านรูป + แบ่งส่วนบันทึก · ไฟล์ที่พังระหว่างบันทึกลบส่วนที่ค้างทิ้ง */
export function useRestrictionFileUpload(projectId: string | null, onError: (message: string) => void) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [ask, setAsk] = useState<ImageAsk | null>(null);

  function askImages(params: Omit<ImageAsk, "resolve">): Promise<boolean> {
    return new Promise((resolve) => setAsk({ ...params, resolve }));
  }

  function answer(ok: boolean) {
    ask?.resolve(ok);
    setAsk(null);
  }

  /** ข้อความของไฟล์ · null = ผู้ใช้เลือกไม่อ่านรูป และไฟล์นี้ไม่มีข้อความอื่น */
  async function readFileText(file: File): Promise<{ text: string; pages?: number } | null> {
    setUploading(`กำลังอ่าน ${file.name}…`);
    const extracted = await extractRestrictionFileText(file);
    if (isImageFile(file)) {
      if (!(await askImages({ fileName: file.name, pages: null, hasText: false }))) return null;
      setUploading(`AI กำลังอ่านรูป ${file.name}…`);
      return { text: await readImageFileWithAI(file, projectId) };
    }
    const imagePages = extracted.imagePages ?? [];
    if (!imagePages.length) return { text: extracted.text, pages: extracted.pages };
    const hasText = Boolean(extracted.text);
    if (!(await askImages({ fileName: file.name, pages: imagePages, hasText }))) {
      return hasText ? { text: extracted.text, pages: extracted.pages } : null;
    }
    const pagesToRead = imagePages.slice(0, IMAGE_PAGES_MAX);
    const { text, failedPages } = await readImagePagesWithAI({
      file,
      extracted,
      pagesToRead,
      projectId,
      onProgress: (done, total) => setUploading(`AI กำลังอ่านรูปใน ${file.name} ${done}/${total} หน้า…`),
    });
    if (failedPages.length) toast.warning(`${file.name}: อ่านรูปหน้า ${failedPages.join(", ")} ไม่สำเร็จ ข้อความส่วนอื่นเก็บครบ`);
    if (imagePages.length > pagesToRead.length) {
      toast.warning(`${file.name}: อ่านรูปเฉพาะ ${pagesToRead.length} หน้าแรก เหลือ ${imagePages.length - pagesToRead.length} หน้า`);
    }
    return { text, pages: extracted.pages };
  }

  /** คืนจำนวนไฟล์ที่บันทึกสำเร็จ */
  async function upload(list: File[], kind: RestrictionFileKind, usedChars: number): Promise<number> {
    let used = usedChars;
    let added = 0;
    for (const file of list) {
      try {
        const read = await readFileText(file);
        if (!read) continue;
        const { text, pages } = read;
        if (!text) throw new Error("ไม่พบข้อความในไฟล์");
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
              kind,
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
        onError(`${file.name}: ${(e as Error).message}`);
      }
    }
    setUploading(null);
    return added;
  }

  const pageCount = ask?.pages?.length ?? 1;
  const confirmDialog = (
    <Dialog open={!!ask} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ให้ AI อ่านรูปใน {ask?.fileName} ไหม</DialogTitle>
          <DialogDescription>
            {ask?.pages
              ? `พบเนื้อหาที่เป็นรูป ${pageCount} หน้า (หน้า ${ask.pages.slice(0, 20).join(", ")}${pageCount > 20 ? ", …" : ""}) ข้อความในรูปอ่านด้วยเบราว์เซอร์ไม่ได้`
              : "ไฟล์รูปอ่านด้วยเบราว์เซอร์ไม่ได้"}{" "}
            ระบบจะส่งรูปให้ AI ถอดข้อความ มีค่าใช้จ่ายต่อหน้า
            {pageCount > IMAGE_PAGES_MAX ? ` อ่านได้ครั้งละ ${IMAGE_PAGES_MAX} หน้าแรก` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            {ask?.hasText ? "ไม่อ่านรูป ใช้เฉพาะข้อความ" : "ยกเลิกไฟล์นี้"}
          </Button>
          <Button onClick={() => answer(true)}>ให้ AI อ่าน {Math.min(pageCount, IMAGE_PAGES_MAX).toLocaleString()} หน้า</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { uploading, setUploading, readFileText, upload, confirmDialog };
}

export function RestrictionFileList({
  files,
  canEdit,
  deleting,
  onDelete,
}: {
  files: FileGroup[] | null;
  canEdit: boolean;
  deleting: string | null;
  onDelete: (group: FileGroup) => void;
}) {
  if (files === null) return <p className="text-xs text-gray-400">กำลังโหลด…</p>;
  if (files.length === 0) return <EmptyRow>ยังไม่มีไฟล์</EmptyRow>;
  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
      {files.map((g) => (
        <details key={g.key} className="group px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 text-gray-400" />
            <span className="min-w-0 flex-1 truncate font-medium text-gray-700">{g.name}</span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", KIND_BADGE[g.kind])}>{KIND_LABEL[g.kind]}</span>
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
                  onDelete(g);
                }}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
              >
                {deleting === g.key ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </button>
            )}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-brand-mist p-2.5 text-[11px] text-gray-600">
            {g.preview}
            {g.chars > g.preview.length ? "\n…" : ""}
          </pre>
        </details>
      ))}
    </div>
  );
}
