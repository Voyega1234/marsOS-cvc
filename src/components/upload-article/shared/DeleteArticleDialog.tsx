"use client";

/** ยืนยันลบบทความ (ใช้ร่วม Import / Review / Push) — ลบเฉพาะแถวในระบบ ไม่ลบโพสต์บนเว็บไซต์ */
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { UploadArticleDTO } from "@/lib/upload-article/types";
import { duplicatesOf } from "@/lib/upload-article/duplicates";
import UploadStatusBadge from "@/components/upload-article/shared/StatusBadge";

const DATE_FMT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", DATE_FMT);
}

export default function DeleteArticleDialog({
  article, allArticles, onClose, onDeleted,
}: {
  article: UploadArticleDTO | null;
  allArticles: UploadArticleDTO[];
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const isPushed = Boolean(article && (article.wordpressPostId || article.pushedAt));
  const duplicates = article ? duplicatesOf(article, allArticles) : [];

  // แถว push ล่าสุดในกลุ่มซ้ำ (รวมแถวที่กำลังจะลบ) = ตรงกับหน้าเว็บตอนนี้
  const latestPushedId = (() => {
    if (!article) return null;
    let best: UploadArticleDTO | null = null;
    for (const r of [article, ...duplicates]) {
      if (!r.pushedAt) continue;
      if (!best || new Date(r.pushedAt).getTime() > new Date(best.pushedAt as string).getTime()) best = r;
    }
    return best?.id ?? null;
  })();
  const deletingLatest = Boolean(article && latestPushedId === article.id);

  async function confirmDelete() {
    if (!article) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/upload-article/articles/${article.id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error(d?.error || "ลบไม่สำเร็จ");
        return;
      }
      onDeleted(article.id);
      toast.success("ลบบทความแล้ว");
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(false);
      onClose();
    }
  }

  return (
    <Dialog open={!!article} onOpenChange={v => !v && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>ลบบทความนี้?</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">"{article?.title}" จะถูกลบออกจากระบบถาวร — ยืนยันหรือไม่?</p>

        {isPushed && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ลบเฉพาะแถวในระบบ — โพสต์บนเว็บไซต์จะไม่ถูกลบ
          </p>
        )}

        {article && duplicates.length > 0 && (
          <div className="space-y-2">
            <div className="rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-2 text-xs text-gray-600">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-rose-700">แถวที่จะลบ</span>
                <UploadStatusBadge status={article.status} />
                <span>{article.pushedAt ? `push ${fmtDate(article.pushedAt)}` : "ยังไม่ push"}</span>
                <span className="text-gray-400">· สร้าง {fmtDate(article.createdAt)}</span>
              </div>
              {deletingLatest && (
                <p className="mt-1 font-medium text-emerald-700">push ล่าสุด — ตรงกับหน้าเว็บตอนนี้</p>
              )}
            </div>
            <p className="text-xs font-semibold text-gray-600">แถวซ้ำที่จะยังอยู่:</p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto">
              {duplicates.map(d => (
                <li key={d.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <UploadStatusBadge status={d.status} />
                    <span>{d.pushedAt ? `push ${fmtDate(d.pushedAt)}` : "ยังไม่ push"}</span>
                    <span className="text-gray-400">· สร้าง {fmtDate(d.createdAt)}</span>
                  </div>
                  {latestPushedId === d.id && (
                    <p className="mt-1 font-medium text-emerald-700">push ล่าสุด — ตรงกับหน้าเว็บตอนนี้</p>
                  )}
                </li>
              ))}
            </ul>
            {deletingLatest && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                แถวนี้คือเวอร์ชันที่อยู่บนเว็บตอนนี้ — ถ้าลบ ให้ Re-push แถวที่เหลือเพื่อให้หน้าเว็บตรงกับ Review
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={onClose}>ยกเลิก</Button>
          <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
            {deleting ? "กำลังลบ..." : "ลบบทความ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
