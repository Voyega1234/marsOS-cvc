"use client";

import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { STATUS_CONFIG } from "@/types";
import type { ArticleStatus } from "@/types";

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

const FUNNEL_STAGES = [
  {
    key:  "TOFU",
    label: "Top of Funnel",
    abbr:  "TOFU",
    emoji: "🔝",
    desc:  "Awareness — กลุ่มยังไม่รู้จักสินค้า",
    header: "bg-sky-50 border-sky-200",
    accent: "text-sky-600",
    dot:    "bg-sky-500",
    badge:  "bg-sky-100 text-sky-700",
  },
  {
    key:  "MOFU",
    label: "Middle of Funnel",
    abbr:  "MOFU",
    emoji: "🔄",
    desc:  "Consideration — กำลังเปรียบเทียบ",
    header: "bg-violet-50 border-violet-200",
    accent: "text-violet-600",
    dot:    "bg-violet-500",
    badge:  "bg-violet-100 text-violet-700",
  },
  {
    key:  "BOFU",
    label: "Bottom of Funnel",
    abbr:  "BOFU",
    emoji: "🎯",
    desc:  "Decision — พร้อมตัดสินใจซื้อ",
    header: "bg-rose-50 border-rose-200",
    accent: "text-rose-600",
    dot:    "bg-rose-500",
    badge:  "bg-rose-100 text-rose-700",
  },
] as const;

// Pipeline order for sorting within a funnel column
const STATUS_ORDER: Record<string, number> = {
  NEW: 0, KEYWORD_RESEARCHING: 1, KEYWORD_DONE: 2, CONTENT_MAP_DONE: 3,
  OUTLINE_GENERATING: 4, OUTLINE_DONE: 5, OUTLINE_APPROVED: 6,
  ARTICLE_GENERATING: 7, ARTICLE_DONE: 8, IMAGE_PROMPT_DONE: 9,
  SEO_REVIEW: 10, REVISION_REQUIRED: 11, APPROVED: 12,
  WORDPRESS_DRAFTED: 13, POSTED: 14, ERROR: 99,
};

export function ArticleFunnelBoard({ articles }: Props) {
  const totalByFunnel = {
    TOFU: articles.filter((a) => a.funnelStage === "TOFU").length,
    MOFU: articles.filter((a) => a.funnelStage === "MOFU").length,
    BOFU: articles.filter((a) => a.funnelStage === "BOFU").length,
  };

  return (
    <div className="space-y-4">
      {/* Funnel Summary Bar */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          {FUNNEL_STAGES.map((stage) => {
            const count = totalByFunnel[stage.key as keyof typeof totalByFunnel];
            const pct = articles.length > 0 ? Math.round((count / articles.length) * 100) : 0;
            return (
              <div key={stage.key} className="px-6 text-center first:pl-0 last:pr-0">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className={`text-sm font-semibold ${stage.accent}`}>{stage.emoji} {stage.abbr}</p>
                <p className="text-xs text-gray-400 mt-1">{pct}% of total</p>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${stage.dot} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Three Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {FUNNEL_STAGES.map((stage) => {
          const stageArticles = articles
            .filter((a) => a.funnelStage === stage.key)
            .sort((a, b) => (STATUS_ORDER[b.status] ?? 0) - (STATUS_ORDER[a.status] ?? 0));

          return (
            <div key={stage.key} className="flex flex-col">
              {/* Column Header */}
              <div className={`flex items-center justify-between px-4 py-3 rounded-t-xl border-2 ${stage.header}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{stage.emoji}</span>
                    <span className="text-sm font-bold text-gray-800">{stage.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stage.badge}`}>{stage.abbr}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 ml-7">{stage.desc}</p>
                </div>
                <span className="text-lg font-bold text-gray-600 bg-white rounded-full w-8 h-8 flex items-center justify-center border border-gray-100 text-sm">
                  {stageArticles.length}
                </span>
              </div>

              {/* Article List */}
              <div className={`flex-1 border-2 border-t-0 ${stage.header} rounded-b-xl overflow-auto max-h-96`}>
                {stageArticles.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-gray-400">No articles in {stage.abbr}</p>
                  </div>
                ) : (
                  <div className="p-3 space-y-2">
                    {stageArticles.map((article) => {
                      const statusCfg = STATUS_CONFIG[article.status as ArticleStatus];
                      return (
                        <Link
                          key={article.id}
                          href={`/articles/${article.id}`}
                          className="block bg-white rounded-lg border border-gray-100 p-3 hover:border-green-200 hover:shadow-sm transition-all group"
                        >
                          <p className="text-xs font-semibold text-gray-900 group-hover:text-green-700 line-clamp-2 leading-snug transition-colors">
                            {article.title}
                          </p>
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            {statusCfg && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                                {statusCfg.labelTh}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                            <span className="truncate max-w-28">{article.project.name}</span>
                            {article.keyword && (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded truncate max-w-24">
                                {article.keyword.keyword}
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })}
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
