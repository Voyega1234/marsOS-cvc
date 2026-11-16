"use client";

import { useRef, useState } from "react";
import { FileDown, FilePlus2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/lib/compliance/types";

function safeName(base: string): string {
  return base.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) + "-compliance.docx";
}

export default function SuggestExportButton({ findings, title, text, originalFile }: {
  findings: Finding[]; title: string; text?: string; originalFile?: File | null;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!findings.some((f) => f.verdict !== "likely_ok")) return null;

  const hasOriginal = !!originalFile && /\.docx$/i.test(originalFile.name);

  async function run(make: (c: typeof import("@/lib/compliance/docx-suggest-client")) => Promise<{ blob: Blob; changes: number; comments: number; unplaced: number; withFix: number }>, baseName: string) {
    setBusy(true);
    try {
      const c = await import("@/lib/compliance/docx-suggest-client");
      const r = await make(c);
      c.downloadBlob(r.blob, safeName(baseName || title || "article"));
      let msg = `ใส่ข้อความแนะนำแบบ Suggesting ${r.changes} จุด · Comment ${r.comments} จุด`;
      if (r.unplaced > 0) msg += ` · หาตำแหน่งไม่เจอ ${r.unplaced} จุด (รวมไว้ใน Comment แรก)`;
      if (r.changes === 0) {
        msg += r.withFix > 0
          ? " — ข้อความในไฟล์นี้ไม่ตรงกับบทความที่ตรวจ จึงใส่ข้อความเสนอแทนไม่ได้ (เลือกไฟล์ต้นฉบับผิดหรือเปล่า)"
          : " — ผลตรวจนี้ไม่มีข้อความเสนอแทน (ต้องเปิด AI ตอนตรวจ)";
      }
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "สร้างไฟล์ Word ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const stripExt = (n: string) => n.replace(/\.[^.]+$/, "");
  const spin = (icon: React.ReactNode) => (busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : icon);

  return (
    <div className="rounded-xl border border-gray-200 bg-white/60 p-3 space-y-2">
      <p className="text-sm font-medium">Export Word (Suggesting)</p>
      <div className="flex flex-wrap gap-2">
        {hasOriginal && originalFile && (
          <Button size="sm" disabled={busy} onClick={() => run((c) => c.annotateDocx(originalFile, findings), stripExt(originalFile.name))}>
            {spin(<FileDown className="mr-1.5 h-4 w-4" />)}ดาวน์โหลดไฟล์ Word พร้อมคำแนะนำ
          </Button>
        )}
        <Button size="sm" variant={hasOriginal ? "outline" : "default"} disabled={busy} onClick={() => inputRef.current?.click()}>
          {spin(<Upload className="mr-1.5 h-4 w-4" />)}{hasOriginal ? "ใส่ลงไฟล์ Word อื่น…" : "เลือกไฟล์ Word ต้นฉบับ…"}
        </Button>
        {text && text.trim() && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async (c) => c.annotateDocx(await c.buildPlainDocx(title, text), findings), title)}>
            {spin(<FilePlus2 className="mr-1.5 h-4 w-4" />)}สร้างไฟล์ Word ใหม่จากข้อความที่ตรวจ
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) run((c) => c.annotateDocx(f, findings), stripExt(f.name));
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        คำแนะนำถูกใส่เป็น Track Changes + Comment ไม่แก้เนื้อหาเดิม — เปิดใน Word หรืออัปโหลดขึ้น Google Drive แล้วเปิดด้วย Google Docs จะเห็นเป็นโหมด Suggesting กดยอมรับ/ปฏิเสธทีละจุดได้
      </p>
    </div>
  );
}
