"use client";

/**
 * Project Setting > รูปภาพ — ค่าเริ่มต้นตอนสร้างรูปบทความ (ปก + รูปประกอบ)
 * โมเดลรูปเป็นตัวเดียวกับหน้า Clients (callGeminiImage) — ส่วน prompt + ภาพตัวอย่าง 3-5 รูปตั้งใน Content Engine > Image Prompt
 */
import { useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_UPLOAD_IMAGE_DEFAULTS, UPLOAD_MAX_INLINE_IMAGES,
  type UploadClientDTO, type UploadImageDefaults,
} from "@/lib/upload-article/types";

function TextChoice({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
      {[{ v: true, l: "มีตัวหนังสือ" }, { v: false, l: "ภาพล้วน ไม่มีตัวหนังสือ" }].map(o => (
        <button key={String(o.v)} type="button" disabled={disabled} onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 ${value === o.v ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"} disabled:opacity-40`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

/** inlineCount null = "ตาม Image Prompt" (ใช้เฉพาะ SEO SME / Studio ที่ส่ง autoOption มา) */
export interface ImageSettingsValue {
  cover: boolean;
  coverWithText: boolean;
  inlineCount: number | null;
  inlineWithText: boolean;
}

/**
 * ตัวแก้ค่ารูปภาพ (ไม่ผูกที่เก็บ) — Upload Article / PBN ใช้ผ่าน ImagesSection ด้านล่าง,
 * SEO SME (Article Lab) และ Content Studio ใช้ตัวเดียวกันโดยส่ง saved/save ของตัวเองมา
 */
export function ImageSettingsEditor<T extends ImageSettingsValue>({ saved, save: persist, openEngine, intro, autoOption }: {
  saved: T;
  /** คืนค่าที่บันทึกจริง (ถ้ามี) — error ให้ throw Error(ข้อความ) */
  save: (draft: T) => Promise<T | void>;
  openEngine?: () => void;
  intro?: React.ReactNode;
  /** แสดงปุ่ม "ตาม Image Prompt" (inlineCount = null) */
  autoOption?: boolean;
}) {
  const [draft, setDraft] = useState<T>(saved);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try {
      let d: T | void;
      try {
        d = await persist(draft);
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : "บันทึกไม่สำเร็จ");
        return;
      }
      if (d) setDraft(d);
      toast.success("บันทึกค่ารูปภาพแล้ว");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-1.5">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><ImageIcon size={14} /> รูปภาพบทความ</p>
        <p className="text-xs text-gray-500">
          {intro ?? "ใช้โมเดลสร้างรูปตัวเดียวกับหน้า Clients · Prompt และภาพตัวอย่าง 3-5 รูปที่ใช้เป็นไกด์ ตั้งที่ Content Engine > Image Prompt"}
        </p>
        {openEngine && (
          <button type="button" onClick={openEngine} className="text-xs text-blue-600 hover:underline">ไปตั้ง Image Prompt / ภาพตัวอย่าง →</button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" checked={draft.cover} onChange={e => setDraft({ ...draft, cover: e.target.checked })} />
          สร้างรูปปก (featured image)
        </label>
        <div className="pl-6 space-y-1">
          <p className="text-xs text-gray-500">แบบรูปปก</p>
          <TextChoice value={draft.coverWithText} disabled={!draft.cover} onChange={v => setDraft({ ...draft, coverWithText: v })} />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-gray-800">รูปประกอบในบทความ</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">จำนวน</span>
          {autoOption && (
            <button type="button" onClick={() => setDraft({ ...draft, inlineCount: null })}
              className={`h-8 px-2.5 rounded-lg border text-xs ${draft.inlineCount === null ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
              ตาม Image Prompt
            </button>
          )}
          {Array.from({ length: UPLOAD_MAX_INLINE_IMAGES + 1 }, (_, n) => (
            <button key={n} type="button" onClick={() => setDraft({ ...draft, inlineCount: n })}
              className={`w-8 h-8 rounded-lg border text-xs ${draft.inlineCount === n ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
              {n}
            </button>
          ))}
          <span className="text-xs text-gray-400">รูป (วางใต้หัวข้อ H2 กระจายทั้งบทความ ไม่วางในส่วน FAQ)</span>
        </div>
        {autoOption && draft.inlineCount === null && (
          <p className="text-[11px] text-gray-400">ตาม Image Prompt = ใช้บรรทัด &quot;จำนวนรูปประกอบ: N&quot; ใน Content Engine &gt; Image Prompt (ไม่มีบรรทัดนี้ = 1 รูป)</p>
        )}
        <div className="space-y-1">
          <p className="text-xs text-gray-500">แบบรูปประกอบ</p>
          <TextChoice value={draft.inlineWithText} disabled={draft.inlineCount === 0} onChange={v => setDraft({ ...draft, inlineWithText: v })} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 size={12} className="mr-1.5 animate-spin" />} บันทึก
        </Button>
        {dirty && <span className="text-xs text-amber-600">ยังไม่ได้บันทึก</span>}
      </div>
    </div>
  );
}

export default function ImagesSection({ client, setClient, openEngine }: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  openEngine: () => void;
}) {
  const saved = client.pushPrefs.imageDefaults ?? DEFAULT_UPLOAD_IMAGE_DEFAULTS;
  return (
    <ImageSettingsEditor<UploadImageDefaults>
      saved={saved}
      openEngine={openEngine}
      save={async (draft) => {
        const r = await fetch(`/api/upload-article/clients/${client.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pushPrefs: { imageDefaults: draft } }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "บันทึกไม่สำเร็จ");
        setClient(d);
        return d?.pushPrefs?.imageDefaults;
      }}
    />
  );
}
