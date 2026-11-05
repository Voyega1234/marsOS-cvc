"use client";

/**
 * ฟอนต์ที่บทความใช้ + ไฟล์ของแต่ละตัว — ฟอนต์ที่ระบบหาไฟล์ไม่เจอ ทีมวางลิงก์ไฟล์เองได้
 * มีผลแค่พรีวิว/ไฟล์ดาวน์โหลด บนเว็บจริงธีมของเว็บโหลดฟอนต์เองอยู่แล้ว
 */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  articleFontStacks, FONT_FACE_MAX, fontCoverage, fontFaceLoadable, proxiedFontUrl, type FontStatus,
} from "@/lib/upload-article/font-faces";
import type { UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

const STATUS: Record<FontStatus, (files: number) => string> = {
  site: (n) => `จากเว็บลูกค้า ${n} ไฟล์`,
  google: (n) => `จาก Google Fonts ${n} ไฟล์`,
  missing: () => "ไม่พบไฟล์ พรีวิวจะใช้ตัวสำรอง",
};

export default function ArticleFontEditor({ theme, onChange }: { theme: UploadTheme; onChange: (detail: UploadThemeDetail | undefined) => void }) {
  const article = theme.detail?.article;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  if (!article) return null;
  const rows = fontCoverage(articleFontStacks(article), article.fontFaces);
  if (!rows.length) return null;
  const faces = article.fontFaces || [];

  function setFaces(next: typeof faces) {
    if (!article) return;
    onChange({ ...theme.detail, article: { ...article, fontFaces: next.length ? next : undefined } });
  }

  async function addFile(family: string) {
    const url = (urls[family] || "").trim();
    const fail = (msg: string) => setErrs((p) => ({ ...p, [family]: msg }));
    if (!fontFaceLoadable({ family, url })) return fail("ต้องเป็นลิงก์ https ที่ลงท้ายด้วย .woff2 .woff .ttf หรือ .otf");
    if (faces.length >= FONT_FACE_MAX) return fail(`เก็บไฟล์ฟอนต์ได้สูงสุด ${FONT_FACE_MAX} ไฟล์`);
    setBusy(family);
    setErrs((p) => ({ ...p, [family]: "" }));
    try {
      const res = await fetch(proxiedFontUrl(url));
      if (!res.ok) return fail("เปิดไฟล์นี้ไม่ได้ หรือไม่ใช่ไฟล์ฟอนต์");
      setFaces([...faces, { family, url, from: "team" }]);
      setUrls((p) => ({ ...p, [family]: "" }));
    } catch {
      fail("เปิดไฟล์นี้ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-600">ฟอนต์ที่บทความใช้</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.family} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-brand-navy break-all">{r.family}</span>
              <span className={r.status === "missing" ? "text-amber-700" : "text-emerald-700"}>{STATUS[r.status](r.files)}</span>
              {r.files > 0 && (
                <button type="button" aria-label={`ลบไฟล์ของ ${r.family}`} title="ลบไฟล์ของฟอนต์นี้ (สแกนใหม่ได้เสมอ)"
                  onClick={() => setFaces(faces.filter((f) => f.family.trim().toLowerCase() !== r.family.toLowerCase()))}
                  className="ml-auto shrink-0 text-gray-400 hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {r.status === "missing" && (
              <div className="mt-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <Input value={urls[r.family] || ""} placeholder="https://.../font.woff2" aria-label={`ลิงก์ไฟล์ฟอนต์ ${r.family}`}
                  onChange={(e) => setUrls((p) => ({ ...p, [r.family]: e.target.value }))} className="text-xs h-8" />
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy === r.family} onClick={() => addFile(r.family)}>
                  {busy === r.family ? "กำลังเช็ค..." : "ใช้ไฟล์นี้"}
                </Button>
              </div>
            )}
            {errs[r.family] && <p className="mt-1 text-[11px] text-red-600">{errs[r.family]}</p>}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-400">ระบบหาไฟล์ให้เองจาก CSS ของเว็บและ Google Fonts ฟอนต์ที่หาไม่เจอไม่กระทบเว็บจริง เพราะเว็บโหลดฟอนต์ของตัวเองอยู่แล้ว ต้องกดบันทึกธีมจึงจะมีผล</p>
    </div>
  );
}
