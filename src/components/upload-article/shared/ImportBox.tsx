"use client";

/**
 * กล่องนำเข้า (ลากไฟล์ / วางข้อความ / ลิงก์ Google Doc / โฟลเดอร์ Google Drive) — ใช้ร่วมกันระหว่างแท็บ
 * "Import Article" (endpoint = /articles) และ "Import Outline" (endpoint = /outlines)
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import DropZone from "@/components/upload-article/shared/DropZone";
import PasteDialog from "@/components/upload-article/shared/PasteDialog";
import GoogleDocDialog from "@/components/upload-article/shared/GoogleDocDialog";
import DriveFolderDialog from "@/components/upload-article/shared/DriveFolderDialog";

// Vercel ปฏิเสธ request body > 4.5MB — จำกัดไฟล์เดี่ยวไว้ที่ 4MB กันชนเพดานตั้งแต่ต้นทาง
const MAX_UPLOAD_FILE_BYTES = 4 * 1024 * 1024;

/** อ่าน error message จาก response — ถ้าไม่ใช่ JSON (เช่นโดน Vercel ตัดก่อนถึง route) ให้บอก HTTP status แทน */
async function readErrorMessage(r: Response, fallback: string): Promise<string> {
  const raw = await r.text().catch(() => "");
  const d = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
  if (d && typeof d === "object" && typeof d.error === "string") return d.error;
  if (r.status === 413) return "ไฟล์ใหญ่เกินที่เซิร์ฟเวอร์รับ (413)";
  return `${fallback} (HTTP ${r.status})`;
}

export default function ImportBox({
  clientId, endpoint, onImported, noun = "บทความ", driveTarget, pastePlaceholder, pasteHeading, children,
}: {
  clientId: string;
  /** ส่วนท้ายของ path ใต้ /api/upload-article/clients/:id/ — "articles" หรือ "outlines" */
  endpoint: "articles" | "outlines";
  /** เรียกหลังนำเข้าเสร็จ (รวมกรณี Drive) — ใช้ refresh รายการ */
  onImported: () => Promise<void>;
  /** คำเรียกรายการที่นำเข้าใน toast */
  noun?: string;
  /** ส่ง target ให้ Drive import (เช่น "outline") */
  driveTarget?: "outline";
  pastePlaceholder?: string;
  pasteHeading?: string;
  /** ข้อความช่วยเหลือใต้ปุ่ม */
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [gdocOpen, setGdocOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const url = `/api/upload-article/clients/${clientId}/${endpoint}`;

  /** อัปโหลดทีละไฟล์ (request ละ 1 ไฟล์) กัน Vercel ตัด body ที่ 4.5MB เมื่อลากมาหลายไฟล์พร้อมกัน */
  async function uploadFiles(files: File[]) {
    const tooBig = files.filter(f => f.size > MAX_UPLOAD_FILE_BYTES);
    const okFiles = files.filter(f => f.size <= MAX_UPLOAD_FILE_BYTES);
    for (const f of tooBig) toast.error(`ไฟล์ ${f.name} ใหญ่เกิน 4MB — ย่อรูปใน Word หรือแยกไฟล์ก่อน`);
    if (okFiles.length === 0) return;

    setBusy(true);
    try {
      let created = 0;
      for (const f of okFiles) {
        try {
          const fd = new FormData();
          fd.append("files", f);
          const r = await fetch(url, { method: "POST", body: fd });
          if (!r.ok) { toast.error(await readErrorMessage(r, `${f.name}: อัปโหลดไม่สำเร็จ`)); continue; }
          const d = await r.json().catch(() => ({}));
          created += Array.isArray(d.created) ? d.created.length : 0;
          const errors = Array.isArray(d.errors) ? d.errors : [];
          for (const e of errors) toast.error(`${e.name}: ${e.error}`);
          const warnings = Array.isArray(d.warnings) ? d.warnings : [];
          for (const w of warnings) toast.warning(`${w.name}: ${w.warning}`);
        } catch (e) {
          toast.error(`${f.name}: อัปโหลดไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (created) toast.success(`นำเข้าสำเร็จ ${created} ${noun}`);
      await onImported();
    } finally {
      setBusy(false);
    }
  }

  async function submitItems(items: Array<{ title?: string; text?: string; html?: string; googleDocUrl?: string }>) {
    setBusy(true);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!r.ok) { toast.error(await readErrorMessage(r, "นำเข้าไม่สำเร็จ")); return; }
      const d = await r.json().catch(() => ({}));
      const created = Array.isArray(d.created) ? d.created.length : 0;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      if (created) toast.success(`นำเข้าสำเร็จ ${created} ${noun}`);
      for (const e of errors) toast.error(`${e.name}: ${e.error}`);
      const warnings = Array.isArray(d.warnings) ? d.warnings : [];
      for (const w of warnings) toast.warning(`${w.name}: ${w.warning}`);
      await onImported();
    } catch (e) {
      toast.error(`นำเข้าไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="bg-white/75 border border-white/80 rounded-2xl p-4 shadow-sm space-y-3">
        <DropZone disabled={busy} onFiles={uploadFiles} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => setPasteOpen(true)}>
            วางข้อความ
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => setGdocOpen(true)}>
            ลิงก์ Google Doc
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => setDriveOpen(true)}>
            Google Drive (โฟลเดอร์)
          </Button>
        </div>
        {children}
        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 size={12} className="animate-spin" /> กำลังนำเข้า...
          </p>
        )}
      </div>

      <PasteDialog open={pasteOpen} onOpenChange={setPasteOpen} busy={busy}
        placeholder={pastePlaceholder} heading={pasteHeading}
        onSubmit={async data => { await submitItems([data]); setPasteOpen(false); }} />
      <GoogleDocDialog open={gdocOpen} onOpenChange={setGdocOpen} busy={busy}
        onSubmit={async data => { await submitItems([data]); setGdocOpen(false); }} />
      <DriveFolderDialog open={driveOpen} onOpenChange={setDriveOpen} clientId={clientId} target={driveTarget}
        onImported={onImported} />
    </>
  );
}
