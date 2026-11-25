"use client";

/** Comment ของลูกค้าต่อบทความ — hook โหลด/บันทึก + รายการ + กล่องพิมพ์ */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArticleComment, ArticleCommentChange } from "@/lib/upload-article/article-comments";

export function useArticleComments(articleId: string | null) {
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avgCostUsd, setAvgCostUsd] = useState<number | null>(null);
  const [costSamples, setCostSamples] = useState(0);
  const idRef = useRef<string | null>(articleId);
  idRef.current = articleId;
  const commentsRef = useRef<ArticleComment[]>([]);
  commentsRef.current = comments;

  const reload = useCallback(async () => {
    if (!articleId) { setComments([]); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/upload-article/articles/${articleId}/comments`);
      const d = await r.json().catch(() => ({}));
      if (idRef.current !== articleId) return; // ตอบช้า ข้ามเมื่อเปลี่ยนบทความแล้ว
      if (!r.ok) { setError(d?.error || "โหลด Comment ไม่สำเร็จ"); setComments([]); return; }
      setComments(Array.isArray(d.comments) ? d.comments : []);
      setAvgCostUsd(typeof d.avgCostUsd === "number" ? d.avgCostUsd : null);
      setCostSamples(Number(d.costSamples) || 0);
    } catch (e) {
      if (idRef.current === articleId) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (idRef.current === articleId) setLoading(false);
    }
  }, [articleId]);

  useEffect(() => { setComments([]); void reload(); }, [reload]);

  const save = useCallback(async (next: ArticleComment[]): Promise<ArticleComment[] | null> => {
    if (!articleId) return null;
    const prev = commentsRef.current;
    setComments(next);
    try {
      const r = await fetch(`/api/upload-article/articles/${articleId}/comments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "บันทึก Comment ไม่สำเร็จ");
      const stored: ArticleComment[] = Array.isArray(d.comments) ? d.comments : next;
      if (idRef.current === articleId) setComments(stored);
      return stored;
    } catch (e) {
      if (idRef.current === articleId) setComments(prev);
      toast.error(e instanceof Error ? e.message : "บันทึก Comment ไม่สำเร็จ");
      return null;
    }
  }, [articleId]);

  return { comments, loading, error, avgCostUsd, costSamples, save, setComments, reload };
}

const CHANGE_LABEL: Record<ArticleCommentChange["kind"], string> = {
  replace: "แก้ข้อความ",
  insert: "เพิ่มท่อนใหม่",
  delete: "ลบท่อนนี้ออก",
  format: "ปรับรูปแบบ (ข้อความเดิม)",
};

/** สิ่งที่ AI แก้ตาม Comment ข้อนี้รอบล่าสุด: ข้อความเดิม → เปลี่ยนเป็นอะไร */
function CommentChangeCard({ changes, more }: { changes: ArticleCommentChange[]; more: number }) {
  return (
    <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 space-y-2">
      <p className="text-[11px] font-medium text-gray-700">AI ปรับตาม Comment นี้ {changes.length + more} จุด</p>
      {changes.map((ch, i) => (
        <div key={i} className="space-y-1">
          {(changes.length > 1 || ch.kind !== "replace") && (
            <p className="text-[10px] text-gray-500">{changes.length > 1 ? `จุดที่ ${i + 1} · ` : ""}{CHANGE_LABEL[ch.kind]}</p>
          )}
          {ch.kind !== "insert" && ch.kind !== "format" && (
            <ChangeLine label="เดิม" tone="before" lead={ch.lead} text={ch.before} tail={ch.tail}
              empty={ch.kind === "delete" ? NO_TEXT : "(ไม่มีข้อความเดิมตรงจุดนี้)"} />
          )}
          {ch.kind !== "delete" && (
            <ChangeLine label={ch.kind === "insert" ? "เพิ่ม" : ch.kind === "format" ? "ข้อความ" : "เปลี่ยนเป็น"}
              tone={ch.kind === "format" ? "plain" : "after"} lead={ch.lead} text={ch.after} tail={ch.tail}
              empty={ch.kind === "replace" ? "(ตัดข้อความท่อนนี้ออก)" : NO_TEXT} />
          )}
        </div>
      ))}
      {more > 0 && <p className="text-[10px] text-gray-500">และอีก {more} จุด — ดูในบทความ</p>}
    </div>
  );
}

const NO_TEXT = "(ท่อนที่ไม่มีข้อความ เช่น รูปหรือตาราง)";

function ChangeLine({ label, tone, lead, text, tail, empty }: {
  label: string; tone: "before" | "after" | "plain"; lead?: string; text?: string; tail?: string; empty: string;
}) {
  const mark = tone === "before" ? "bg-red-50 text-red-700 line-through"
    : tone === "after" ? "bg-emerald-50 text-emerald-700" : "text-gray-800";
  return (
    <div className="flex items-start gap-2 text-[11px] leading-relaxed">
      <span className="w-16 shrink-0 text-gray-500">{label}</span>
      <p className="min-w-0 flex-1 break-words text-gray-500">
        {text ? (
          <>{lead}<span className={`rounded px-0.5 ${mark}`}>{text}</span>{tail}</>
        ) : (
          <span className="text-gray-400">{empty}</span>
        )}
      </p>
    </div>
  );
}

export function ArticleCommentList({ comments, onChange, disabled, selectable }: {
  comments: ArticleComment[];
  onChange: (next: ArticleComment[]) => void;
  disabled?: boolean;
  selectable?: { selectedIds: Set<string>; onToggle: (id: string) => void };
}) {
  if (!comments.length) return <p className="text-xs text-gray-400 text-center py-3">ยังไม่มี Comment ของบทความนี้</p>;
  const patch = (id: string, change: Partial<ArticleComment>) =>
    onChange(comments.map(c => (c.id === id ? { ...c, ...change } : c)));
  return (
    <div className={`${comments.some(c => c.changes?.length) ? "max-h-[28rem]" : "max-h-64"} overflow-y-auto space-y-1.5`}>
      {comments.map(c => {
        const checked = selectable ? selectable.selectedIds.has(c.id) : c.enabled && !c.appliedAt;
        return (
          <div key={c.id} className="flex items-start gap-2 border border-gray-100 rounded-lg px-2.5 py-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={checked}
              disabled={disabled || (!selectable && !!c.appliedAt)}
              onChange={() => {
                if (selectable) selectable.onToggle(c.id);
                else patch(c.id, { enabled: !c.enabled });
              }}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="whitespace-pre-wrap break-words max-h-24 overflow-y-auto text-gray-800">{c.text}</p>
              {c.quote && <p className="text-[11px] text-gray-500 line-clamp-2">ตรงข้อความ: “{c.quote}”</p>}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {c.source === "import" ? "จากไฟล์ต้นฉบับ" : "พิมพ์เอง"}
                </span>
                {c.appliedAt && (
                  <>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">ปรับแล้ว</span>
                    <button type="button" disabled={disabled} className="text-[10px] text-brand-blue hover:underline disabled:opacity-50"
                      onClick={() => patch(c.id, { appliedAt: undefined, enabled: true })}>
                      ใช้อีกครั้ง
                    </button>
                  </>
                )}
              </div>
              {c.changes && c.changes.length > 0 && <CommentChangeCard changes={c.changes} more={c.moreChanges ?? 0} />}
            </div>
            <button type="button" aria-label="ลบ Comment" disabled={disabled}
              className="text-gray-400 hover:text-red-600 disabled:opacity-50 shrink-0"
              onClick={() => onChange(comments.filter(x => x.id !== c.id))}>
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function CommentDraftBox({ value, onChange, onAdd, disabled, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onAdd?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <textarea
        rows={3}
        maxLength={4000}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "วาง Comment ของลูกค้าสำหรับบทความนี้ เช่น “ย่อหน้าแรกขอให้สั้นลง” “เพิ่มราคาเริ่มต้น 990 บาท”"}
        className="w-full text-xs border border-gray-200 rounded-lg p-2.5 bg-white"
      />
      {onAdd && (
        <Button size="sm" variant="outline" disabled={disabled || !value.trim()} onClick={onAdd}>
          เพิ่ม Comment
        </Button>
      )}
    </div>
  );
}
