"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FunnelBadge } from "@/components/shared/FunnelBadge";
import { formatDate } from "@/lib/utils";
import { CheckCircle, XCircle, MessageSquare, ExternalLink, ChevronDown, Loader2 } from "lucide-react";

interface ArticleItem {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  updatedAt: Date;
  project: { id: string; name: string };
  keyword?: { keyword: string } | null;
  assignedTo?: { name: string | null } | null;
  reviewer?: { name: string | null } | null;
  reviews: { seoScore?: number | null; aeoScore?: number | null }[];
}

interface Props {
  articles: ArticleItem[];
}

const GROUP_META: Record<string, { label: string; approveStatus: string; rejectStatus: string; approveLabel: string; rejectLabel: string }> = {
  OUTLINE_DONE:     { label: "Outline รอ Approve", approveStatus: "OUTLINE_APPROVED", rejectStatus: "NEW",               approveLabel: "Approve Outline", rejectLabel: "ส่งกลับแก้" },
  OUTLINE_APPROVED: { label: "Outline อนุมัติแล้ว — รอเขียน", approveStatus: "OUTLINE_APPROVED", rejectStatus: "NEW",   approveLabel: "—",               rejectLabel: "—" },
  SEO_REVIEW:       { label: "รอตรวจ SEO",          approveStatus: "APPROVED",         rejectStatus: "REVISION_REQUIRED", approveLabel: "Approve บทความ",  rejectLabel: "ต้องแก้ไข" },
  REVISION_REQUIRED:{ label: "ต้องแก้ไข",            approveStatus: "SEO_REVIEW",       rejectStatus: "REVISION_REQUIRED", approveLabel: "ส่ง Review ใหม่", rejectLabel: "—" },
};

export function ReviewQueueClient({ articles }: Props) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, "approve" | "reject" | null>>({});

  const groups = {
    OUTLINE_DONE:      articles.filter((a) => a.status === "OUTLINE_DONE"),
    SEO_REVIEW:        articles.filter((a) => a.status === "SEO_REVIEW"),
    REVISION_REQUIRED: articles.filter((a) => a.status === "REVISION_REQUIRED"),
    OUTLINE_APPROVED:  articles.filter((a) => a.status === "OUTLINE_APPROVED"),
  };

  async function doAction(article: ArticleItem, type: "approve" | "reject") {
    const meta = GROUP_META[article.status];
    if (!meta) return;
    const newStatus = type === "approve" ? meta.approveStatus : meta.rejectStatus;
    if (newStatus === "—" || newStatus === article.status) return;

    setLoading((p) => ({ ...p, [article.id]: type }));
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();

      // Save comment if any
      const note = notes[article.id]?.trim();
      if (note) {
        await fetch(`/api/articles/${article.id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: `[${type === "approve" ? "✓ Approved" : "✗ Revision"}] ${note}` }),
        });
      }

      toast.success(type === "approve" ? `✓ ${meta.approveLabel} แล้ว` : `✗ ${meta.rejectLabel} แล้ว`);
      setExpandedId(null);
      setNotes((p) => { const n = { ...p }; delete n[article.id]; return n; });
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoading((p) => ({ ...p, [article.id]: null }));
    }
  }

  if (articles.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-xl border">
        <div className="text-5xl mb-4">✅</div>
        <h3 className="text-lg font-semibold text-gray-900">ไม่มีบทความรอ Review</h3>
        <p className="text-gray-500 text-sm mt-1">ทุกอย่างเรียบร้อยแล้ว!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([status, items]) => {
        if (items.length === 0) return null;
        const meta = GROUP_META[status];
        return (
          <div key={status}>
            <div className="flex items-center gap-3 mb-3">
              <StatusBadge status={status as never} />
              <span className="text-sm text-gray-500">{items.length} บทความ</span>
            </div>
            <div className="space-y-2">
              {items.map((article) => {
                const review = article.reviews[0];
                const isExpanded = expandedId === article.id;
                const isLoading = loading[article.id];
                const canApprove = meta.approveStatus !== "—" && meta.approveStatus !== article.status;
                const canReject  = meta.rejectStatus  !== "—" && meta.rejectStatus  !== article.status;

                return (
                  <div key={article.id} className={`bg-white rounded-xl border transition-all ${isExpanded ? "border-gray-300 shadow-sm" : "border-gray-100"}`}>
                    {/* Main row */}
                    <div className="flex items-start gap-3 p-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/articles/${article.id}`} target="_blank" className="font-medium text-gray-900 hover:text-green-700 truncate flex items-center gap-1">
                            {article.title}
                            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 shrink-0" />
                          </Link>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
                          <span>{article.project.name}</span>
                          <span>·</span>
                          <FunnelBadge stage={article.funnelStage} />
                          {article.keyword && <><span>·</span><span>{article.keyword.keyword}</span></>}
                          <span>·</span>
                          <span>{formatDate(article.updatedAt)}</span>
                        </div>
                      </div>

                      {/* Scores */}
                      {review && (
                        <div className="flex items-center gap-1.5 text-xs shrink-0">
                          {review.seoScore != null && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">SEO {review.seoScore}</span>}
                          {review.aeoScore != null && <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded font-medium">AEO {review.aeoScore}</span>}
                        </div>
                      )}

                      {/* Quick action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {canApprove && (
                          <button
                            onClick={() => doAction(article, "approve")}
                            disabled={!!isLoading}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                          >
                            {isLoading === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                            {meta.approveLabel}
                          </button>
                        )}
                        {canReject && (
                          <button
                            onClick={() => doAction(article, "reject")}
                            disabled={!!isLoading}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 text-xs font-semibold rounded-lg border border-red-200 transition-colors"
                          >
                            {isLoading === "reject" ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                            {meta.rejectLabel}
                          </button>
                        )}
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : article.id)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isExpanded ? "bg-gray-100 border-gray-200 text-gray-700" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                        >
                          <MessageSquare className="h-3 w-3" />
                          Note
                          <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {/* Inline note + action */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 border-t border-gray-50 mt-0">
                        <textarea
                          autoFocus
                          rows={2}
                          placeholder="เพิ่ม note / feedback สำหรับผู้เขียน (optional)..."
                          value={notes[article.id] ?? ""}
                          onChange={(e) => setNotes((p) => ({ ...p, [article.id]: e.target.value }))}
                          className="w-full mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
                        />
                        <div className="flex items-center gap-2 mt-2">
                          {canApprove && (
                            <button
                              onClick={() => doAction(article, "approve")}
                              disabled={!!isLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              {isLoading === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                              {meta.approveLabel} + บันทึก Note
                            </button>
                          )}
                          {canReject && (
                            <button
                              onClick={() => doAction(article, "reject")}
                              disabled={!!isLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              {isLoading === "reject" ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                              {meta.rejectLabel} + บันทึก Note
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
