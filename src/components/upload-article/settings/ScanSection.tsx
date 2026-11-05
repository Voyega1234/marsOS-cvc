"use client";

/**
 * ส่วน "สแกนเว็บปลายทาง" ในหน้า "หน้าตาบทความ" — ดึงธีม/ปลั๊กอิน/ฟอนต์จริง/โครงบทความ/หน้าตา FAQ จากเว็บปลายทางปุ่มเดียว
 * ผลลัพธ์ใส่ลง themeDraft ร่วมกับส่วนสไตล์ด้านล่าง ยังไม่บันทึกจนกดบันทึกธีม
 */
import SiteScanPanel from "../shared/SiteScanPanel";
import type { UploadClientDTO, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

export default function ScanSection({
  client, setClient, applyScannedTheme, defaultUrl,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  applyScannedTheme: (theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) => void;
  /** PBN: URL ของเว็บที่กำลังแก้สไตล์ — ไม่ส่ง = website ของลูกค้า */
  defaultUrl?: string;
}) {
  return (
    <div className="space-y-4">
      <SiteScanPanel client={client} setClient={setClient} onApplyTheme={applyScannedTheme} defaultUrl={defaultUrl}
        title="สแกนเว็บปลายทาง — ธีม, ฟอนต์จริง, โครงบทความ, หน้าตา FAQ" />
    </div>
  );
}
