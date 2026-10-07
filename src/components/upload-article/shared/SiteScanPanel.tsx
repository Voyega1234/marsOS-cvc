"use client";

/**
 * สแกนเว็บปลายทางแบบละเอียด — ใช้ร่วมกันในแท็บ Generate และ Push
 * บอกว่าเว็บใช้ธีม/ปลั๊กอินอะไร, มีปลั๊กอิน/ธีมใส่สารบัญ/FAQ/CTA ให้ทุกบทความเองไหม (ตัดของเราออกเฉพาะกรณีนี้)
 * ส่วนที่ผู้เขียนเขียนเองในเนื้อหา (ไม่ใช่ปลั๊กอิน) ยังใส่ของเราตามปกติ
 * และหน้าตา FAQ ของเว็บ — ผลสแกนล่าสุดเก็บไว้ที่ pushPrefs.siteScan
 * (ส่วนแสดงผลอยู่ใน SiteScanView — ไฟล์นี้ผูกกับ endpoint ของ Upload Article)
 */
import { toast } from "sonner";
import SiteScanView, { COMPONENT_LABEL } from "./SiteScanView";
import { UPLOAD_PLATFORM_LABEL, hostOf, pushTargetUrl, uploadPlatformOf } from "@/lib/upload-article/platform-info";
import type { UploadClientDTO, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

export default function SiteScanPanel({
  client, setClient, onApplyTheme, title = "สแกนเว็บปลายทาง (ละเอียด)", defaultUrl,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  /** มีในหน้า Generate — รับสี/ฟอนต์/หน้าตา FAQ จากผลสแกนเข้าธีมที่กำลังแก้ */
  onApplyTheme?: (theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) => void;
  /** URL เริ่มต้นในช่องสแกน (PBN: URL ของเว็บที่กำลังแก้สไตล์) — ไม่ส่ง = wpUrl / website ของลูกค้า */
  defaultUrl?: string;
  title?: string;
}) {
  async function run(url: string, sampleUrl: string): Promise<boolean> {
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/site-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() || undefined, sampleUrl: sampleUrl.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { toast.error(d?.error || "สแกนไม่สำเร็จ"); return false; }
      setClient(d.client);
      const auto = (["toc", "faq", "cta"] as const).filter(k => d.scan?.components?.[k]?.where === "auto");
      toast.success(auto.length
        ? `สแกนเสร็จ — เว็บมีปลั๊กอิน/ธีมใส่ ${auto.map(k => COMPONENT_LABEL[k]).join(", ")} ให้แล้ว ระบบจะไม่ใส่ของเราซ้ำ`
        : "สแกนเสร็จ — ไม่พบปลั๊กอิน/ธีมที่ใส่สารบัญ FAQ CTA ให้เอง ระบบใส่ของเราตามปกติ");
      return true;
    } catch (e) {
      toast.error(`สแกนไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  // สแกนเว็บที่ push ไปจริง (ตามแพลตฟอร์มที่เชื่อม) — WordPress = wpUrl / website เหมือนเดิม
  const platform = uploadPlatformOf(client);
  const pushUrl = pushTargetUrl(client);
  const scanned = client.pushPrefs.siteScan?.target || "";
  const stale = !defaultUrl && !!scanned && !!pushUrl && hostOf(scanned) !== hostOf(pushUrl);

  return (
    <div className="space-y-2">
      {!defaultUrl && pushUrl && (
        <p className="text-xs text-gray-600 flex items-center gap-1.5 flex-wrap">
          สแกนเว็บที่ push ไป:
          <span className="px-1.5 py-0.5 rounded bg-brand-navy/10 text-brand-navy text-[11px] font-semibold">{UPLOAD_PLATFORM_LABEL[platform]}</span>
          <span>·</span>
          <span className="font-mono">{pushUrl}</span>
        </p>
      )}
      {stale && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ผลสแกนเดิมเป็นของ {scanned} — ไม่ใช่เว็บที่ push ตอนนี้ กดสแกนใหม่
        </p>
      )}
      <SiteScanView key={defaultUrl || pushUrl} initialUrl={defaultUrl || pushUrl} scan={client.pushPrefs.siteScan}
        onRun={run} onApplyTheme={onApplyTheme} title={title} />
    </div>
  );
}
