"use client";

/**
 * Settings > "สไตล์บทความ" — สี/ฟอนต์/รูปแบบ CSS/หน้าตา FAQ ที่ใช้ตอน Generate
 * ค่าที่แก้ตรงนี้ (themeDraft) มาจาก useThemeDraft — ใช้ร่วมกับผลสแกนใน ScanSection
 */
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FontPicker from "../shared/FontPicker";
import FaqStyleEditor from "../shared/FaqStyleEditor";
import { UPLOAD_FONT_INHERIT } from "@/lib/upload-article/types";
import { uploadPlatformOf } from "@/lib/upload-article/platform-info";
import { buildWebflowCustomCss } from "@/lib/upload-article/theme-css";
import type { UploadClientDTO, UploadTheme } from "@/lib/upload-article/types";

export default function StyleSection({
  themeDraft, setThemeDraft, setColor, savingTheme, saveTheme, showFaqEditor, setShowFaqEditor, client,
}: {
  themeDraft: UploadTheme;
  setThemeDraft: React.Dispatch<React.SetStateAction<UploadTheme>>;
  setColor: (key: keyof UploadTheme, val: string) => void;
  savingTheme: boolean;
  saveTheme: () => void;
  showFaqEditor: boolean;
  setShowFaqEditor: React.Dispatch<React.SetStateAction<boolean>>;
  /** ลูกค้า Upload Article — ใช้สลับหน้าตามแพลตฟอร์ม (ไม่ส่ง = WordPress/เดิม; SEO SME ไม่ส่ง) */
  client?: Pick<UploadClientDTO, "websitePlatform"> & { id?: string };
}) {
  const platform = client ? uploadPlatformOf(client) : "wordpress";
  const [copied, setCopied] = useState(false);
  const webflowCss = platform === "webflow" ? buildWebflowCustomCss(themeDraft) : "";
  const [cssCheck, setCssCheck] = useState<{ status: "ok" | "outdated" | "missing" | "unreachable"; checkedUrl: string; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  async function checkCssInSite() {
    if (!client?.id) return;
    setChecking(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/webflow-css-check`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "ตรวจ CSS ไม่สำเร็จ"); return; }
      setCssCheck(d);
    } finally {
      setChecking(false);
    }
  }
  async function copyCss() {
    try {
      await navigator.clipboard.writeText(webflowCss);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ — เลือกข้อความในกล่องแล้วคัดลอกเอง");
    }
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
      <p className="text-sm font-semibold text-brand-navy">สไตล์บทความ</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {([
          ["theme", "สีหลัก"], ["text", "สีตัวอักษร"], ["border", "สีเส้นขอบ"],
          ["accent", "สีเน้น"], ["background", "สีพื้นหลังบทความ"], ["pageBackground", "พื้นหน้าเว็บ (พรีวิว)"],
        ] as const).map(([key, label]) => {
          // พื้นหลังว่าง = โปร่งใส (บทความไม่ใส่พื้น เห็นพื้นของเว็บ) — แสดงลายตาราง
          const clearable = key === "background" || key === "pageBackground";
          const clear = clearable && !themeDraft[key];
          return (
            <div key={key}>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
              <div className="flex items-center gap-1.5">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(themeDraft[key] || "") ? themeDraft[key] : "#ffffff"} onChange={e => setColor(key, e.target.value)}
                  className="h-8 w-8 rounded border border-gray-200 cursor-pointer shrink-0"
                  style={clear ? { backgroundImage: "repeating-conic-gradient(#d1d5db 0 25%, #fff 0 50%)", backgroundSize: "8px 8px" } : undefined} />
                <Input value={themeDraft[key] || ""} onChange={e => setColor(key, e.target.value)}
                  placeholder={key === "background" ? "โปร่งใส (ใช้พื้นของเว็บ)" : key === "pageBackground" ? "ขาว" : "#ffffff"} className="text-xs h-8" />
              </div>
              {key === "background" && (
                <button type="button" onClick={() => setColor("background", "")} disabled={clear}
                  className="mt-1 text-[10px] text-brand-blue hover:underline disabled:text-gray-400 disabled:no-underline">
                  {clear ? "โปร่งใสอยู่ — บทความใช้พื้นของเว็บ" : "ตั้งเป็นโปร่งใส"}
                </button>
              )}
              {key === "pageBackground" && (
                <p className="mt-1 text-[10px] text-gray-400">ใช้ดูตัวอย่างเท่านั้น ไม่ใส่ลงบทความ</p>
              )}
            </div>
          );
        })}
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

      {platform === "webflow" ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2 text-xs text-blue-900">
          <p className="font-semibold">Webflow ใช้ CSS จาก Custom Code ของเว็บ</p>
          <p>Webflow ตัด &lt;style&gt; ที่แนบมากับบทความทิ้งตอน push จึงไม่มีตัวเลือก embed / clean — วาง CSS ด้านล่างใน Custom Code ของเว็บแทน (สี/ฟอนต์ด้านบนใช้สร้าง CSS นี้)</p>
          <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            <p className="font-semibold">⚠ Webflow แพ็กเกจฟรีไม่มีช่อง Custom code (Head code)</p>
            <p>ถ้าหน้า Custom code ขึ้น “To unlock custom code, add a site plan to this site” ต้องให้เจ้าของเว็บซื้อ Site plan (Basic ขึ้นไป) ก่อนถึงจะวาง CSS นี้ได้ — ถ้ายังไม่ซื้อ ยัง Push บทความได้ตามปกติ แต่บทความจะใช้สไตล์ Rich text ของธีม Webflow เอง</p>
          </div>
          <div className="relative">
            <textarea readOnly value={webflowCss} onFocus={e => e.currentTarget.select()} rows={8}
              className="w-full rounded border border-blue-200 bg-white p-2 font-mono text-[11px] text-gray-700" />
            <Button type="button" size="sm" variant="outline" onClick={copyCss} className="absolute top-2 right-2 h-7 bg-white">
              <Copy size={12} className="mr-1" />{copied ? "คัดลอกแล้ว" : "Copy"}
            </Button>
          </div>
          <p className="text-[11px] text-blue-800">กดบันทึกธีมก่อน Copy — ระบบเทียบกับธีมที่บันทึกไว้</p>
          {client?.id && (
            <div className="space-y-1.5">
              <Button type="button" size="sm" variant="outline" onClick={checkCssInSite} disabled={checking} className="h-7 bg-white">
                {checking ? "กำลังตรวจ…" : "ตรวจว่าวางในเว็บแล้วหรือยัง"}
              </Button>
              {cssCheck && (
                <p className={`rounded border px-2 py-1.5 text-[11px] ${cssCheck.status === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                  {cssCheck.message}
                  <span className="block break-all text-[10px] opacity-70">ตรวจที่ {cssCheck.checkedUrl}</span>
                </p>
              )}
            </div>
          )}
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>Webflow Dashboard → ⚙ Site settings → Custom code</li>
            <li>วางใน “Head code” (ทั้งก้อนรวม &lt;style&gt;...&lt;/style&gt;)</li>
            <li>Save changes</li>
            <li>Publish เว็บ 1 ครั้ง</li>
          </ol>
          <p className="text-[11px] text-blue-800">Rich text ของ Webflow เก็บเฉพาะแท็กพื้นฐาน (หัวข้อ ย่อหน้า ลิสต์ ลิงก์ รูป คำพูด) — สีและตัวอักษรจึงใช้ได้ แต่กล่อง FAQ / สารบัญ จะเป็น HTML ธรรมดา</p>
        </div>
      ) : (
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
          {platform === "wix" && (
            <p className="mt-1.5 text-[11px] text-gray-500">Wix: บทความลงเป็นกล่อง HTML — แนะนำ embed (CSS ไปกับบทความ)</p>
          )}
        </div>
      )}

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
