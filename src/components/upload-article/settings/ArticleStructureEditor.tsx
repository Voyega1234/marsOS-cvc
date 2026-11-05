"use client";

/**
 * โครงบทความ + รายการอ้างอิง — แก้ detail.structure / detail.references ของธีม (ยังไม่บันทึกจนกดบันทึกธีม)
 * สวิตช์แต่ละตัวเขียนเฉพาะคีย์ของตัวเอง; ไม่แตะ = ไม่มีคีย์ structure (โปรเจกต์เก่าทำงานเหมือนเดิม)
 */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UploadArticleStructure, UploadReference, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

const MAX_REFS = 40;

type ToggleKey = "toc" | "takeaways" | "faqPlain" | "conclusionBeforeFaq" | "references" | "latinThaiSpacing";

const TOGGLES: Array<[ToggleKey, string, boolean]> = [
  ["toc", "ใส่สารบัญ", true],
  ["takeaways", "ใส่กล่องสรุป", true],
  ["faqPlain", "FAQ แบบเปิดตลอด ไม่มีกรอบ", false],
  ["conclusionBeforeFaq", "มีหัวข้อสรุปก่อน FAQ", false],
  ["references", "ใส่หัวข้ออ้างอิง", false],
  ["latinThaiSpacing", "เว้นวรรคระหว่างอังกฤษกับไทย", false],
];

export default function ArticleStructureEditor({ theme, onChange }: { theme: UploadTheme; onChange: (detail: UploadThemeDetail | undefined) => void }) {
  const detail = theme.detail || {};
  const structure = detail.structure || {};
  const refs = detail.references || [];
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  function emit(next: UploadThemeDetail) {
    onChange(Object.keys(next).length ? next : undefined);
  }
  function setToggle(key: ToggleKey, on: boolean) {
    const next: UploadThemeDetail = { ...detail, structure: { ...structure, [key]: on } };
    if (key === "faqPlain" && on) next.faq = { ...(detail.faq || {}), display: "open", layout: "plain" };
    emit(next);
  }
  function setRefsTitle(v: string) {
    const st: UploadArticleStructure = { ...structure };
    if (v.trim()) st.referencesTitle = v; else delete st.referencesTitle;
    emit({ ...detail, structure: st });
  }
  function setRefs(list: UploadReference[]) {
    const next: UploadThemeDetail = { ...detail };
    if (list.length) next.references = list; else delete next.references;
    emit(next);
  }
  function addRef() {
    const t = title.trim();
    const u = url.trim();
    if (!t) { setErr("กรอกชื่อแหล่งอ้างอิง"); return; }
    if (!/^https:\/\/\S+$/i.test(u)) { setErr("ลิงก์ต้องขึ้นต้นด้วย https://"); return; }
    if (refs.length >= MAX_REFS) { setErr(`เพิ่มได้สูงสุด ${MAX_REFS} รายการ`); return; }
    setErr("");
    setRefs([...refs, { title: t, url: u, from: "team" }]);
    setTitle(""); setUrl("");
  }
  function clearScanned() {
    if (!window.confirm("ล้างหน้าตาที่สแกนมา (ฟอนต์จริง โครงบทความ และรายการอ้างอิง)? หน้าตา FAQ และตารางไม่ถูกลบ ต้องกดบันทึกธีมจึงจะมีผลจริง")) return;
    const next: UploadThemeDetail = { ...detail };
    delete next.article; delete next.structure; delete next.references;
    emit(next);
  }

  const hasScanned = !!(detail.article || detail.structure || detail.references);
  const refsOn = structure.references === true;

  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-3">
      <p className="text-xs font-semibold text-gray-600">โครงบทความ</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {TOGGLES.map(([key, label, def]) => (
          <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={structure[key] ?? def} onChange={e => setToggle(key, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <label className="block text-[11px] font-semibold text-gray-500">ข้อความหัวส่วนอ้างอิง</label>
        <Input value={structure.referencesTitle || ""} onChange={e => setRefsTitle(e.target.value)} placeholder="อ้างอิง" className="text-xs h-8 max-w-xs" />

        <p className="text-[11px] font-semibold text-gray-500">รายการอ้างอิง ({refs.length}/{MAX_REFS})</p>
        {refsOn && refs.length === 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">ยังไม่มีรายการอ้างอิง บทความจะไม่มีหัวข้ออ้างอิง</p>
        )}
        {refs.length > 0 && (
          <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {refs.map((r, i) => (
              <li key={`${r.url}-${i}`} className="flex items-center gap-2 text-xs border border-gray-100 rounded px-2 py-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-navy truncate">{r.title}</p>
                  <p className="text-[11px] text-gray-500 truncate">{r.url}</p>
                </div>
                <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-[10px] text-gray-600">{r.from === "team" ? "ทีมเพิ่ม" : "จากเว็บ"}</span>
                <button type="button" aria-label={`ลบ ${r.title}`} onClick={() => setRefs(refs.filter((_, j) => j !== i))} className="shrink-0 text-gray-400 hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="ชื่อแหล่งอ้างอิง" className="text-xs h-8" />
          <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="text-xs h-8" />
          <Button type="button" size="sm" variant="outline" onClick={addRef} disabled={refs.length >= MAX_REFS} className="h-8">เพิ่มรายการ</Button>
        </div>
        {err && <p className="text-[11px] text-red-600">{err}</p>}
        <p className="text-[11px] text-gray-400">ระบบไม่แต่งอ้างอิงเอง ตัวเขียนเลือกจากรายการนี้เท่านั้น ควรตรวจว่าลิงก์ตรงกับเนื้อหา</p>
      </div>

      {hasScanned && (
        <Button type="button" size="sm" variant="outline" onClick={clearScanned} className="h-8 text-red-600">ล้างหน้าตาที่สแกนมา</Button>
      )}
    </div>
  );
}
