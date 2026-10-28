"use client";

/** ตัวเลือกภาษาที่ใช้เขียนบทความ (th | en | both) — ถ้าส่ง clientId จะ PATCH บันทึกให้เลย */
import { useState } from "react";
import { toast } from "sonner";

type Lang = "th" | "en" | "both";

const OPTIONS: Array<{ id: Lang; label: string }> = [
  { id: "th", label: "ไทย" },
  { id: "en", label: "English" },
  { id: "both", label: "ไทย+อังกฤษ" },
];

const HINTS: Record<Lang, string> = {
  th: "title และบทความจะเป็นภาษาไทย",
  en: "title และบทความจะเป็นภาษาอังกฤษ",
  both: "ดูภาษาจาก title ก่อน (title อังกฤษ = เขียนอังกฤษ) ถ้า title ไม่ชัดดูจาก keyword",
};

export default function UploadLanguageSelect({
  value, onChange, disabled, clientId, onSaved, showHint,
}: {
  value: Lang;
  onChange: (v: Lang) => void;
  disabled?: boolean;
  clientId?: string;
  onSaved?: (v: Lang) => void;
  showHint?: boolean;
}) {
  const [saving, setSaving] = useState(false);

  async function pick(v: Lang) {
    if (v === value || disabled || saving) return;
    if (!clientId) { onChange(v); return; }
    const prev = value;
    onChange(v);
    setSaving(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: v }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onChange(prev); toast.error(d?.error || "ตั้งภาษาไม่สำเร็จ"); return; }
      toast.success(`ตั้งภาษาเป็น ${OPTIONS.find(o => o.id === v)?.label} แล้ว`);
      onSaved?.(v);
    } catch (e) {
      onChange(prev);
      toast.error(`ตั้งภาษาไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map(o => (
          <button key={o.id} type="button" disabled={disabled || saving} onClick={() => pick(o.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-60 ${
              value === o.id ? "bg-brand-mist text-brand-blue border-brand-soft/60" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
            }`}>
            {o.label}
          </button>
        ))}
      </div>
      {showHint && <p className="text-[11px] text-gray-400 mt-1">{HINTS[value]}</p>}
    </div>
  );
}
