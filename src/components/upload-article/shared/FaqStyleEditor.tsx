"use client";

/**
 * แก้หน้าตา FAQ card + ตาราง แบบละเอียด พร้อมพรีวิวสด
 * ค่าที่ว่าง = ใช้ค่าตั้งต้นจากสีธีม — ค่าทั้งหมดผ่าน sanitize ซ้ำฝั่ง server ตอนบันทึก
 */
import { useMemo } from "react";
import ArticleFrame from "@/components/shared/ArticleFrame";
import { Input } from "@/components/ui/input";
import { wrapArticleHtml } from "@/lib/articleComponents";
import { buildUploadCss, sanitizeThemeDraft } from "@/lib/upload-article/theme-css";
import type { UploadFaqStyle, UploadTableStyle, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

const SAMPLE = `<h2 id="faq">คำถามที่พบบ่อย</h2>
<details class="content-faq__item" open><summary class="content-faq__question"><span class="content-faq__q">คำถามตัวอย่างข้อที่ 1 ยาวพอให้เห็นการตัดบรรทัด?</span></summary><div class="content-faq__answer"><p>คำตอบตัวอย่าง แสดงสีตัวอักษร พื้นหลัง และระยะห่างของคำตอบเมื่อเปิดอยู่</p></div></details>
<details class="content-faq__item"><summary class="content-faq__question"><span class="content-faq__q">คำถามตัวอย่างข้อที่ 2?</span></summary><div class="content-faq__answer"><p>คำตอบข้อที่ 2</p></div></details>
<details class="content-faq__item"><summary class="content-faq__question"><span class="content-faq__q">คำถามตัวอย่างข้อที่ 3?</span></summary><div class="content-faq__answer"><p>คำตอบข้อที่ 3</p></div></details>
<div class="content-table-wrap"><table class="content-table"><tr><th>หัวตาราง</th><th>ราคา</th></tr><tr><td>แถวที่ 1</td><td>1,000</td></tr><tr><td>แถวที่ 2</td><td>2,000</td></tr></table></div>`;

type ColorKey = "itemBackground" | "itemBorderColor" | "questionBackground" | "questionColor" | "openQuestionBackground" | "openQuestionColor" | "answerBackground" | "answerColor" | "iconColor";

const FAQ_COLORS: Array<[ColorKey, string]> = [
  ["itemBackground", "พื้นกล่อง"], ["itemBorderColor", "เส้นขอบ"], ["questionBackground", "พื้นคำถาม"],
  ["questionColor", "ตัวอักษรคำถาม"], ["openQuestionBackground", "พื้นคำถาม (เปิด)"], ["openQuestionColor", "ตัวอักษรคำถาม (เปิด)"],
  ["answerBackground", "พื้นคำตอบ"], ["answerColor", "ตัวอักษรคำตอบ"], ["iconColor", "สีไอคอน"],
];

const TABLE_COLORS: Array<[keyof UploadTableStyle, string]> = [
  ["headerBackground", "พื้นหัวตาราง"], ["headerColor", "ตัวอักษรหัวตาราง"], ["borderColor", "เส้นตาราง"], ["stripeBackground", "แถวสลับสี"],
];

function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  // transparent = โปร่งใส เห็นพื้นด้านหลัง — แสดงเป็นลายตาราง
  const clear = value === "transparent";
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">{label}</label>
      <div className="flex items-center gap-1">
        <input type="color" value={hex} onChange={e => onChange(e.target.value)} className="h-7 w-7 rounded border border-gray-200 cursor-pointer shrink-0"
          style={clear ? { backgroundImage: "repeating-conic-gradient(#d1d5db 0 25%, #fff 0 50%)", backgroundSize: "8px 8px" } : undefined} />
        <Input value={value || ""} onChange={e => onChange(e.target.value)} placeholder="ค่าตั้งต้น" className="text-[11px] h-7 px-1.5" />
      </div>
    </div>
  );
}

export default function FaqStyleEditor({ theme, onChange }: { theme: UploadTheme; onChange: (detail: UploadThemeDetail | undefined) => void }) {
  const detail = theme.detail || {};
  const faq = detail.faq || {};
  const table = detail.table || {};

  function setFaq<K extends keyof UploadFaqStyle>(key: K, val: UploadFaqStyle[K] | "" | undefined) {
    const next: UploadFaqStyle = { ...faq };
    if (val === "" || val === undefined || (typeof val === "number" && Number.isNaN(val))) delete next[key];
    else next[key] = val as UploadFaqStyle[K];
    onChange({ ...detail, faq: next });
  }
  function setTable(key: keyof UploadTableStyle, val: string) {
    const next: UploadTableStyle = { ...table };
    if (!val) delete next[key];
    else next[key] = val;
    onChange({ ...detail, table: next });
  }
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const previewHtml = useMemo(() => wrapArticleHtml(SAMPLE, buildUploadCss(sanitizeThemeDraft(theme))), [theme]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
      <div className="space-y-3">
        {detail.source && <p className="text-[10px] text-gray-400">ค่าจากการสแกน: {detail.source}</p>}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="space-y-0.5">
            <span className="block text-[10px] font-semibold text-gray-500">รูปแบบกล่อง</span>
            <select value={faq.layout || ""} onChange={e => setFaq("layout", (e.target.value || undefined) as UploadFaqStyle["layout"])} className="w-full h-7 border border-gray-200 rounded px-1 text-[11px]">
              <option value="">ค่าตั้งต้น (กล่องมีขอบ)</option>
              <option value="card">กล่องมีขอบ</option>
              <option value="divider">เส้นคั่นล่าง</option>
              <option value="plain">ไม่มีขอบ</option>
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="block text-[10px] font-semibold text-gray-500">ไอคอน</span>
            <select value={faq.icon || ""} onChange={e => setFaq("icon", (e.target.value || undefined) as UploadFaqStyle["icon"])} className="w-full h-7 border border-gray-200 rounded px-1 text-[11px]">
              <option value="">ค่าตั้งต้น (+ / −)</option>
              <option value="plus">+ / −</option>
              <option value="chevron">ลูกศรหัก (chevron)</option>
              <option value="caret">▸ / ▾</option>
              <option value="arrow">↓ / ↑</option>
              <option value="none">ไม่มีไอคอน</option>
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="block text-[10px] font-semibold text-gray-500">ตำแหน่งไอคอน</span>
            <select value={faq.iconPosition || ""} onChange={e => setFaq("iconPosition", (e.target.value || undefined) as UploadFaqStyle["iconPosition"])} className="w-full h-7 border border-gray-200 rounded px-1 text-[11px]">
              <option value="">ค่าตั้งต้น (ขวา)</option>
              <option value="right">ขวา</option>
              <option value="left">ซ้าย</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {FAQ_COLORS.map(([k, label]) => <ColorField key={k} label={label} value={faq[k]} onChange={v => setFaq(k, v)} />)}
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {([["itemBorderWidth", "ขอบหนา (px)"], ["itemRadius", "มุมโค้ง (px)"], ["itemGap", "ระยะห่าง (px)"], ["questionWeight", "น้ำหนักตัวอักษร"]] as const).map(([k, label]) => (
            <label key={k} className="space-y-0.5">
              <span className="block text-[10px] font-semibold text-gray-500">{label}</span>
              <Input type="number" value={faq[k] ?? ""} onChange={e => setFaq(k, num(e.target.value))} placeholder="ค่าตั้งต้น" className="text-[11px] h-7 px-1.5" />
            </label>
          ))}
          {([["questionFontSize", "ขนาดคำถาม", "เช่น 18px"], ["questionPadding", "ระยะในคำถาม", "เช่น 16px 20px"], ["answerPadding", "ระยะในคำตอบ", "เช่น 0 20px 16px"]] as const).map(([k, label, ph]) => (
            <label key={k} className="space-y-0.5">
              <span className="block text-[10px] font-semibold text-gray-500">{label}</span>
              <Input value={faq[k] ?? ""} onChange={e => setFaq(k, e.target.value)} placeholder={ph} className="text-[11px] h-7 px-1.5" />
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] pt-4">
            <input type="checkbox" checked={!!faq.itemShadow} onChange={e => setFaq("itemShadow", e.target.checked || undefined)} /> เงากล่อง
          </label>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-gray-600 mb-1">ตาราง</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TABLE_COLORS.map(([k, label]) => <ColorField key={k} label={label} value={table[k]} onChange={v => setTable(k, v)} />)}
          </div>
        </div>

        <button onClick={() => onChange(undefined)} className="text-[11px] text-rose-500 hover:underline">ล้างหน้าตา FAQ/ตาราง กลับค่าตั้งต้น</button>
      </div>

      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-gray-500 mb-1">พรีวิว (ยังไม่บันทึก)</p>
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <ArticleFrame html={previewHtml} minHeight={320} pageBackground={theme.pageBackground} />
        </div>
      </div>
    </div>
  );
}
