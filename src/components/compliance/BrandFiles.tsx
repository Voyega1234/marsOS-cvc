"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BRAND_FILES_MAX, BRAND_FILE_MAX_CHARS, type BrandDetail, type BrandFileView } from "@/lib/compliance/brand";
import { readLegacyDocText } from "@/lib/doc-legacy";
import {
  RESTRICTION_FILE_ACCEPT, extractRestrictionFileText, isImageFile, readImageFileWithAI, readImagePagesWithAI,
} from "@/lib/restriction-file-client";
import { api, fmtDateTime } from "./shared";

const FILE_ACCEPT = `${RESTRICTION_FILE_ACCEPT},.doc`;
/** ไฟล์อ่านในเบราว์เซอร์ ส่งไปเซิร์ฟเวอร์เฉพาะข้อความ */
const FILE_MAX_BYTES = 25 * 1024 * 1024;
/** หน้าสแกนคิดค่า AI ต่อหน้า จึงจำกัดจำนวนหน้าต่อครั้ง */
const SCAN_PAGES_MAX = 15;

export default function BrandFiles({ brand, onChanged }: {
  brand: BrandDetail;
  onChanged: (brand: BrandDetail) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [viewing, setViewing] = useState<{ name: string; text: string | null } | null>(null);

  const full = brand.files.length >= BRAND_FILES_MAX;

  /** ข้อความของไฟล์ อ่านในเบราว์เซอร์ · null = ผู้ใช้ไม่ให้ AI อ่านรูป และไฟล์ไม่มีข้อความอื่น */
  async function readFileText(file: File): Promise<string | null> {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (ext === "doc") return readLegacyDocText(new Uint8Array(await file.arrayBuffer()));
    if (isImageFile(file)) {
      if (!window.confirm(`"${file.name}" เป็นรูป ต้องให้ AI ถอดข้อความก่อน (มีค่าใช้จ่าย AI เพิ่ม 1 ครั้ง)\nให้ AI อ่านรูปนี้หรือไม่?`)) return null;
      setProgress(`AI กำลังอ่านรูป ${file.name}…`);
      return readImageFileWithAI(file, null);
    }
    const extracted = await extractRestrictionFileText(file);
    const imagePages = extracted.imagePages ?? [];
    if (!imagePages.length) return extracted.text;
    const pagesToRead = imagePages.slice(0, SCAN_PAGES_MAX);
    const askScan = `"${file.name}" มี ${imagePages.length} หน้าที่เนื้อหาอยู่ในรูป (สแกน)\n`
      + `ให้ AI ถอดข้อความ ${pagesToRead.length} หน้า${imagePages.length > pagesToRead.length ? "แรก" : ""}หรือไม่? (มีค่าใช้จ่าย AI ต่อหน้า)`
      + (extracted.text ? "\nกด Cancel = ใช้เฉพาะข้อความที่อ่านได้อยู่แล้ว" : "");
    if (!window.confirm(askScan)) return extracted.text || null;
    const { text, failedPages } = await readImagePagesWithAI({
      file, extracted, pagesToRead, projectId: null,
      onProgress: (done, total) => setProgress(`AI กำลังอ่านหน้าสแกน ${done}/${total} หน้า…`),
    });
    if (failedPages.length) toast.warning(`อ่านรูปหน้า ${failedPages.join(", ")} ไม่สำเร็จ ข้อความส่วนอื่นยังอยู่ครบ`);
    if (imagePages.length > pagesToRead.length) {
      toast.warning(`อ่านรูปเฉพาะ ${pagesToRead.length} หน้าแรก เหลือ ${imagePages.length - pagesToRead.length} หน้าที่ยังไม่ได้อ่าน`);
    }
    return text;
  }

  async function uploadAll(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length || busy) return;
    setBusy(true);
    let count = brand.files.length;
    try {
      for (const file of files) {
        if (count >= BRAND_FILES_MAX) { toast.error(`แบรนด์นี้มีไฟล์ครบ ${BRAND_FILES_MAX} ไฟล์แล้ว`); break; }
        if (file.size > FILE_MAX_BYTES) { toast.error(`${file.name}: ไฟล์ใหญ่เกิน 25 MB`); continue; }
        try {
          setProgress(`กำลังอ่าน ${file.name}…`);
          const text = await readFileText(file);
          if (text === null) continue;
          if (text.trim().length < 20) {
            toast.error(`${file.name}: อ่านข้อความได้น้อยเกินไป — ถ้าเป็นไฟล์สแกน ให้อัปโหลดอีกครั้งแล้วยอมให้ AI อ่านรูป`, { duration: 9000 });
            continue;
          }
          setProgress(`กำลังบันทึก ${file.name}…`);
          const { ok, data } = await api<{ brand: BrandDetail; truncated?: boolean }>(
            `/api/compliance/brands/${brand.id}/files`,
            { method: "POST", body: JSON.stringify({ fileName: file.name, text: text.slice(0, BRAND_FILE_MAX_CHARS) }) },
          );
          if (!ok || !data.brand) { toast.error(`${file.name}: ${data.error || "บันทึกไม่สำเร็จ"}`, { duration: 9000 }); continue; }
          count = data.brand.files.length;
          onChanged(data.brand);
          if (data.truncated) toast.warning(`${file.name}: บันทึกแล้ว แต่ไฟล์ยาวเกิน จึงตัดเหลือ 200,000 ตัวอักษร`);
          else toast.success(`บันทึก ${file.name} แล้ว`);
        } catch (e) {
          toast.error(`${file.name}: ${e instanceof Error && e.message ? e.message : "อ่านไฟล์ไม่สำเร็จ"}`, { duration: 9000 });
        }
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function view(f: BrandFileView) {
    setViewing({ name: f.fileName, text: null });
    const { ok, data } = await api<{ file: { text: string } }>(`/api/compliance/brands/${brand.id}/files/${f.id}`);
    if (!ok || !data.file) {
      toast.error(data.error || "เปิดไฟล์ไม่สำเร็จ");
      setViewing(null);
      return;
    }
    setViewing({ name: f.fileName, text: data.file.text });
  }

  async function remove(f: BrandFileView) {
    if (!window.confirm(`ลบไฟล์ "${f.fileName}" ออกจากแบรนด์นี้?`)) return;
    setDeletingId(f.id);
    const { ok, data } = await api<{ brand: BrandDetail }>(`/api/compliance/brands/${brand.id}/files/${f.id}`, { method: "DELETE" });
    setDeletingId("");
    if (!ok || !data.brand) { toast.error(data.error || "ลบไม่สำเร็จ"); return; }
    toast.success("ลบไฟล์แล้ว");
    onChanged(data.brand);
  }

  return (
    <div className="space-y-3">
      {brand.files.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white">
          {brand.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-brand-navy">{f.fileName}</div>
                <div className="text-[11px] text-gray-500">
                  {f.chars.toLocaleString("en-US")} ตัวอักษร · {f.createdByName || "—"} · {fmtDateTime(f.createdAt)}
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => void view(f)}>ดูข้อความ</Button>
              <Button size="sm" variant="ghost" className="h-8 px-3 text-xs" disabled={deletingId === f.id || busy} onClick={() => void remove(f)}>ลบ</Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <input
          ref={fileRef} type="file" multiple accept={FILE_ACCEPT} className="hidden"
          onChange={(e) => void uploadAll(e.target.files)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={busy || full} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            แนบไฟล์ Brand voice
          </Button>
          <span aria-live="polite" className="text-xs text-gray-600">{busy ? progress : full ? `ครบ ${BRAND_FILES_MAX} ไฟล์แล้ว` : ""}</span>
        </div>
        <p className="text-xs text-gray-500">ระบบเก็บเฉพาะข้อความที่อ่านได้จากไฟล์ ไม่เก็บตัวไฟล์ — สูงสุด {BRAND_FILES_MAX} ไฟล์ต่อแบรนด์</p>
      </div>

      <Dialog open={!!viewing} onOpenChange={(v) => { if (!v) setViewing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle className="break-all">{viewing?.name}</DialogTitle></DialogHeader>
          {viewing?.text === null ? (
            <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...</p>
          ) : (
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">{viewing?.text}</pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
