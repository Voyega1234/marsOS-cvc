"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, PauseCircle, PlayCircle, ArchiveX, Search } from "lucide-react";

type TimelineStats = { total: number; writing: number; review: number; approved: number; pushed: number };

type ProjectRow = {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  businessType: string;
  industry: string | null;
  logoUrl: string | null;
  status: string;
  updatedAt: Date;
  owner: { id: string; name: string | null } | null;
  timelineStats: TimelineStats;
  userRole: string;
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}
function avatarColor(name: string) {
  const colors = ["bg-blue-500","bg-emerald-500","bg-violet-500","bg-rose-500","bg-amber-500","bg-cyan-500","bg-pink-500","bg-indigo-500"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    "bg-green-100 text-green-700",
  PLANNING:  "bg-blue-100 text-blue-700",
  PAUSED:    "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-gray-100 text-gray-600",
  ARCHIVED:  "bg-red-50 text-red-400",
};

export default function ProjectsTable({ projects: initial, userRole }: { projects: ProjectRow[]; userRole: string }) {
  const [projects, setProjects] = useState(initial);
  const [updating, setUpdating] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");

  async function changeStatus(id: string, newStatus: string) {
    setUpdating(id);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setProjects(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p));
    } finally {
      setUpdating(null);
    }
  }

  const isAdmin = userRole === "ADMIN" || userRole === "USER";

  const filtered = projects.filter(p => {
    const q = search.toLowerCase();
    const matchQ = !q || p.name.toLowerCase().includes(q) || (p.clientName ?? "").toLowerCase().includes(q) || p.website.toLowerCase().includes(q);
    const matchS = filterStatus === "ALL" || p.status === filterStatus;
    return matchQ && matchS;
  });

  const statusCounts = projects.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ client, เว็บ..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </div>
        <div className="flex gap-1.5">
          {["ALL", "ACTIVE", "PAUSED", "ARCHIVED", "PLANNING", "COMPLETED"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${filterStatus === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"}`}>
              {s === "ALL" ? `ทั้งหมด (${projects.length})` : `${s} (${statusCounts[s] ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {["#", "Client", "เว็บไซต์", "ประเภท", "บทความ", "ความคืบหน้า", "อัปเดต", "Status", isAdmin ? "Actions" : ""].filter(Boolean).map(h => (
                <th key={h} className="text-left px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบ client</td></tr>
            )}
            {filtered.map((p, i) => {
              const ts = p.timelineStats;
              const done = ts.approved + ts.pushed;
              const progress = ts.total > 0 ? Math.round((done / ts.total) * 100) : 0;
              const busy = updating === p.id;
              return (
                <tr key={p.id} className={`hover:bg-gray-50/80 transition-colors ${p.status === "ARCHIVED" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 text-gray-400 tabular-nums text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white text-[13px] font-bold overflow-hidden ${p.logoUrl ? '' : avatarColor(p.clientName || p.name)}`}>
                        {p.logoUrl
                          ? <img src={p.logoUrl} alt="" className="w-full h-full object-cover" />
                          : initials(p.clientName || p.name)
                        }
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">{p.clientName || p.name}</div>
                        {p.industry && <div className="text-[11px] text-gray-400 truncate">{p.industry}</div>}
                        {p.owner?.name && <div className="text-[10px] text-gray-300 truncate">👤 {p.owner.name}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-blue-500 max-w-[160px]">
                    <span className="truncate block">{p.website}</span>
                    {p.industry && <span className="text-gray-400 block">{p.industry}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.businessType}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 text-xs tabular-nums">
                      <span className="text-gray-700 font-semibold">{ts.total}</span>
                      {ts.review > 0 && <span className="text-amber-600">รอตรวจ {ts.review}</span>}
                      {ts.writing > 0 && <span className="text-blue-500">เขียน {ts.writing}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 min-w-[100px]">
                    {ts.total > 0 ? (
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                          <span>{done}/{ts.total}</span>
                          <span className="font-semibold">{progress}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${STATUS_BADGE[p.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/projects/${p.id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gray-900 hover:bg-gray-700 rounded-lg transition-colors">
                        เปิด <ArrowRight size={11} />
                      </Link>
                      {isAdmin && (
                        <>
                          {p.status === "ACTIVE" || p.status === "PLANNING" ? (
                            <button onClick={() => changeStatus(p.id, "PAUSED")} disabled={busy}
                              className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40" title="ระงับ">
                              <PauseCircle size={14} />
                            </button>
                          ) : p.status === "PAUSED" ? (
                            <button onClick={() => changeStatus(p.id, "ACTIVE")} disabled={busy}
                              className="p-1.5 text-green-500 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40" title="เปิดใช้งาน">
                              <PlayCircle size={14} />
                            </button>
                          ) : null}
                          {p.status !== "ARCHIVED" ? (
                            <button onClick={() => { if (confirm(`Archive "${p.name}"?`)) changeStatus(p.id, "ARCHIVED") }} disabled={busy}
                              className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Archive">
                              <ArchiveX size={14} />
                            </button>
                          ) : (
                            <button onClick={() => changeStatus(p.id, "ACTIVE")} disabled={busy}
                              className="p-1.5 text-green-400 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40" title="กู้คืน">
                              <PlayCircle size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
