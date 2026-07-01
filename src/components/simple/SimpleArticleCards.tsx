"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { STATUS_CONFIG, FUNNEL_CONFIG } from "@/types";
import type { ArticleStatus, FunnelStage } from "@/types";
import {
  Search, Filter, Plus, Sparkles, CheckCircle, ExternalLink,
  FileText, ChevronRight, AlertTriangle, Loader2, LayoutGrid, List,
} from "lucide-react";

interface ArticleRow {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  updatedAt: Date;
  project: { id: string; name: string };
  keyword?: { keyword: string } | null;
  assignedTo?: { name: string | null } | null;
  reviewer?: { name: string | null } | null;
  createdBy?: { name: string | null } | null;
}

interface Props {
  articles: ArticleRow[];
  projects: { id: string; name: string }[];
  users: { id: string; name: string | null }[];
}

type NextActionType = "ai" | "approve" | "link" | "done" | "waiting" | "view";

interface NextAction {
  label: string;
  emoji: string;
  color: string;
  textColor: string;
  type: NextActionType;
  endpoint?: string;
  approveStatus?: string;
  hint: string;
}

function getNextAction(status: string): NextAction {
  const map: Record<string, NextAction> = {
    NEW: {
      label: "สร้างโครงร่าง", emoji: "📝", type: "ai",
      endpoint: "/api/ai/outline", approveStatus: undefined,
      color: "bg-orange-500 hover:bg-orange-600", textColor: "text-white",
      hint: "AI จะช่วยสร้างโครงสร้างบทความให้",
    },
    KEYWORD_RESEARCHING: {
      label: "กำลังวิจัย...", emoji: "⏳", type: "waiting",
      color: "bg-blue-100", textColor: "text-blue-600",
      hint: "AI กำลังค้นหาคีย์เวิร์ดที่เหมาะสม",
    },
    KEYWORD_DONE: {
      label: "สร้างโครงร่าง", emoji: "📝", type: "ai",
      endpoint: "/api/ai/outline",
      color: "bg-orange-500 hover:bg-orange-600", textColor: "text-white",
      hint: "คีย์เวิร์ดพร้อมแล้ว สร้างโครงร่างได้เลย",
    },
    CONTENT_MAP_DONE: {
      label: "สร้างโครงร่าง", emoji: "📝", type: "ai",
      endpoint: "/api/ai/outline",
      color: "bg-orange-500 hover:bg-orange-600", textColor: "text-white",
      hint: "แผนเนื้อหาพร้อมแล้ว สร้างโครงร่างต่อ",
    },
    OUTLINE_GENERATING: {
      label: "กำลังสร้างโครงร่าง...", emoji: "⏳", type: "waiting",
      color: "bg-orange-100", textColor: "text-orange-600",
      hint: "AI กำลังสร้างโครงร่างบทความ",
    },
    OUTLINE_DONE: {
      label: "อนุมัติโครงร่าง", emoji: "✅", type: "approve",
      approveStatus: "OUTLINE_APPROVED",
      color: "bg-amber-500 hover:bg-amber-600", textColor: "text-white",
      hint: "ตรวจสอบโครงร่างและอนุมัติเพื่อเริ่มเขียน",
    },
    OUTLINE_APPROVED: {
      label: "เขียนบทความ", emoji: "✍️", type: "ai",
      endpoint: "/api/ai/article",
      color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]", textColor: "text-white",
      hint: "โครงร่างอนุมัติแล้ว AI พร้อมเขียนบทความ",
    },
    ARTICLE_GENERATING: {
      label: "กำลังเขียนบทความ...", emoji: "⏳", type: "waiting",
      color: "bg-green-100", textColor: "text-green-600",
      hint: "AI กำลังเขียนเนื้อหาบทความ",
    },
    ARTICLE_DONE: {
      label: "สร้าง Image Prompt", emoji: "🖼️", type: "ai",
      endpoint: "/api/ai/image-prompt",
      color: "bg-pink-500 hover:bg-pink-600", textColor: "text-white",
      hint: "บทความพร้อมแล้ว สร้าง prompt รูปภาพ",
    },
    IMAGE_PROMPT_DONE: {
      label: "ตรวจ SEO", emoji: "🔍", type: "ai",
      endpoint: "/api/ai/seo-check",
      color: "bg-teal-500 hover:bg-teal-600", textColor: "text-white",
      hint: "รูปพร้อมแล้ว ตรวจสอบ SEO ก่อนเผยแพร่",
    },
    SEO_REVIEW: {
      label: "อนุมัติบทความ", emoji: "✅", type: "approve",
      approveStatus: "APPROVED",
      color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]", textColor: "text-white",
      hint: "ตรวจสอบผล SEO และอนุมัติบทความ",
    },
    REVISION_REQUIRED: {
      label: "ต้องแก้ไข", emoji: "⚠️", type: "view",
      color: "bg-red-100 hover:bg-red-200", textColor: "text-red-700",
      hint: "บทความนี้ต้องได้รับการแก้ไขก่อน",
    },
    APPROVED: {
      label: "ส่ง WordPress", emoji: "🌐", type: "ai",
      endpoint: "/api/wordpress/draft",
      color: "bg-[#1A1A1A] hover:bg-[#2D2D2D]", textColor: "text-white",
      hint: "บทความอนุมัติแล้ว ส่งเข้า WordPress ได้",
    },
    WORDPRESS_DRAFTED: {
      label: "ดู WordPress Draft", emoji: "🌐", type: "view",
      color: "bg-indigo-100 hover:bg-indigo-200", textColor: "text-indigo-700",
      hint: "Draft อยู่ใน WordPress รอ publish",
    },
    POSTED: {
      label: "เผยแพร่แล้ว 🎉", emoji: "🎉", type: "done",
      color: "bg-green-100", textColor: "text-green-700",
      hint: "บทความนี้เผยแพร่บนเว็บแล้ว",
    },
    ERROR: {
      label: "ดูข้อผิดพลาด", emoji: "⚠️", type: "view",
      color: "bg-red-500 hover:bg-red-600", textColor: "text-white",
      hint: "เกิดข้อผิดพลาด กรุณาตรวจสอบ",
    },
  };
  return map[status] ?? {
    label: "เปิดบทความ", emoji: "📄", type: "view",
    color: "bg-gray-100 hover:bg-gray-200", textColor: "text-gray-700",
    hint: "",
  };
}

const STATUS_GROUPS = [
  { label: "ทั้งหมด", value: "ALL" },
  { label: "🆕 ใหม่", value: "NEW" },
  { label: "📝 รอโครงร่าง", value: "OUTLINE_DONE" },
  { label: "✍️ รอเขียน", value: "OUTLINE_APPROVED" },
  { label: "✅ รอตรวจ SEO", value: "SEO_REVIEW" },
  { label: "👍 อนุมัติแล้ว", value: "APPROVED" },
  { label: "🌐 WordPress", value: "WORDPRESS_DRAFTED" },
  { label: "🎉 เผยแพร่", value: "POSTED" },
];

export function SimpleArticleCards({ articles, projects, users }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [funnelFilter, setFunnelFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [assignedFilter, setAssignedFilter] = useState("ALL");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    articleId: string;
    action: NextAction;
    hasExistingContent: boolean;
  } | null>(null);

  const filtered = useMemo(() => {
    return articles.filter((a) => {
      if (q && !a.title.toLowerCase().includes(q.toLowerCase())) return false;
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (funnelFilter !== "ALL" && a.funnelStage !== funnelFilter) return false;
      if (projectFilter !== "ALL" && a.project.id !== projectFilter) return false;
      if (assignedFilter !== "ALL" && a.assignedTo?.name !== assignedFilter) return false;
      return true;
    });
  }, [articles, q, statusFilter, funnelFilter, projectFilter, assignedFilter]);

  async function runAction(articleId: string, action: NextAction) {
    if (action.type === "view" || action.type === "done" || action.type === "waiting") {
      router.push(`/articles/${articleId}`);
      return;
    }
    if (action.type === "approve" && action.approveStatus) {
      setLoadingId(articleId);
      try {
        const res = await fetch(`/api/articles/${articleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: action.approveStatus }),
        });
        if (!res.ok) throw new Error();
        toast.success("อัปเดตสถานะเรียบร้อย!");
        router.refresh();
      } catch {
        toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
      } finally {
        setLoadingId(null);
      }
      return;
    }
    if (action.type === "ai" && action.endpoint) {
      setLoadingId(articleId);
      try {
        const res = await fetch(action.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId }),
        });
        if (!res.ok) throw new Error();
        toast.success("AI ดำเนินการเสร็จแล้ว!");
        router.refresh();
      } catch {
        toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
      } finally {
        setLoadingId(null);
      }
    }
  }

  function handleActionClick(article: ArticleRow, action: NextAction) {
    const hasExistingContent =
      (action.endpoint === "/api/ai/article") ||
      (action.endpoint === "/api/ai/outline");

    if (action.type === "ai" && hasExistingContent) {
      setConfirmModal({ articleId: article.id, action, hasExistingContent });
      return;
    }
    runAction(article.id, action);
  }

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="ค้นหาบทความ..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10 rounded-xl border-gray-100 text-sm bg-gray-50 focus:bg-white"
            />
          </div>

          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-44 rounded-xl border-gray-100 text-sm">
              <SelectValue placeholder="โปรเจ็กต์" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกโปรเจ็กต์</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={funnelFilter} onValueChange={setFunnelFilter}>
            <SelectTrigger className="w-36 rounded-xl border-gray-100 text-sm">
              <SelectValue placeholder="Funnel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุก Funnel</SelectItem>
              <SelectItem value="TOFU">🔝 TOFU</SelectItem>
              <SelectItem value="MOFU">🔄 MOFU</SelectItem>
              <SelectItem value="BOFU">🎯 BOFU</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48 rounded-xl border-gray-100 text-sm">
              <SelectValue placeholder="สถานะ" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_GROUPS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {users.length > 0 && (
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="w-40 rounded-xl border-gray-100 text-sm">
                <SelectValue placeholder="ผู้รับผิดชอบ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกคน</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.name ?? u.id}>{u.name ?? "—"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex items-center text-sm text-gray-500 ml-auto">
            <span className="font-semibold text-gray-700">{filtered.length}</span>
            <span className="ml-1">บทความ</span>
          </div>
        </div>

        {/* Status pills */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {STATUS_GROUPS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                statusFilter === s.value
                  ? "bg-green-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty State */}
      {filtered.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <FileText className="h-10 w-10 text-gray-300" />
          </div>
          <p className="text-xl font-semibold text-gray-700">ไม่พบบทความ</p>
          <p className="text-sm text-gray-400 mt-2 mb-6">
            {q ? `ไม่พบบทความที่มีคำว่า "${q}"` : "ยังไม่มีบทความในหมวดหมู่นี้"}
          </p>
          <Link
            href="/articles/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            สร้างบทความใหม่
          </Link>
        </div>
      )}

      {/* Article Cards Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((article) => {
            const nextAction = getNextAction(article.status);
            const statusCfg = STATUS_CONFIG[article.status as ArticleStatus];
            const funnelCfg = FUNNEL_CONFIG[article.funnelStage as FunnelStage];
            const isLoading = loadingId === article.id;

            return (
              <div
                key={article.id}
                className="bg-white rounded-2xl border border-gray-100 hover:border-green-200 hover:shadow-md transition-all flex flex-col overflow-hidden group"
              >
                {/* Card Top: Title */}
                <Link href={`/articles/${article.id}`} className="p-5 pb-3 flex-1 block">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${statusCfg?.bg ?? "bg-gray-100"} ${statusCfg?.color ?? "text-gray-600"}`}>
                      {statusCfg?.labelTh ?? article.status}
                    </span>
                    {funnelCfg && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${funnelCfg.bg} ${funnelCfg.color}`}>
                        {article.funnelStage}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-green-700 transition-colors leading-snug line-clamp-3 text-base">
                    {article.title}
                  </h3>
                </Link>

                {/* Card Meta */}
                <div className="px-5 pb-3">
                  <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
                    <span className="font-medium text-gray-600">{article.project.name}</span>
                    {article.keyword && (
                      <>
                        <span>·</span>
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{article.keyword.keyword}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400 mt-1.5">
                    {article.assignedTo?.name && (
                      <span>👤 {article.assignedTo.name}</span>
                    )}
                    <span>🕐 {formatDate(article.updatedAt)}</span>
                  </div>
                </div>

                {/* Next Action */}
                <div className="px-5 pb-5 pt-3 border-t border-gray-50">
                  <p className="text-xs text-gray-400 font-medium mb-2.5">ขั้นตอนถัดไป:</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleActionClick(article, nextAction)}
                      disabled={isLoading || nextAction.type === "waiting" || nextAction.type === "done"}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${nextAction.color} ${nextAction.textColor} disabled:opacity-60 disabled:cursor-not-allowed shadow-sm`}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span>{nextAction.emoji}</span>
                      )}
                      <span>{isLoading ? "กำลังดำเนินการ..." : nextAction.label}</span>
                    </button>
                    <Link
                      href={`/articles/${article.id}`}
                      className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </div>
                  {nextAction.hint && (
                    <p className="text-xs text-gray-400 mt-2">{nextAction.hint}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      <Dialog open={!!confirmModal} onOpenChange={() => setConfirmModal(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              สร้างเนื้อหาใหม่?
            </DialogTitle>
            <DialogDescription className="text-base mt-2">
              เนื้อหาเดิมจะถูกบันทึกเป็น version สำรองไว้ก่อน แล้ว AI จะสร้างใหม่แทน
            </DialogDescription>
          </DialogHeader>
          <div className="bg-orange-50 rounded-xl p-4 text-sm text-orange-700 border border-orange-100">
            💡 ไม่ต้องกังวล — เนื้อหาเดิมจะยังอยู่ใน "ประวัติ Version" คุณสามารถย้อนกลับได้เสมอ
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmModal(null)} className="rounded-xl">
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                if (confirmModal) {
                  const { articleId, action } = confirmModal;
                  setConfirmModal(null);
                  runAction(articleId, action);
                }
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              ใช่ สร้างใหม่
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
