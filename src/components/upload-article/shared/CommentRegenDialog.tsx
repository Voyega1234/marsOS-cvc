"use client";

/** กล่อง Re-generate ตาม Comment ของลูกค้า — เลือก Comment + พิมพ์เพิ่ม แล้วให้ AI แก้เฉพาะจุด */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArticleCommentList, CommentDraftBox, useArticleComments } from "./ArticleComments";

export default function CommentRegenDialog({ articleId, pushed, busy, onRun, onClose }: {
  articleId: string;
  pushed: boolean;
  busy: boolean;
  onRun: (opts: { commentIds: string[]; extraText: string }) => void;
  onClose: () => void;
}) {
  const { comments, loading, avgCostUsd, costSamples, save } = useArticleComments(articleId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const initialised = useRef(false);

  // เลือก Comment ที่ยังไม่ปรับให้ครั้งแรกหลังโหลดเสร็จ
  useEffect(() => {
    if (initialised.current || loading) return;
    if (!comments.length) return;
    initialised.current = true;
    setSelectedIds(new Set(comments.filter(c => c.enabled && !c.appliedAt).map(c => c.id)));
  }, [comments, loading]);

  const valid = new Set(comments.map(c => c.id));
  const commentIds = Array.from(selectedIds).filter(id => valid.has(id));
  const canRun = !busy && (commentIds.length > 0 || extra.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white/95 rounded-3xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[70vh] overflow-y-auto">
        <p className="text-sm font-bold text-brand-navy">Re-generate ตาม Comment ของลูกค้า</p>
        <p className="text-xs text-gray-600">เลือก Comment หรือพิมพ์เพิ่ม AI จะแก้เฉพาะจุดที่ Comment สั่ง แล้วสร้าง HTML ใหม่</p>
        {loading && !comments.length ? (
          <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> กำลังโหลด...</p>
        ) : (
          <ArticleCommentList
            comments={comments}
            disabled={busy}
            onChange={next => { void save(next); }}
            selectable={{
              selectedIds,
              onToggle: id => setSelectedIds(prev => {
                const n = new Set(prev);
                if (n.has(id)) n.delete(id); else n.add(id);
                return n;
              }),
            }}
          />
        )}
        <CommentDraftBox value={extra} onChange={setExtra} disabled={busy} placeholder="พิมพ์ Comment เพิ่มสำหรับรอบนี้ (ไม่บังคับ)" />
        <div className="text-xs text-gray-600 space-y-1 bg-gray-50 rounded-lg p-3">
          <p>
            {avgCostUsd != null
              ? `เสียค่าใช้จ่าย AI ประมาณ $${avgCostUsd.toFixed(2)} ต่อครั้ง (เฉลี่ยจาก ${costSamples} งานล่าสุด)`
              : "เสียค่าใช้จ่าย AI (ยังไม่มีสถิติค่าใช้จ่าย)"}
          </p>
          <p>แก้เฉพาะเนื้อหา — ชื่อเรื่อง SEO title meta description และ slug ไม่เปลี่ยน</p>
          <p>ย้อนกลับได้ 1 ขั้นด้วยปุ่มย้อนกลับ</p>
          <p>ที่แก้มือในโหมดแก้ไขของหน้า Review จะหาย เพราะสร้าง HTML ใหม่จากต้นฉบับ (เหมือนปุ่ม Re-generate)</p>
          {pushed && <p>บทความบนเว็บยังเป็นเวอร์ชันเดิมจนกว่าจะกด ผ่าน Review แล้ว Re-push</p>}
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <Button size="sm" disabled={!canRun} onClick={() => onRun({ commentIds, extraText: extra.trim() })}>
            {busy && <Loader2 size={12} className="animate-spin mr-1.5" />}
            ปรับตาม Comment แล้ว Re-generate
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        </div>
      </div>
    </div>
  );
}
