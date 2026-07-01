"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Clock, RefreshCw, Eye, CheckCircle2, Send,
  Search, Filter, ExternalLink,
} from "lucide-react";

interface Article {
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
  priority?: string;
  volume?: number;
  timelineBatch?: string;
}

interface Props {
  articles: Article[];
  projects: { id: string; name: string }[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: "รอเขียน",     color: "bg-gray-100 text-gray-500",       icon: <Clock size={10} /> },
  writing:  { label: "กำลังเขียน",  color: "bg-blue-100 text-blue-600",       icon: <RefreshCw size={10} className="animate-spin" /> },
  review:   { label: "รอตรวจ",      color: "bg-amber-100 text-amber-700",     icon: <Eye size={10} /> },
  done:     { label: "เขียนแล้ว",   color: "bg-purple-100 text-purple-700",   icon: <CheckCircle2 size={10} /> },
  approved: { label: "Approved",    color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 size={10} /> },
  pushed:   { label: "Pushed",      color: "bg-teal-100 text-teal-700",       icon: <Send size={10} /> },
};

const ALL_STATUSES = ["pending", "writing", "review", "done", "approved", "pushed"];

function StatusChip({ status }: { status: string }) {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.color}`}>
      {s.icon}{s.label}
    </span>
  );
}

export function AllArticlesClient({ articles, projects }: Props) {
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const counts = useMemo(() =>
    ALL_STATUSES.reduce((acc, s) => {
      acc[s] = articles.filter(a => (a.articleStatus || "pending") === s).length;
      return acc;
    }, {} as Record<string, number>),
    [articles]
  );

  const filtered = useMemo(() => {
    return articles.filter(a => {
      const status = a.articleStatus || "pending";
      if (filterProject !== "all" && a.projectId !== filterProject) return false;
      if (filterStatus !== "all" && status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.title?.toLowerCase().includes(q) && !a.keyword?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [articles, filterProject, filterStatus, search]);

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">บทความทั้งหมด</h1>
        <p className="text-sm text-gray-500 mt-0.5">{articles.length} บทความจาก {projects.length} client</p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterStatus("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
            filterStatus === "all"
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-gray-100 text-gray-600 border-transparent hover:border-gray-200"
          }`}
        >
          ทั้งหมด <span className="opacity-60 ml-1">{articles.length}</span>
        </button>
        {ALL_STATUSES.map(s => {
          const cfg = STATUS_CONFIG[s];
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                filterStatus === s
                  ? "bg-gray-900 text-white border-gray-900"
                  : `${cfg.color} border-transparent hover:border-gray-200`
              }`}
            >
              {cfg.icon}{cfg.label}
              <span className="opacity-60 ml-0.5">{counts[s]}</span>
            </button>
          );
        })}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา keyword / title..."
            className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 w-56"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={12} className="text-gray-400" />
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
          >
            <option value="all">ทุก Client</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <span className="text-xs text-gray-400">{filtered.length} รายการ</span>
      </div>

      {/* Table */}
      {filtered.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {["Client", "Keyword", "Title", "วันที่", "Status", ""].map(h => (
                    <th key={h} className="px-4 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((a, i) => (
                  <tr key={`${a.projectId}-${a.idx}-${i}`} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-medium text-gray-600">{a.projectName}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[160px]">
                      <span className="text-xs text-gray-500 truncate block">{a.keyword}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[280px]">
                      <span className="text-xs text-gray-800 font-medium truncate block">{a.title || a.keyword}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[11px] text-gray-400">{a.date || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={a.articleStatus || "pending"} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${a.projectId}?tab=${a.articleStatus === "review" ? "review" : "articles"}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-blue-500 hover:underline whitespace-nowrap"
                      >
                        <ExternalLink size={10} /> ไปดู
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-500 font-medium">ไม่พบบทความ</p>
          <p className="text-gray-400 text-sm mt-1">ลองเปลี่ยน filter หรือไปสร้าง timeline ใน Client ก่อน</p>
          <Link href="/projects" className="inline-block mt-4 px-4 py-2 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-700 transition-colors">
            ไปหน้า Clients
          </Link>
        </div>
      )}
    </div>
  );
}
