"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ds";
import { api, fmtDateTime } from "./shared";
import QuotaSources from "./QuotaSources";

export interface SheetStatus {
  connected: boolean;
  spreadsheetUrl: string;
  title: string;
  lastSyncedAt: string | null;
  lastError: string;
  pending: boolean;
  serviceEmail: string;
  canEdit: boolean;
  tableMissing?: boolean;
}

export default function SheetDialog({ open, onOpenChange, status, canEdit, onChanged, onSourcesChanged }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  status: SheetStatus | null;
  canEdit: boolean;
  onChanged: (s: SheetStatus) => void;
  /** เรียกหลังเพิ่ม / ลบ / ดึงข้อมูลลิงก์ชีทโควต้า เพื่อให้หน้าโหลดแท็บโควต้าใหม่ */
  onSourcesChanged?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(status?.serviceEmail ?? "");
      toast.success("คัดลอกอีเมลแล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  async function connect() {
    setBusy(true);
    try {
      const s = await api<SheetStatus & { sync?: { status: string; error?: string } }>("/api/backlink-management/sheet", {
        method: "PUT",
        json: { url: url.trim() },
      });
      onChanged(s);
      setUrl("");
      if (s.sync?.status === "error") toast.error(s.sync.error || "เขียนลงชีทไม่สำเร็จ");
      else toast.success("เชื่อม Google Sheet แล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const r = await api<{ status: string; error?: string }>("/api/backlink-management/sheet/sync", { method: "POST", json: { force: true } });
      onChanged(await api<SheetStatus>("/api/backlink-management/sheet"));
      if (r.status === "error") toast.error(r.error || "sync ไม่สำเร็จ");
      else toast.success("อัปเดตชีทแล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "sync ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("ยกเลิกการเชื่อม Google Sheet? ข้อมูลในชีทจะไม่ถูกลบ")) return;
    setBusy(true);
    try {
      const s = await api<SheetStatus>("/api/backlink-management/sheet", { method: "DELETE" });
      onChanged(s);
      toast.success("ยกเลิกการเชื่อมแล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const connected = !!status?.connected;
  const email = status?.serviceEmail ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <QuotaSources open={open} onSourcesChanged={onSourcesChanged} />
        <hr className="border-gray-200" />
        <DialogHeader>
          <DialogTitle>ส่งออกข้อมูลคำขอไป Google Sheet (ทางเดียว)</DialogTitle>
          <DialogDescription>
            ข้อมูลไหลทางเดียวจาก MarsOS ไปชีท แท็บที่ขึ้นต้นด้วย MarsOS (3 แท็บ) ถูกเขียนทับทุกครั้งที่ sync ห้ามแก้ใน 3 แท็บนี้ แท็บอื่นในไฟล์ไม่ถูกแตะ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {status?.tableMissing ? (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              ยังไม่ได้สร้างตารางในฐานข้อมูล ให้ผู้ดูแลรันไฟล์ scripts/sql/add-blm-project-sheet-tables.sql ก่อน
            </div>
          ) : null}

          {connected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={status?.lastError ? "warn" : "ok"}>{status?.lastError ? "เชื่อมแล้ว · มีข้อผิดพลาด" : "เชื่อมแล้ว"}</Chip>
                {status?.pending ? <Chip tone="info">รอ sync</Chip> : null}
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs text-gray-600">
                <span>ชีท</span>
                <a href={status?.spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-brand-navy underline">
                  {status?.title || "เปิดชีท"} <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <span>sync ล่าสุด</span><span>{fmtDateTime(status?.lastSyncedAt)}</span>
              </div>
              {status?.lastError ? <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{status.lastError}</div> : null}
            </>
          ) : !email ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">ระบบยังไม่มี service account สำหรับ Google</p>
          ) : canEdit && !status?.tableMissing ? (
            <ol className="list-decimal space-y-2 pl-5 text-xs text-gray-700">
              <li>เปิดหรือสร้าง Google Sheet</li>
              <li>
                กด Share แล้วเพิ่มอีเมลนี้เป็น Editor
                <div className="mt-1 flex items-center gap-2">
                  <code className="break-all rounded-lg bg-gray-100 px-2 py-1">{email}</code>
                  <Button type="button" variant="outline" size="sm" onClick={copyEmail} aria-label="คัดลอกอีเมล"><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
              <li>วางลิงก์ชีทด้านล่าง แล้วกด &quot;เชื่อมต่อ&quot;</li>
            </ol>
          ) : (
            <p className="text-xs text-gray-500">ยังไม่ได้เชื่อม Google Sheet</p>
          )}

          {canEdit && !connected && email && !status?.tableMissing ? (
            <div>
              <Label>ลิงก์ Google Sheet</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
            </div>
          ) : null}
          {!canEdit ? <p className="text-xs text-gray-500">เฉพาะ ADMIN / SEO Manager เท่านั้นที่เชื่อมหรือยกเลิกการเชื่อมได้</p> : null}
        </div>

        <DialogFooter className="gap-2">
          {canEdit && connected ? <Button variant="outline" onClick={disconnect} disabled={busy}>ยกเลิกการเชื่อมต่อ</Button> : null}
          {connected ? <Button variant="outline" onClick={syncNow} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Sync ตอนนี้</Button> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>ปิด</Button>
          {canEdit && !connected && email && !status?.tableMissing ? (
            <Button onClick={connect} disabled={busy || !url.trim()}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}เชื่อมต่อ</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
