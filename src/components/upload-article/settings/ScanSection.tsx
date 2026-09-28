"use client";

/**
 * Settings > "สแกนเว็บปลายทาง" — ดึงธีม/ปลั๊กอิน/หน้าตา FAQ จากเว็บปลายทาง (ละเอียด)
 * และดึงสี/ฟอนต์เบื้องต้นจากเว็บต้นฉบับ ทั้งสองผลลัพธ์ใส่ลง themeDraft ร่วมกับแท็บ "สไตล์บทความ"
 * ยังไม่บันทึกจนกว่าจะไปกดบันทึกธีมที่แท็บสไตล์บทความ
 */
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SiteScanPanel from "../shared/SiteScanPanel";
import { UPLOAD_FONT_INHERIT } from "@/lib/upload-article/types";
import type { UploadClientDTO, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

export default function ScanSection({
  client, setClient, setThemeDraft, applyScannedTheme, defaultUrl,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  setThemeDraft: React.Dispatch<React.SetStateAction<UploadTheme>>;
  applyScannedTheme: (theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) => void;
  /** PBN: URL ของเว็บที่กำลังแก้สไตล์ — ไม่ส่ง = website ของลูกค้า */
  defaultUrl?: string;
}) {
  const [scanUrl, setScanUrl] = useState(defaultUrl || client.website || "");
  const [scanning, setScanning] = useState(false);

  async function runThemeScan() {
    setScanning(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/theme-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanUrl.trim() ? { url: scanUrl.trim() } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "สแกนธีมไม่สำเร็จ"); return; }
      if (d.theme) {
        // ฟอนต์ที่ตั้งไว้เป็น "ใช้ฟอนต์ของเว็บ" (inherit) หรือยังไม่ได้ตั้ง (ว่าง) ไม่ควรถูกผลสแกนทับ — ผู้ใช้ตั้งใจเลือกไว้แบบนั้นแล้ว
        setThemeDraft(prev => ({
          ...d.theme,
          styleMode: prev.styleMode,
          detail: prev.detail,
          fontFamily: (prev.fontFamily === UPLOAD_FONT_INHERIT || !prev.fontFamily) ? prev.fontFamily : d.theme.fontFamily,
          headingFont: !prev.headingFont ? prev.headingFont : d.theme.headingFont,
        }));
        toast.success("ดึงธีมจากเว็บสำเร็จ — ไปตรวจสอบสีแล้วกดบันทึกที่แท็บ “สไตล์บทความ”");
      }
    } catch (e) {
      toast.error(`สแกนไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      <SiteScanPanel client={client} setClient={setClient} onApplyTheme={applyScannedTheme} defaultUrl={defaultUrl}
        title="สแกนเว็บปลายทาง — ธีม, ปลั๊กอิน, หน้าตา FAQ (ละเอียด)" />

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-brand-navy">เว็บไซต์ต้นฉบับ</p>
        <p className="text-xs text-gray-500">ดึงสี/ฟอนต์เบื้องต้นจากเว็บนี้ ใส่ลงธีมให้ — ไปตรวจพรีวิวและกดบันทึกที่แท็บ “สไตล์บทความ”</p>
        <div className="flex gap-2">
          <Input value={scanUrl} onChange={e => setScanUrl(e.target.value)} placeholder="https://www.example.com" className="flex-1" />
          <Button variant="outline" disabled={scanning} onClick={runThemeScan}>
            {scanning ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Sparkles size={14} className="mr-1.5" />}
            {scanning ? "กำลังดึงธีม... (อาจใช้เวลาถึง 1 นาที)" : "ดึงธีมจากเว็บต้นฉบับ"}
          </Button>
        </div>
      </div>
    </div>
  );
}
