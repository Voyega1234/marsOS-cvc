"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ds";
import {
  ACCEPT_ATTR, ALLOWED_LABEL, MAX_FILE_BYTES, formatBytes, sanitizeFileName, type AttachmentRow,
} from "@/lib/backlink-management/attachments";
import { api, fmtDate } from "./shared";

interface ListResponse {
  available: boolean;
  attachments: AttachmentRow[];
  asanaTaskGid: string | null;
  limits: { maxBytes: number; maxFiles: number };
}

const baseUrl = (requestId: string) => `/api/backlink-management/requests/${requestId}/attachments`;

/** อัปโหลดไฟล์เดียวเข้าคำขอ (multipart field `file`) */
export async function uploadAttachment(requestId: string, file: File): Promise<{ attachment: AttachmentRow; warning?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return api<{ attachment: AttachmentRow; warning?: string }>(baseUrl(requestId), { method: "POST", body: fd });
}

/** ตรวจไฟล์ฝั่งเบราว์เซอร์ก่อนส่ง (เซิร์ฟเวอร์ตรวจซ้ำอีกครั้ง) — คืนข้อความไทยเมื่อไม่ผ่าน */
export function checkAttachmentFile(file: File): string | null {
  if (!sanitizeFileName(file.name)) return `ไม่รองรับไฟล์ชนิดนี้ — แนบได้เฉพาะ ${ALLOWED_LABEL}`;
  if (file.size === 0) return "ไฟล์ว่างเปล่า";
  if (file.size > MAX_FILE_BYTES) return `ไฟล์ใหญ่เกิน ${formatBytes(MAX_FILE_BYTES)} (ไฟล์นี้ ${formatBytes(file.size)})`;
  return null;
}

export function RequestAttachments({ requestId, onChanged }: { requestId: string; onChanged?: () => void }) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState("");
  const [syncing, setSyncing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const requestIdRef = useRef(requestId);
  requestIdRef.current = requestId;
  const autoSyncedFor = useRef<string | null>(null);

  const runSync = useCallback(async (silentSuccess: boolean) => {
    const rid = requestId;
    setSyncing(true);
    try {
      const r = await api<{ attachments: AttachmentRow[]; pushed: number; failed: number; reason?: "no_task" | "no_token" }>(`${baseUrl(rid)}/sync`, { method: "POST" });
      if (requestIdRef.current !== rid) return;
      setData((p) => (p ? { ...p, attachments: r.attachments } : p));
      if (r.pushed > 0 && !silentSuccess) toast.success(`ส่งไป Asana แล้ว ${r.pushed} ไฟล์`);
      if (r.failed > 0) toast.error(`ส่งไป Asana ไม่สำเร็จ ${r.failed} ไฟล์`);
      // กดปุ่มเองแล้วไม่ได้ส่งอะไรเลย ต้องบอกเหตุ (ตอนเปิดหน้าเองไม่เด้งเตือน)
      if (!silentSuccess && r.reason === "no_token") toast.error("ยังส่งไป Asana ไม่ได้ — ยังไม่ได้ตั้ง Asana token ของระบบ");
      if (!silentSuccess && r.reason === "no_task") toast.error("คำขอนี้ยังไม่มีงานใน Asana");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ส่งไป Asana ไม่สำเร็จ");
    } finally {
      setSyncing(false);
    }
  }, [requestId]);

  const reload = useCallback(async (): Promise<ListResponse | null> => {
    const mine = ++seq.current;
    try {
      const d = await api<ListResponse>(baseUrl(requestId));
      if (mine !== seq.current) return null;
      setData(d);
      setLoadError("");
      return d;
    } catch (e) {
      if (mine !== seq.current) return null;
      setLoadError(e instanceof Error ? e.message : "โหลดไฟล์แนบไม่สำเร็จ");
      return null;
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setLoadError("");
    void reload().then((d) => {
      if (!d || !d.available || autoSyncedFor.current === requestId) return;
      autoSyncedFor.current = requestId;
      if (d.asanaTaskGid && d.attachments.some((a) => a.asana === "pending")) void runSync(true);
    });
    return () => { seq.current++; };
  }, [requestId, reload, runSync]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const picked = Array.from(input.files ?? []);
    if (!data || picked.length === 0) { input.value = ""; return; }
    const rid = requestId;
    const room = Math.max(0, data.limits.maxFiles - data.attachments.length);
    const usable = picked.slice(0, room);
    if (picked.length > usable.length) toast.warning(`แนบได้สูงสุด ${data.limits.maxFiles} ไฟล์ — ข้าม ${picked.length - usable.length} ไฟล์`);
    let done = 0;
    let ok = 0;
    try {
      for (const file of usable) {
        done++;
        const bad = checkAttachmentFile(file);
        if (bad) { toast.error(`${file.name}: ${bad}`); continue; }
        setUploading(`กำลังอัปโหลด ${done}/${usable.length}…`);
        try {
          const r = await uploadAttachment(rid, file);
          ok++;
          if (r.warning) toast.warning(r.warning);
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ"}`);
        }
      }
    } finally {
      setUploading("");
      input.value = "";
    }
    if (requestIdRef.current === rid) await reload();
    if (ok > 0) onChanged?.();
  }

  async function remove(a: AttachmentRow) {
    if (!confirm(`ลบไฟล์แนบ "${a.fileName}"?`)) return;
    try {
      const r = await api<{ ok: boolean; warning?: string }>(`${baseUrl(requestId)}/${a.id}`, { method: "DELETE" });
      if (r?.warning) toast.warning(r.warning);
      await reload();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  if (loading && !data) return <div className="text-xs text-gray-400">กำลังโหลด…</div>;
  if (loadError && !data) return <div className="text-xs text-gray-400">{loadError}</div>;
  if (!data) return null;
  if (!data.available) return <div className="text-xs text-gray-400">ยังไม่เปิดใช้ไฟล์แนบ (ต้องสร้างตารางในฐานข้อมูลก่อน)</div>;

  const { attachments, limits, asanaTaskGid } = data;
  const full = attachments.length >= limits.maxFiles;
  const needsResend = !!asanaTaskGid && attachments.some((a) => a.asana === "pending" || a.asana === "error");

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-brand-navy">ไฟล์แนบ ({attachments.length}/{limits.maxFiles})</h3>
        <Button type="button" size="sm" variant="outline" disabled={!!uploading || full} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}
          แนบไฟล์
        </Button>
        <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" aria-label="เลือกไฟล์แนบ" onChange={onPick} />
      </div>
      <p className="text-xs text-gray-400">{ALLOWED_LABEL} ไม่เกิน {formatBytes(limits.maxBytes)} ต่อไฟล์</p>
      {asanaTaskGid ? <p className="text-xs text-gray-400">ไฟล์ที่แนบจะถูกส่งไปที่งานใน Asana ของคำขอนี้โดยอัตโนมัติ</p> : null}
      {uploading ? <p className="mt-1 text-xs text-gray-500">{uploading}</p> : null}

      {attachments.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">ยังไม่มีไฟล์แนบ</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {attachments.map((a) => {
            const url = `${baseUrl(requestId)}/${a.id}`;
            return (
              <li key={a.id} className="flex items-center gap-2.5 rounded-xl border border-gray-200 p-2">
                {a.isImage ? (
                  <a href={url} download={a.fileName} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={a.fileName} loading="lazy" className="h-10 w-10 rounded-lg border border-gray-200 object-cover" />
                  </a>
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-mist/40 text-gray-500">
                    <FileText className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a href={url} download={a.fileName} title={a.fileName} className="block truncate text-sm text-brand-blue underline">{a.fileName}</a>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-400">
                    <span>{formatBytes(a.sizeBytes)} · {a.uploadedByName || "—"} · {fmtDate(a.createdAt)}</span>
                    {a.asana === "sent" ? <Chip tone="ok">ส่ง Asana แล้ว</Chip> : null}
                    {a.asana === "pending" ? <Chip tone="muted">รอส่ง Asana</Chip> : null}
                    {a.asana === "error" ? <Chip tone="warn" title={a.asanaError}>ส่ง Asana ไม่สำเร็จ</Chip> : null}
                  </div>
                  {a.asana === "error" && a.asanaError ? <div className="text-xs text-gray-400">{a.asanaError}</div> : null}
                </div>
                {a.canDelete ? (
                  <button type="button" aria-label="ลบไฟล์แนบ" title="ลบไฟล์แนบ" onClick={() => void remove(a)}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {needsResend ? (
        <Button type="button" size="sm" variant="outline" className="mt-2" disabled={syncing || !!uploading} onClick={() => void runSync(false)}>
          {syncing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}ส่งไป Asana อีกครั้ง
        </Button>
      ) : null}
    </div>
  );
}
