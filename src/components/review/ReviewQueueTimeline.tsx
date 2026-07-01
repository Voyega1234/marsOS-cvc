"use client";

import Link from "next/link";
import { Eye, ExternalLink, CheckCircle2 } from "lucide-react";

interface ReviewArticle {
  projectId: string;
  projectName: string;
  idx: number;
  date: string;
  keyword: string;
  title: string;
  articleStatus: string;
  funnel?: string;
  slug?: string;
  intent?: string;
}

interface Props {
  articles: ReviewArticle[];
}

export function ReviewQueueTimeline({ articles }: Props) {
  // Group by project
  const byProject = articles.reduce((acc, a) => {
    if (!acc[a.projectId]) acc[a.projectId] = { name: a.projectName, items: [] };
    acc[a.projectId].items.push(a);
    return acc;
  }, {} as Record<string, { name: string; items: ReviewArticle[] }>);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Review Queue</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {articles.length > 0
            ? `${articles.length} บทความรอตรวจจาก ${Object.keys(byProject).length} client`
            : "ไม่มีบทความรอตรวจ"}
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <CheckCircle2 size={36} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">ไม่มีงานค้าง</p>
          <p className="text-gray-400 text-sm mt-1">บทความที่มี status "รอตรวจ" จะแสดงที่นี่</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byProject).map(([projectId, group]) => (
            <div key={projectId} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {/* Project header */}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="font-semibold text-gray-800 text-sm">{group.name}</span>
                  <span className="text-xs text-gray-400">{group.items.length} บทความ</span>
                </div>
                <Link
                  href={`/projects/${projectId}?tab=review`}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors"
                >
                  <Eye size={11} /> ไปตรวจ
                </Link>
              </div>

              {/* Article rows */}
              <div className="divide-y divide-gray-50">
                {group.items.map((a, i) => (
                  <div key={`${a.idx}-${i}`} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50/50 transition-colors group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{a.title || a.keyword}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{a.keyword} {a.date ? `· ${a.date}` : ""}</p>
                    </div>
                    {a.intent && (
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full shrink-0">
                        {a.intent}
                      </span>
                    )}
                    <Link
                      href={`/projects/${projectId}?tab=review`}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-blue-500 hover:underline shrink-0"
                    >
                      <ExternalLink size={10} /> ดู
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
