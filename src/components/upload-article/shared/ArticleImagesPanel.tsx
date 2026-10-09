"use client";

/**
 * แผง "รูปในบทความ" (แท็บ Review) — แสดงรูปที่อยู่ในเนื้อหาแล้ว (รูปจากไฟล์ที่อัปโหลด, รูปที่แทรกเอง, รูป AI)
 * แก้ alt ทีละรูป (ส่งแค่ลำดับ + ข้อความ) และตั้งรูปไหนเป็นภาพปกก็ได้
 */

import { useEffect, useMemo, useState } from "react";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listArticleImages } from "@/lib/upload-article/image-alt";

export default function ArticleImagesPanel({
  html,
  coverImageUrl,
  onSaveAlt,
  onSetCover,
}: {
  html: string;
  coverImageUrl: string | null | undefined;
  onSaveAlt: (index: number, alt: string) => Promise<boolean>;
  onSetCover: (src: string, alt: string) => Promise<boolean>;
}) {
  const images = useMemo(() => listArticleImages(html), [html]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => { setDrafts({}); }, [html]);

  if (images.length === 0) return null;

  async function saveAlt(index: number, current: string) {
    const next = (drafts[index] ?? current).trim();
    if (next === current.trim()) return;
    setBusy(index);
    try { await onSaveAlt(index, next); } finally { setBusy(null); }
  }

  async function setCover(index: number, src: string, alt: string) {
    setBusy(index);
    try { await onSetCover(src, (drafts[index] ?? alt).trim()); } finally { setBusy(null); }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-brand-navy flex items-center gap-1.5">
        <Images size={12} /> รูปในบทความ ({images.length})
      </p>
      <p className="text-[11px] text-gray-400">แก้ alt (ชื่อรูป) แล้วคลิกออกจากช่องเพื่อบันทึก</p>
      <div className="space-y-3">
        {images.map(img => {
          const isCurrentCover = img.isCover || (!!coverImageUrl && coverImageUrl === img.src);
          return (
            <div key={img.index} className="space-y-1.5 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.alt} loading="lazy" referrerPolicy="no-referrer"
                className="w-full max-h-40 object-contain rounded-lg border border-gray-200 bg-gray-50" />
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span>รูปที่ {img.index + 1}</span>
                {isCurrentCover && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">ภาพปก</span>}
                {!img.alt && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">ยังไม่มี alt</span>}
              </div>
              <Input value={drafts[img.index] ?? img.alt} disabled={busy === img.index}
                onChange={e => setDrafts(p => ({ ...p, [img.index]: e.target.value }))}
                onBlur={() => void saveAlt(img.index, img.alt)}
                placeholder="Alt text ของรูป" className="text-xs" />
              {!isCurrentCover && (
                <Button size="sm" variant="outline" className="w-full" disabled={busy === img.index}
                  onClick={() => void setCover(img.index, img.src, img.alt)}>
                  ตั้งเป็นภาพปก
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
