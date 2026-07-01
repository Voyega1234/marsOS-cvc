"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FunnelBadge } from "@/components/shared/FunnelBadge";
import { formatDate } from "@/lib/utils";
import { CheckCircle, Zap, ExternalLink, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import type { ArticleStatus } from "@/types";

interface ArticleTask {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  updatedAt: Date;
  project: { id: string; name: string };
  keyword?: { keyword: string } | null;
  reviewerId?: string | null;
}

interface Props {
  groups: [string, ArticleTask[]][];
  urgencyMeta: Record<string, { label: string; color: string; border: string; order: number }>;
  userId: string;
}

// Actions available per status
const STATUS_ACTIONS: Record<string, { label: string; newStatus: string; color: string } | null> = {
  OUTLINE_APPROVED:  { label: "เริ่มเขียน (Auto Run)", newStatus: "ARTICLE_GENERATING", color: "bg-blue-600 hover:bg-blue-500 text-white" },
  SEO_REVIEW:        { label: "Approve บทความ",         newStatus: "APPROVED",           color: "bg-green-600 hover:bg-green-500 text-white" },
  REVISION_REQUIRED: { label: "ส่ง Review ใหม่",         newStatus: "SEO_REVIEW",         color: "bg-amber-500 hover:bg-amber-400 text-white" },
  ARTICLE_DONE:      { label: "ส่ง SEO Check",           newStatus: "SEO_REVIEW",         color: "bg-teal-600 hover:bg-teal-500 text-white" },
};

export function MyTasksClient({ groups, urgencyMeta, userId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function quickAction(articleId: string, newStatus: string, autoRun?: boolean) {
    setLoading(articleId);
    try {
      if (autoRun) {
        const res = await fetch("/api/ai/auto-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId, modeOverride: "FULL_AUTO" }),
        });
        if (!res.ok) throw new Error();
        toast.success("Auto Run เริ่มแล้ว — AI กำลังเขียนบทความ");
      } else {
        const res = await fetch(`/api/articles/${articleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error();
        toast.success("อัปเดตสถานะแล้ว");
      }
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      {groups.map(([status, articles]) => {
        const meta = urgencyMeta[status];
        if (!meta) return null;
        const action = STATUS_ACTIONS[status] ?? null;
        return (
          <div key={status}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${meta.color}`}>
                {meta.label}
              </div>
              <span className="text-xs text-gray-400">{articles.length} รายการ</span>
            </div>
            <div className="space-y-2">
              {articles.map((article) => {
                const isExpanded = expanded === article.id;
                const isLoading = loading === article.id;
                const isReviewTask = article.reviewerId === userId && article.status === "SEO_REVIEW";
                return (
                  <div key={article.id} className={`bg-white rounded-xl border ${meta.border} border overflow-hidden`}>
                    {/* Main row */}
                    <div className="flex items-start gap-3 p-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {isReviewTask && (
                            <span className="text-[10px] font-bold text-[#9A4A00] bg-[#FFF7ED] border border-[#F5C896] px-1.5 py-0.5 rounded-full shrink-0">
                              รอฉันตรวจ
                            </span>
                          )}
                          <p className="font-semibold text-gray-900 truncate">{article.title}</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                          <span className="font-medium text-gray-700">{article.project.name}</span>
                          <span>·</span>
                          <FunnelBadge stage={article.funnelStage} />
                          {article.keyword && <><span>·</span><span>{article.keyword.keyword}</span></>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={article.status as ArticleStatus} />

                        {/* Quick action button */}
                        {action && (
                          <button
                            onClick={() => quickAction(
                              article.id,
                              action.newStatus,
                              status === "OUTLINE_APPROVED"
                            )}
                            disabled={isLoading}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${action.color}`}
                          >
                            {isLoading
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : status === "OUTLINE_APPROVED"
                              ? <Zap className="h-3 w-3" />
                              : <CheckCircle className="h-3 w-3" />
                            }
                            {action.label}
                          </button>
                        )}

                        {/* Expand / open */}
                        <button
                          onClick={() => setExpanded(isExpanded ? null : article.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                        <Link
                          href={`/articles/${article.id}`}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 border-t border-gray-50 bg-gray-50/50">
                        <div className="flex items-center justify-between text-xs text-gray-400 pt-3">
                          <span>อัปเดต {formatDate(article.updatedAt)}</span>
                          <Link href={`/articles/${article.id}`} className="text-blue-600 hover:underline flex items-center gap-1">
                            เปิดบทความเต็ม <ExternalLink className="h-3 w-3" />
                          </Link>
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
