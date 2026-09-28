"use client";

/**
 * ธีมฉบับร่างของ "สไตล์บทความตามเว็บ PBN" — รูปแบบเดียวกับ settings/useThemeDraft.ts
 * (ส่งต่อให้ ScanSection / StyleSection ได้ทันที) แต่บันทึกลง /api/pbn-backlinks/styles ของเว็บนั้นแทนธีมหลัก
 * siteId = null → ไม่ได้ใช้ (หน้า Setting ใช้ธีมหลักจาก useThemeDraft)
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { UploadClientDTO, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";
import type { PbnStyle } from "@/lib/upload-article/pbn-sets";

export function usePbnSiteThemeDraft(
  client: UploadClientDTO,
  siteId: string | null,
  siteName: string,
  styles: Record<string, PbnStyle>,
  onSaved: (s: PbnStyle) => void,
) {
  // เว็บที่ยังไม่มีสไตล์ของตัวเอง = เริ่มจากสไตล์หลัก
  const base = (siteId && styles[siteId]?.theme) || client.theme;
  const [themeDraft, setThemeDraft] = useState<UploadTheme>(base);
  const [savingTheme, setSavingTheme] = useState(false);
  const [showFaqEditor, setShowFaqEditor] = useState(false);

  const baseKey = `${siteId}|${JSON.stringify(base)}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setThemeDraft(base); }, [baseKey]);

  function setColor(key: keyof UploadTheme, val: string) {
    setThemeDraft(prev => ({ ...prev, [key]: val }));
  }

  function applyScannedTheme(theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) {
    setThemeDraft(prev => ({ ...prev, ...theme, styleMode: prev.styleMode, detail: detail ?? prev.detail }));
    if (detail) setShowFaqEditor(true);
    toast.success(`ใส่ธีมจากเว็บแล้ว — ไปตรวจพรีวิวที่แท็บ “สไตล์บทความ” แล้วกดบันทึก (สไตล์ของ ${siteName})`);
  }

  async function saveTheme() {
    if (!siteId) return;
    setSavingTheme(true);
    try {
      const r = await fetch("/api/pbn-backlinks/styles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, theme: { ...themeDraft, detail: themeDraft.detail ?? null } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกสไตล์ไม่สำเร็จ"); return; }
      onSaved(d.style);
      toast.success(`บันทึกสไตล์ “${d.style?.name || siteName}” แล้ว`);
    } finally {
      setSavingTheme(false);
    }
  }

  return { themeDraft, setThemeDraft, setColor, savingTheme, saveTheme, applyScannedTheme, showFaqEditor, setShowFaqEditor };
}

/** โหลดสไตล์บทความตามเว็บ PBN ทั้งหมด (key = siteId) — enabled=false (หน้า Upload Article) = ไม่โหลด */
export function usePbnStyles(enabled: boolean) {
  const [styles, setStyles] = useState<Record<string, PbnStyle>>({});
  const reload = useCallback(async () => {
    const r = await fetch("/api/pbn-backlinks/styles", { cache: "no-store" }).catch(() => null);
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (d?.styles && typeof d.styles === "object") setStyles(d.styles);
  }, []);
  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);
  return { styles, setStyles, reload };
}
