"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { STATUS_CONFIG } from "@/types";
import type { ArticleStatus, FunnelStage } from "@/types";

interface ArticleRow {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  updatedAt: Date;
  project: { id: string; name: string };
  keyword?: { keyword: string } | null;
  assignedTo?: { name: string | null } | null;
}

interface Props {
  articles: ArticleRow[];
}

const COLUMNS = [
  {
    key: "new",       label: "New",          statuses: ["NEW"],
    header: "bg-gray-100 border-gray-100",   body: "bg-gray-50/50",
    dot: "bg-gray-400",
  },
  {
    key: "research",  label: "Research",     statuses: ["KEYWORD_RESEARCHING", "KEYWORD_DONE", "CONTENT_MAP_DONE"],
    header: "bg-blue-50 border-blue-200",    body: "bg-blue-50/30",
    dot: "bg-blue-500",
  },
  {
    key: "outline",   label: "Outline",      statuses: ["OUTLINE_GENERATING", "OUTLINE_DONE", "OUTLINE_APPROVED"],
    header: "bg-orange-50 border-orange-200", body: "bg-orange-50/30",
    dot: "bg-orange-500",
  },
  {
    key: "writing",   label: "Writing",      statuses: ["ARTICLE_GENERATING", "ARTICLE_DONE", "IMAGE_PROMPT_DONE"],
    header: "bg-green-50 border-green-200",  body: "bg-green-50/30",
    dot: "bg-green-500",
  },
  {
    key: "review",    label: "Review",       statuses: ["SEO_REVIEW", "REVISION_REQUIRED"],
    header: "bg-teal-50 border-teal-200",    body: "bg-teal-50/30",
    dot: "bg-teal-500",
  },
  {
    key: "approved",  label: "Approved",     statuses: ["APPROVED"],
    header: "bg-emerald-50 border-emerald-200", body: "bg-emerald-50/30",
    dot: "bg-emerald-500",
  },
  {
    key: "published", label: "Published",    statuses: ["WORDPRESS_DRAFTED", "POSTED"],
    header: "bg-indigo-50 border-indigo-200", body: "bg-indigo-50/30",
    dot: "bg-indigo-500",
  },
  {
    key: "error",     label: "Error",        statuses: ["ERROR"],
    header: "bg-red-50 border-red-200",      body: "bg-red-50/30",
    dot: "bg-red-500",
  },
] as const;

const FUNNEL_COLORS: Record<string, string> = {
  TOFU: "bg-sky-100 text-sky-600",
  MOFU: "bg-violet-100 text-violet-600",
  BOFU: "bg-rose-100 text-rose-600",
};

// Status to column mapping for drop targets
const STATUS_TO_COLUMN: Record<string, string> = {};
COLUMNS.forEach((col) => col.statuses.forEach((s) => (STATUS_TO_COLUMN[s] = col.key)));

// First status for each column (drop target moves to this status)
const COLUMN_DROP_STATUS: Record<string, string> = {
  new:       "NEW",
  research:  "KEYWORD_DONE",
  outline:   "OUTLINE_DONE",
  writing:   "ARTICLE_DONE",
  review:    "SEO_REVIEW",
  approved:  "APPROVED",
  published: "WORDPRESS_DRAFTED",
  error:     "ERROR",
};

export function ArticleKanban({ articles }: Props) {
  const router = useRouter();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("ALL");

  const projects = Array.from(new Map(articles.map((a) => [a.project.id, a.project.name])).entries())
    .map(([id, name]) => ({ id, name }));

  const visibleArticles = projectFilter === "ALL" ? articles : articles.filter((a) => a.project.id === projectFilter);

  async function moveArticle(articleId: string, newStatus: string) {
    setUpdating(articleId);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Moved to ${STATUS_CONFIG[newStatus as ArticleStatus]?.labelTh ?? newStatus}`);
      router.refresh();
    } catch {
      toast.error("Failed to update status");
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Project filter */}
      {projects.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500">Project:</span>
          <button
            onClick={() => setProjectFilter("ALL")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${projectFilter === "ALL" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            ทั้งหมด ({articles.length})
          </button>
          {projects.map((p) => {
            const count = articles.filter((a) => a.project.id === p.id).length;
            return (
              <button
                key={p.id}
                onClick={() => setProjectFilter(p.id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${projectFilter === p.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {p.name} ({count})
              </button>
            );
          })}
        </div>
      )}

    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[500px]">
      {COLUMNS.map((col) => {
        const colArticles = visibleArticles.filter((a) => (col.statuses as readonly string[]).includes(a.status));
        const isOver = dragOver === col.key;

        return (
          <div
            key={col.key}
            className="flex-shrink-0 w-60"
            onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const articleId = e.dataTransfer.getData("articleId");
              const fromStatus = e.dataTransfer.getData("fromStatus");
              const targetStatus = COLUMN_DROP_STATUS[col.key];
              if (articleId && fromStatus !== targetStatus) {
                moveArticle(articleId, targetStatus);
              }
            }}
          >
            {/* Column Header */}
            <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-xl border-2 ${col.header} ${isOver ? "ring-2 ring-green-400 ring-offset-1" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">{col.label}</span>
              </div>
              <span className="text-xs font-bold text-gray-500 bg-white rounded-full px-1.5 py-0.5 border">
                {colArticles.length}
              </span>
            </div>

            {/* Column Body */}
            <div className={`min-h-32 rounded-b-xl border-2 border-t-0 ${col.header} ${isOver ? "ring-2 ring-green-400 ring-offset-1 ring-t-0" : ""} p-2 space-y-2`}>
              {colArticles.map((article) => {
                const statusCfg = STATUS_CONFIG[article.status as ArticleStatus];
                const isUpdating = updating === article.id;

                return (
                  <div
                    key={article.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("articleId", article.id);
                      e.dataTransfer.setData("fromStatus", article.status);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={`bg-white rounded-lg border border-gray-100 p-3 cursor-grab active:cursor-grabbing hover:border-green-200 hover:shadow-sm transition-all ${isUpdating ? "opacity-50" : ""}`}
                  >
                    <Link
                      href={`/articles/${article.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block"
                    >
                      <p className="text-xs font-medium text-gray-900 line-clamp-2 leading-snug hover:text-green-700 transition-colors">
                        {article.title}
                      </p>
                    </Link>

                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {statusCfg && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                          {statusCfg.labelTh}
                        </span>
                      )}
                      <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${FUNNEL_COLORS[article.funnelStage] ?? "bg-gray-100 text-gray-600"}`}>
                        {article.funnelStage}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                      <span className="truncate max-w-24">{article.project.name}</span>
                      <span>{formatDate(article.updatedAt)}</span>
                    </div>

                    {article.assignedTo?.name && (
                      <div className="mt-2 flex items-center gap-1">
                        <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-bold">
                          {article.assignedTo.name[0]}
                        </div>
                        <span className="text-xs text-gray-400 truncate">{article.assignedTo.name}</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {colArticles.length === 0 && (
                <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${isOver ? "border-green-400 bg-green-50" : "border-gray-100"}`}>
                  <p className="text-xs text-gray-400">{isOver ? "Drop here" : "Empty"}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
