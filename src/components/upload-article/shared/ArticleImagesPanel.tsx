"use client";

/**
 * แผง "รูปในบทความ" (แท็บ Review) — แสดงรูปที่อยู่ในเนื้อหาแล้ว (รูปจากไฟล์ที่อัปโหลด, รูปที่แทรกเอง, รูป AI)
 * แก้ alt / ใส่ลิงก์ (กดรูปแล้วไปลิงก์บนเว็บจริง) ทีละรูป (ส่งแค่ลำดับ + ข้อความ) และตั้งรูปไหนเป็นภาพปกก็ได้
 */

import { useEffect, useMemo, useState } from "react";
import { Images, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listArticleImages } from "@/lib/upload-article/image-alt";

export default function ArticleImagesPanel({
  html,
  coverImageUrl,
  onSaveAlt,
  onSaveLink,
  onSetCover,
}: {
  html: string;
  coverImageUrl: string | null | undefined;
  onSaveAlt: (index: number, alt: string) => Promise<boolean>;
  onSaveLink: (index: number, href: string) => Promise<boolean>;
  onSetCover: (src: string, alt: string) => Promise<boolean>;
}) {
  const images = useMemo(() => listArticleImages(html), [html]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => { setDrafts({}); setLinkDrafts({}); }, [html]);

  if (images.length === 0) return null;

  async function saveAlt(index: number, current: string) {
    const next = (drafts[index] ?? current).trim();
    if (next === current.trim()) return;
    setBusy(index);
    try { await onSaveAlt(index, next); } finally { setBusy(null); }
  }

  async function saveLink(index: number, current: string) {
    const next = (linkDrafts[index] ?? current).trim();
    if (next === current.trim()) return;
    if (next && !/^(https?:\/\/|\/)/i.test(next)) {
      toast.error("ลิงก์ต้องขึ้นต้นด้วย https:// หรือ /");
      return;
    }
    setBusy(index);
    try { await onSaveLink(index, next); } finally { setBusy(null); }
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
      <p className="text-[11px] text-gray-400">แก้ alt (ชื่อรูป) หรือใส่ลิงก์ แล้วคลิกออกจากช่องเพื่อบันทึก — รูปที่มีลิงก์ กดบนเว็บแล้วไปที่ลิงก์นั้น</p>
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
                {img.href && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-brand-blue font-semibold">มีลิงก์</span>}
                {!img.alt && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">ยังไม่มี alt</span>}
              </div>
              <Input value={drafts[img.index] ?? img.alt} disabled={busy === img.index}
                onChange={e => setDrafts(p => ({ ...p, [img.index]: e.target.value }))}
                onBlur={() => void saveAlt(img.index, img.alt)}
                placeholder="Alt text ของรูป" className="text-xs" />
              <div className="relative">
                <Link2 size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input value={linkDrafts[img.index] ?? img.href} disabled={busy === img.index}
                  onChange={e => setLinkDrafts(p => ({ ...p, [img.index]: e.target.value }))}
                  onBlur={() => void saveLink(img.index, img.href)}
                  placeholder="ลิงก์เมื่อกดรูป (เว้นว่าง = ไม่มีลิงก์)" className="text-xs pl-7" />
              </div>
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
