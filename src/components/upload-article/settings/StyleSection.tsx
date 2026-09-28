"use client";

/**
 * Settings > "สไตล์บทความ" — สี/ฟอนต์/รูปแบบ CSS/หน้าตา FAQ ที่ใช้ตอน Generate
 * ค่าที่แก้ตรงนี้ (themeDraft) มาจาก useThemeDraft — ใช้ร่วมกับผลสแกนใน ScanSection
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FontPicker from "../shared/FontPicker";
import FaqStyleEditor from "../shared/FaqStyleEditor";
import { UPLOAD_FONT_INHERIT } from "@/lib/upload-article/types";
import type { UploadTheme } from "@/lib/upload-article/types";

export default function StyleSection({
  themeDraft, setThemeDraft, setColor, savingTheme, saveTheme, showFaqEditor, setShowFaqEditor,
}: {
  themeDraft: UploadTheme;
  setThemeDraft: React.Dispatch<React.SetStateAction<UploadTheme>>;
  setColor: (key: keyof UploadTheme, val: string) => void;
  savingTheme: boolean;
  saveTheme: () => void;
  showFaqEditor: boolean;
  setShowFaqEditor: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
      <p className="text-sm font-semibold text-brand-navy">สไตล์บทความ</p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {([
          ["theme", "สีหลัก"], ["text", "สีตัวอักษร"], ["border", "สีเส้นขอบ"],
          ["accent", "สีเน้น"], ["background", "สีพื้นหลัง"],
        ] as const).map(([key, label]) => (
          <div key={key}>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
            <div className="flex items-center gap-1.5">
              <input type="color" value={themeDraft[key] || "#ffffff"} onChange={e => setColor(key, e.target.value)}
                className="h-8 w-8 rounded border border-gray-200 cursor-pointer shrink-0" />
              <Input value={themeDraft[key] || ""} onChange={e => setColor(key, e.target.value)}
                placeholder="#ffffff" className="text-xs h-8" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FontPicker label="Font ตัวอักษร" value={themeDraft.fontFamily || ""}
          onChange={v => setThemeDraft(p => ({ ...p, fontFamily: v }))}
          noneValue={UPLOAD_FONT_INHERIT} noneLabel="ไม่ใส่ฟอนต์ — ใช้ฟอนต์ของเว็บ"
          defaultLabel="ค่าเริ่มต้น (IBM Plex Sans Thai)" />
        <FontPicker label="Font หัวข้อ" value={themeDraft.headingFont || ""}
          onChange={v => setThemeDraft(p => ({ ...p, headingFont: v }))}
          noneValue="" noneLabel="ไม่ใส่ฟอนต์ — ใช้ตาม Font ตัวอักษร / ธีมเว็บ" />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">รูปแบบ CSS</label>
        <div className="flex gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={themeDraft.styleMode === "embed"} onChange={() => setThemeDraft(p => ({ ...p, styleMode: "embed" }))} />
            embed — ใส่ CSS มากับบทความ
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={themeDraft.styleMode === "clean"} onChange={() => setThemeDraft(p => ({ ...p, styleMode: "clean" }))} />
            clean — ใช้ CSS ของธีมเว็บ
          </label>
        </div>
      </div>

      <div className="border border-gray-100 rounded-lg">
        <button onClick={() => setShowFaqEditor(v => !v)} className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 hover:text-brand-navy">
          {showFaqEditor ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          หน้าตา FAQ card + ตาราง (ละเอียด){themeDraft.detail ? " · ตั้งค่าแล้ว" : ""}
        </button>
        {showFaqEditor && (
          <div className="px-3 pb-3 border-t border-gray-100 pt-3">
            <FaqStyleEditor theme={themeDraft} onChange={d => setThemeDraft(p => ({ ...p, detail: d }))} />
          </div>
        )}
      </div>

      <Button size="sm" disabled={savingTheme} onClick={saveTheme}>
        {savingTheme ? "กำลังบันทึก..." : "บันทึกธีม"}
      </Button>
    </div>
  );
}
