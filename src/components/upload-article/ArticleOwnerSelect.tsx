"use client";

/**
 * Dropdown เล็ก ๆ เลือกผู้ดูแลบทความ (ownerTags ตั้งที่หน้า Report) — ใช้ร่วมกันใน Report / นำเข้า / Publish
 * อัปเดตแบบ optimistic: เปลี่ยนค่าในหน้าทันที แล้วค่อยบันทึกผ่าน PATCH /articles/[id]/owner (พลาด = คืนค่าเดิม + toast)
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { UploadOwnerTag } from "@/lib/upload-article/types";

/** ชุดข้อมูล + callback ที่ workspace ส่งลงแท็บต่าง ๆ (ไม่ส่ง = ไม่แสดงตัวเลือกผู้ดูแล เช่นโหมด PBN) */
export interface OwnerControls {
  ownerTags: UploadOwnerTag[];
  /** articleId → ownerTag.id */
  articleOwners: Record<string, string>;
  /** ตั้ง/ล้างผู้ดูแลของบทความใน state กลาง (tagId = null คือล้าง) */
  onOwnerChange: (articleId: string, tagId: string | null) => void;
  goToReport?: () => void;
}

export default function ArticleOwnerSelect({
  articleId, ownerTags, ownerTagId, onChange, goToReport, emptyHint = "เพิ่มผู้ดูแลที่แท็บ Report", saveUrl,
}: {
  articleId: string;
  ownerTags: UploadOwnerTag[];
  /** ผู้ดูแลปัจจุบันของบทความ (undefined = ยังไม่ระบุ) */
  ownerTagId: string | undefined;
  /** อัปเดต state กลางของ workspace (tagId = null คือล้างผู้ดูแล) */
  onChange: (articleId: string, tagId: string | null) => void;
  /** ไปแท็บ Report (ไว้พาไปเพิ่มชื่อผู้ดูแลเมื่อยังไม่มีรายชื่อ) */
  goToReport?: () => void;
  /** ข้อความตอนยังไม่มีรายชื่อผู้ดูแล */
  emptyHint?: string;
  /** URL สำหรับ PATCH ผู้ดูแล (ไม่ส่ง = ใช้ endpoint ของ Upload Article) — SEO SME ส่ง /api/articles/[id]/owner */
  saveUrl?: string;
}) {
  const [saving, setSaving] = useState(false);

  if (ownerTags.length === 0) {
    return goToReport ? (
      <button type="button" onClick={e => { e.stopPropagation(); goToReport(); }}
        className="text-[10px] text-gray-400 hover:text-brand-blue underline">
        {emptyHint}
      </button>
    ) : (
      <span className="text-[10px] text-gray-400">{emptyHint}</span>
    );
  }

  // ค่าที่ชี้ไป tag ที่ถูกลบแล้ว = ถือว่ายังไม่ระบุ
  const current = ownerTagId && ownerTags.some(t => t.id === ownerTagId) ? ownerTagId : "";

  async function change(next: string) {
    const nextId = next || null;
    const prevId = current || null;
    if (nextId === prevId) return;
    onChange(articleId, nextId);
    setSaving(true);
    try {
      const r = await fetch(saveUrl ?? `/api/upload-article/articles/${articleId}/owner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerTagId: nextId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        onChange(articleId, prevId);
        toast.error(d?.error || "บันทึกผู้ดูแลไม่สำเร็จ");
      }
    } catch (e) {
      onChange(articleId, prevId);
      toast.error(`บันทึกผู้ดูแลไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <select
        value={current}
        onChange={e => void change(e.target.value)}
        title="ผู้ดูแลบทความ"
        className={`h-6 max-w-[9rem] rounded-full border px-2 text-[11px] font-medium bg-white ${
          current ? "border-brand-soft/60 text-brand-blue" : "border-gray-200 text-gray-400"
        }`}
      >
        <option value="">— ผู้ดูแล —</option>
        {ownerTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {saving && <Loader2 size={11} className="animate-spin text-gray-400" />}
    </span>
  );
}
