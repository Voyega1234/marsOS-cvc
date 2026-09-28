"use client";

/**
 * เลือกฟอนต์ของบทความ — กดเลือกจากรายการ, พิมพ์เอง, หรือกด ✕ เพื่อไม่ใส่ฟอนต์ (ใช้ฟอนต์ของเว็บ)
 */
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { UPLOAD_GOOGLE_FONTS } from "@/lib/upload-article/types";

const CUSTOM = "__custom__";

function toStack(family: string): string {
  return `'${family}', sans-serif`;
}

function familyOf(stack: string): string {
  return stack.split(",")[0].replace(/['"]/g, "").trim();
}

export default function FontPicker({
  label, value, onChange, noneValue, noneLabel, defaultLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** ค่าที่หมายถึง "ไม่ใส่ฟอนต์" */
  noneValue: string;
  noneLabel: string;
  /** มีเมื่อค่าว่างหมายถึงค่าเริ่มต้นที่ไม่ใช่ "ไม่ใส่ฟอนต์" */
  defaultLabel?: string;
}) {
  const family = familyOf(value);
  const isNone = value === noneValue;
  const isDefault = !!defaultLabel && value === "";
  const isListed = UPLOAD_GOOGLE_FONTS.includes(family) && value === toStack(family);
  const selectValue = isNone ? "none" : isDefault ? "default" : isListed ? family : CUSTOM;

  function onSelect(v: string) {
    if (v === "none") onChange(noneValue);
    else if (v === "default") onChange("");
    else if (v === CUSTOM) onChange(isListed || isNone || isDefault ? "'Custom Font', sans-serif" : value);
    else onChange(toStack(v));
  }

  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-1.5">
        <select value={selectValue} onChange={e => onSelect(e.target.value)}
          className="flex-1 h-9 rounded-md border border-gray-200 bg-white px-2 text-sm"
          style={isListed ? { fontFamily: value } : undefined}>
          {defaultLabel && <option value="default">{defaultLabel}</option>}
          <option value="none">{noneLabel}</option>
          {UPLOAD_GOOGLE_FONTS.map(f => (
            <option key={f} value={f} style={{ fontFamily: toStack(f) }}>{f}</option>
          ))}
          <option value={CUSTOM}>พิมพ์ชื่อฟอนต์เอง...</option>
        </select>
        <button type="button" title="ตัดฟอนต์ออก (ใช้ฟอนต์ของเว็บ)" disabled={isNone}
          onClick={() => onChange(noneValue)}
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
          <X size={14} />
        </button>
      </div>
      {selectValue === CUSTOM && (
        <Input value={value} onChange={e => onChange(e.target.value)} className="mt-1.5 text-xs h-8"
          placeholder={`เช่น "DB Heavent", sans-serif`} />
      )}
    </div>
  );
}
