"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { overviewDay, type OverviewArticle, type OverviewClient } from "@/lib/article-overview";
import {
  EMPTY_OVERVIEW_FILTER,
  OverviewFilterBar,
  SourceBadge,
  StatusChip,
  matchOverviewFilter,
  useMounted,
  type OverviewFilter,
} from "@/components/articles/article-status";

interface Props {
  articles: OverviewArticle[];
  clients: OverviewClient[];
}

export function AllArticlesClient({ articles, clients }: Props) {
  const [filter, setFilter] = useState<OverviewFilter>(EMPTY_OVERVIEW_FILTER);
  // วันของ Upload/PBN มาจาก ISO — แปลงเป็นวันตามเวลาเครื่องหลัง mount (server เป็น UTC)
  const mounted = useMounted();

  const filtered = useMemo(() => articles.filter(a => matchOverviewFilter(a, filter)), [articles, filter]);

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-brand-navy">บทความทั้งหมด</h1>
        <p className="text-sm text-gray-500 mt-0.5">{articles.length} บทความจาก {clients.length} client (SEO SME + Upload Article + PBN)</p>
      </div>

      <OverviewFilterBar
        articles={articles}
        clients={clients}
        filter={filter}
        onChange={setFilter}
        resultCount={filtered.length}
      />

      {/* Table */}
      {filtered.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="all-articles-table">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {["Client", "Keyword", "Title", "วันเผยแพร่", "Status", ""].map(h => (
                    <th key={h} className="px-4 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(a => {
                  const day = a.publishAt ? (mounted ? overviewDay(a) : "") : overviewDay(a);
                  return (
                    <tr key={a.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-gray-600">{a.clientName}</span>
                          <SourceBadge source={a.source} />
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <span className="text-xs text-gray-500 truncate block">{a.keyword || "—"}</span>
                      </td>
                      <td className="px-4 py-3 max-w-[280px]">
                        <span className="text-xs text-gray-800 font-medium truncate block">{a.title || a.keyword}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[11px] text-gray-400">{day || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={a.status} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={a.href}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-blue-500 hover:underline whitespace-nowrap"
                        >
                          <ExternalLink size={10} /> ไปดู
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-500 font-medium">ไม่พบบทความ</p>
          <p className="text-gray-400 text-sm mt-1">ลองเปลี่ยน filter หรือไปสร้าง timeline ใน Client ก่อน</p>
          <Link href="/projects" className="inline-block mt-4 px-4 py-2 bg-brand-blue text-white text-sm rounded-xl hover:bg-brand-deep transition-colors">
            ไปหน้า Clients
          </Link>
        </div>
      )}
    </div>
  );
}
