"use client";

/**
 * State ร่วมของธีมบทความ (สี/ฟอนต์/หน้าตา FAQ) — ใช้ร่วมกันระหว่างแท็บย่อย
 * "สแกนเว็บปลายทาง" (settings/ScanSection.tsx) กับ "สไตล์บทความ" (settings/StyleSection.tsx)
 * เพื่อให้ผลสแกนที่กดรับไว้ยังอยู่ตอนสลับไปแก้/บันทึกที่แท็บสไตล์
 * ย้ายมาจาก tabs/GenerateTab.tsx เดิม (โลจิกเดียวกันทุกจุด)
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { mergeScannedDetail } from "@/lib/upload-article/theme-css";
import type { UploadClientDTO, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

export function useThemeDraft(client: UploadClientDTO, setClient: (c: UploadClientDTO) => void) {
  const [themeDraft, setThemeDraft] = useState<UploadTheme>(client.theme);
  const [savingTheme, setSavingTheme] = useState(false);
  const [showFaqEditor, setShowFaqEditor] = useState(false);

  // เทียบค่าแทน reference — สแกนเว็บคืน client ใหม่ทั้งก้อน ไม่ควรล้างธีมที่กำลังแก้
  const savedThemeKey = JSON.stringify(client.theme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setThemeDraft(client.theme); }, [savedThemeKey]);
  // แก้แล้วยังไม่บันทึก — StyleSection โชว์ปุ่มบันทึกลอยมุมจอ
  const dirty = JSON.stringify(themeDraft) !== savedThemeKey;

  function setColor(key: keyof UploadTheme, val: string) {
    setThemeDraft(prev => ({ ...prev, [key]: val }));
  }

  /** รับสี/ฟอนต์ + หน้าตา FAQ จากผลสแกนเว็บปลายทาง — ยังไม่บันทึกจนกดบันทึกธีม */
  function applyScannedTheme(theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) {
    setThemeDraft(prev => ({ ...prev, ...theme, styleMode: prev.styleMode, detail: mergeScannedDetail(prev.detail, detail) }));
    if (detail) setShowFaqEditor(true);
    toast.success("ใช้ผลสแกนแล้ว ตรวจพรีวิวด้านล่างแล้วกดบันทึกธีม");
  }

  async function saveTheme() {
    setSavingTheme(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: { ...themeDraft, detail: themeDraft.detail ?? null } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกธีมไม่สำเร็จ"); return; }
      setClient(d);
      toast.success("บันทึกธีมแล้ว");
    } finally {
      setSavingTheme(false);
    }
  }

  return { themeDraft, setThemeDraft, setColor, savingTheme, saveTheme, applyScannedTheme, showFaqEditor, setShowFaqEditor, dirty };
}
