"use client";

/**
 * Article Lab > Style ของ SEO SME — ใช้ชุดเดียวกับ Upload Article: "สแกนเว็บปลายทาง" + "สไตล์บทความ" (พรีวิวสด)
 * ธีมเก็บใน Project.themeColors (แปลงผ่าน lib/project-theme) — สแกนเว็บเก็บผลที่ Project.pushPrefs.siteScan
 * ผลสแกน/การแก้สียังไม่บันทึกจนกดบันทึกธีมที่ส่วน "สไตล์บทความ"
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Palette, ScanSearch } from "lucide-react";
import SiteScanView, { COMPONENT_LABEL } from "@/components/upload-article/shared/SiteScanView";
import StyleSection from "@/components/upload-article/settings/StyleSection";
import { mergeUploadThemeIntoThemeColors, projectThemeToUpload } from "@/lib/project-theme";
import { UPLOAD_FONT_INHERIT } from "@/lib/upload-article/types";
import type { UploadSiteScan, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

/** ข้อเสนอบริบทธุรกิจ/Style Guide/คำต้องห้ามจากสแกน (ส่วนที่ไม่เกี่ยวกับสไตล์) */
export interface SmeScanContext {
  projectContext: string;
  styleGuide: string;
  forbiddenWords: string[];
}

export default function SmeStyleSettings({
  projectId, website, themeColors, accentColor, onSaved, onApplyContext,
}: {
  projectId: string;
  website?: string | null;
  themeColors?: string | null;
  accentColor?: string | null;
  onSaved?: (themeColors: string) => void;
  onApplyContext?: (ctx: SmeScanContext) => void;
}) {
  const [themeDraft, setThemeDraft] = useState<UploadTheme>(() => projectThemeToUpload(themeColors, accentColor));
  const [savingTheme, setSavingTheme] = useState(false);
  const [showFaqEditor, setShowFaqEditor] = useState(false);
  const [scan, setScan] = useState<UploadSiteScan | undefined>(undefined);
  const [scanCtx, setScanCtx] = useState<SmeScanContext | null>(null);

  function setColor(key: keyof UploadTheme, val: string) {
    setThemeDraft(prev => ({ ...prev, [key]: val }));
  }

  // ผลสแกนละเอียดล่าสุดที่เคยบันทึกไว้ — โชว์ไว้ก่อนกดสแกนใหม่
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/lab-scan`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.siteScan) setScan(d.siteScan as UploadSiteScan); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  async function runScan(url: string, sampleUrl: string): Promise<boolean> {
    try {
      const r = await fetch(`/api/projects/${projectId}/lab-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url || undefined, sampleUrl: sampleUrl || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { toast.error(d?.error || "สแกนไม่สำเร็จ"); return false; }
      if (d.siteScan?.scan) {
        setScan({ ...d.siteScan.scan, suggestedTheme: d.siteScan.suggestedTheme, detail: d.siteScan.detail } as UploadSiteScan);
      }
      const s = d.suggestion;
      setScanCtx(s ? { projectContext: s.projectContext ?? "", styleGuide: s.styleGuide ?? "", forbiddenWords: s.forbiddenWords ?? [] } : null);
      if (d.siteScanError) toast.error(`สแกนละเอียดไม่สำเร็จ: ${d.siteScanError}`);
      const auto = (["toc", "faq", "cta"] as const).filter(k => d.siteScan?.scan?.components?.[k]?.where === "auto");
      toast.success(auto.length
        ? `สแกนเสร็จ — เว็บมีปลั๊กอิน/ธีมใส่ ${auto.map(k => COMPONENT_LABEL[k]).join(", ")} ให้แล้ว ระบบจะไม่ใส่ของเราซ้ำ`
        : "สแกนเสร็จ — ไม่พบปลั๊กอิน/ธีมที่ใส่สารบัญ FAQ CTA ให้เอง ระบบใส่ของเราตามปกติ");
      return true;
    } catch (e) {
      toast.error(`สแกนไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** รับสี/ฟอนต์ + หน้าตา FAQ จากผลสแกน — กฎเดียวกับ Upload (คง styleMode, ไม่ทับฟอนต์ inherit/ว่าง) ยังไม่บันทึก */
  function applyScannedTheme(theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) {
    setThemeDraft(prev => ({
      ...prev,
      ...theme,
      styleMode: prev.styleMode,
      detail: detail ?? prev.detail,
      // ฟอนต์ที่สแกนได้เป็น inherit/ว่าง ไม่ใช่ชื่อฟอนต์ที่ใช้ได้จริง — คงของเดิม
      fontFamily: (!theme.fontFamily || theme.fontFamily === UPLOAD_FONT_INHERIT) ? prev.fontFamily : theme.fontFamily,
      headingFont: (!theme.headingFont || theme.headingFont === UPLOAD_FONT_INHERIT) ? prev.headingFont : theme.headingFont,
    }));
    if (detail) setShowFaqEditor(true);
    toast.success("ใส่ธีมจากเว็บแล้ว — ตรวจพรีวิวที่ส่วน “สไตล์บทความ” แล้วกดบันทึกธีม");
  }

  async function saveTheme() {
    setSavingTheme(true);
    try {
      const cur = await fetch(`/api/projects/${projectId}`);
      const curJson = await cur.json().catch(() => ({}));
      if (!cur.ok) { toast.error(curJson?.error || "โหลดค่าธีมปัจจุบันไม่สำเร็จ"); return; }
      const merged = mergeUploadThemeIntoThemeColors(curJson?.themeColors ?? null, { ...themeDraft, detail: themeDraft.detail ?? undefined });
      const r = await fetch(`/api/projects/${projectId}/style`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeColors: merged }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกธีมไม่สำเร็จ"); return; }
      toast.success("บันทึกธีมแล้ว");
      onSaved?.(merged);
    } catch (e) {
      toast.error(`บันทึกธีมไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingTheme(false);
    }
  }

  return (
    <div className="space-y-4 mb-5">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5"><ScanSearch size={13} /> สแกนเว็บปลายทาง</p>
        <SiteScanView initialUrl={website ?? ""} scan={scan} onRun={runScan} onApplyTheme={applyScannedTheme}
          title="สแกนเว็บปลายทาง — ธีม, ปลั๊กอิน, หน้าตา FAQ (ละเอียด)" />
        {onApplyContext && scanCtx && (scanCtx.projectContext || scanCtx.styleGuide || scanCtx.forbiddenWords.length > 0) && (
          <button type="button" onClick={() => { onApplyContext(scanCtx); toast.success("ใส่บริบทธุรกิจ/Style Guide/คำต้องห้ามลงฟอร์มแล้ว — ตรวจแล้วกดบันทึกทั้งหมด"); }}
            className="h-8 px-3 rounded-lg border border-brand-blue text-brand-blue text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-gray-50">
            <Check size={12} /> นำบริบทธุรกิจ / Style Guide / คำต้องห้ามจากสแกนไปใส่ในฟอร์ม
          </button>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5"><Palette size={13} /> สไตล์บทความ</p>
        <StyleSection themeDraft={themeDraft} setThemeDraft={setThemeDraft} setColor={setColor}
          savingTheme={savingTheme} saveTheme={saveTheme} showFaqEditor={showFaqEditor} setShowFaqEditor={setShowFaqEditor} />
        <a href={`/api/projects/${projectId}/article-css`} download
          className="inline-block text-[11px] font-semibold text-brand-blue hover:underline">⬇ ดาวน์โหลด CSS ของ client</a>
      </div>
    </div>
  );
}
