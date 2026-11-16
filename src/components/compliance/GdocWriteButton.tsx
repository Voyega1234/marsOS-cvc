"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/lib/compliance/types";
import { api } from "./shared";

export interface GdocInfo { fileId: string; version: string; canEdit: boolean }

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}

/** เขียนข้อเสนอแก้ (Suggesting + Comment) กลับลง Google Doc เดิม — ใช้ annotateDocx ตัวเดียวกับปุ่ม export Word */
export default function GdocWriteButton({ findings, originalFile, gdoc }: {
  findings: Finding[]; originalFile: File | null; gdoc: GdocInfo;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!findings.some((f) => f.verdict !== "likely_ok")) return null;

  async function write() {
    if (!originalFile) return;
    if (!window.confirm("เขียนข้อเสนอแก้เป็น Suggesting ลง Google Doc เดิม ฉบับก่อนหน้าอยู่ใน Version history")) return;
    setBusy(true);
    try {
      const c = await import("@/lib/compliance/docx-suggest-client");
      const r = await c.annotateDocx(originalFile, findings);
      const docxBase64 = bytesToBase64(new Uint8Array(await r.blob.arrayBuffer()));
      const { ok, data } = await api<{ ok?: boolean; version?: string; webViewLink?: string }>("/api/compliance/gdoc/write", {
        method: "POST",
        body: JSON.stringify({ fileId: gdoc.fileId, expectedVersion: gdoc.version, docxBase64 }),
      });
      if (!ok || !data.ok) {
        toast.error(data.error || "เขียนลง Google Doc ไม่สำเร็จ", { duration: 9000 });
        return;
      }
      setDone(true);
      const link = data.webViewLink;
      toast.success(`ใส่คำแนะนำลง Google Doc แล้ว · Suggesting ${r.changes} จุด · Comment ${r.comments} จุด`, {
        duration: 15000,
        action: link ? { label: "เปิด Doc", onClick: () => window.open(link, "_blank", "noopener,noreferrer") } : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เขียนลง Google Doc ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 space-y-2">
      <p className="text-sm font-medium">ใส่คำแนะนำลง Google Doc</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || done || !gdoc.canEdit || !originalFile} onClick={write}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          ใส่คำแนะนำลง Google Doc (Suggesting)
        </Button>
        <a
          href={`https://docs.google.com/document/d/${gdoc.fileId}/edit`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-brand-blue underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />เปิด Google Doc
        </a>
      </div>
      {!gdoc.canEdit && <p className="text-xs text-amber-700">service account ยังเป็นแค่ผู้ดู — แชร์ Doc เป็น Editor แล้วดึงเอกสารใหม่</p>}
      {done && <p className="text-xs text-green-700">เขียนแล้ว — ต้องดึงเอกสารใหม่ก่อนจะเขียนซ้ำได้</p>}
    </div>
  );
}
