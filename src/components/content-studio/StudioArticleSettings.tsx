"use client";

/**
 * Content Studio > ตั้งค่าบทความ — รูปภาพ / CTA / Author Box
 * ใช้ editor ชุดเดียวกับ Upload Article (components/upload-article/settings/*) บันทึกที่ /api/studio/article-settings
 * ค่าเป็นระดับ studio (ใช้ร่วมกันทุกเครื่อง) — ตอนเขียนบทความ /api/article/write อ่านเอง ไม่ต้องส่งไปกับ request
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Loader2, Megaphone, UserRound } from "lucide-react";
import { CtaSettingsEditor } from "@/components/upload-article/settings/CtaSection";
import { AuthorSettingsEditor } from "@/components/upload-article/settings/AuthorSection";
import { ImageSettingsEditor } from "@/components/upload-article/settings/ImagesSection";
import { readArticleImageSettings, type ArticleImageSettings, type StudioArticleSettings as StudioSettingsValue } from "@/lib/article-settings";
import type { UploadCtaSettings } from "@/lib/upload-article/cta";
import type { UploadAuthorSettings } from "@/lib/upload-article/author";

type Section = "images" | "cta" | "author";

const SECTIONS: { id: Section; label: string; icon: typeof ImageIcon }[] = [
  { id: "images", label: "รูปภาพ", icon: ImageIcon },
  { id: "cta", label: "CTA", icon: Megaphone },
  { id: "author", label: "Author Box", icon: UserRound },
];

const SETTINGS_URL = "/api/studio/article-settings";

async function loadSettings(): Promise<StudioSettingsValue> {
  const r = await fetch(SETTINGS_URL);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "โหลดค่าตั้งค่าไม่สำเร็จ");
  return d as StudioSettingsValue;
}

async function putSection(section: Section, value: unknown): Promise<unknown> {
  const r = await fetch(SETTINGS_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, value }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (r.status === 403 ? "ไม่มีสิทธิ์แก้ค่าตั้งค่า Studio" : "บันทึกไม่สำเร็จ"));
  return d;
}

function ImagesPane() {
  const [saved, setSaved] = useState<ArticleImageSettings | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then(d => { if (!cancelled) setSaved(readArticleImageSettings(d.images)); })
      .catch(e => toast.error(e instanceof Error ? e.message : "โหลดค่ารูปภาพไม่สำเร็จ"));
    return () => { cancelled = true; };
  }, []);
  if (!saved) {
    return <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> กำลังโหลด...</p>;
  }
  return (
    <ImageSettingsEditor
      saved={saved}
      autoOption
      intro="ตั้งค่ารูปปกและรูปประกอบที่ระบบสร้างให้ตอนเขียนบทความใน Content Studio"
      save={async draft => {
        const d = (await putSection("images", draft)) as ArticleImageSettings;
        setSaved(d);
        return d;
      }}
    />
  );
}

export default function StudioArticleSettings({ accentColor, border }: { accentColor: string; border: string }) {
  const [active, setActive] = useState<Section>("images");

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* มือถือ: แถบเลื่อนแนวนอน */}
      <div className="md:hidden -mx-1 px-1 overflow-x-auto">
        <div className="flex gap-1.5 pb-1 w-max">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors ${
                active === s.id ? "bg-brand-mist text-brand-blue border-brand-soft/60" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}>
              <s.icon size={13} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* จอใหญ่: เมนูแนวตั้งด้านซ้าย */}
      <div className="hidden md:block w-52 shrink-0">
        <div className="space-y-1 sticky top-4">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                active === s.id ? "bg-brand-mist text-brand-blue" : "text-gray-500 hover:bg-gray-50 hover:text-brand-navy"
              }`}>
              <s.icon size={15} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {active === "images" && <ImagesPane />}
        {active === "cta" && (
          <CtaSettingsEditor
            loadKey="studio"
            load={async () => (await loadSettings()).cta}
            save={async slim => (await putSection("cta", slim)) as UploadCtaSettings}
            accentColor={accentColor}
            border={border}
            description="CTA จะถูกแทรกในบทความอัตโนมัติทุกครั้งที่เขียนใน Content Studio (เมื่อเปิดใช้งาน) — มีหลายแบบได้ ระบบสุ่มใช้ต่อบทความ"
          />
        )}
        {active === "author" && (
          <AuthorSettingsEditor
            loadKey="studio"
            load={async () => (await loadSettings()).author}
            save={async slim => (await putSection("author", slim)) as UploadAuthorSettings}
            description="แนบการ์ดผู้เขียนท้ายบทความที่เขียนใน Content Studio — มีหลายคนได้ เลือกคนแรกหรือสุ่มต่อบทความ"
          />
        )}
      </div>
    </div>
  );
}
