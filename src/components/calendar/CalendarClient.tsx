"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays, List, Plus, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ArticleRow = {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  scheduledAt: string | null;
  updatedAt: string;
  createdAt: string;
  project: { id: string; name: string };
  assignedTo: { id: string; name: string } | null;
};

type ProjectRow = { id: string; name: string };

// Color per status
const STATUS_COLOR: Record<string, string> = {
  NEW:                 "bg-gray-100 text-gray-600",
  OUTLINE_DONE:        "bg-indigo-100 text-indigo-700",
  OUTLINE_APPROVED:    "bg-blue-100 text-blue-700",
  ARTICLE_GENERATING:  "bg-purple-100 text-purple-700",
  ARTICLE_DONE:        "bg-green-100 text-green-700",
  SEO_REVIEW:          "bg-amber-100 text-amber-700",
  REVISION_REQUIRED:   "bg-rose-100 text-rose-700",
  APPROVED:            "bg-emerald-100 text-emerald-700",
  WORDPRESS_DRAFTED:   "bg-sky-100 text-sky-700",
  POSTED:              "bg-teal-100 text-teal-700",
};

const PROJECT_PALETTE = [
  "bg-violet-400", "bg-blue-400", "bg-green-400", "bg-amber-400",
  "bg-rose-400", "bg-teal-400", "bg-orange-400", "bg-pink-400",
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  // Monday-based: 0=Mon … 6=Sun
  const d = new Date(year, month, 1).getDay();
  return (d + 6) % 7;
}

const MONTH_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const DAY_TH   = ["จ","อ","พ","พฤ","ศ","ส","อา"];

export function CalendarClient({
  articles,
  projects,
}: {
  articles: ArticleRow[];
  projects: ProjectRow[];
}) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [view, setView]   = useState<"month" | "list">("month");
  const [filterProject, setFilterProject] = useState("ALL");
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [dateInput, setDateInput]   = useState("");
  const [saving, setSaving]         = useState(false);

  // Project color map
  const projectColors = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((p, i) => { map[p.id] = PROJECT_PALETTE[i % PROJECT_PALETTE.length]; });
    return map;
  }, [projects]);

  // Filtered articles
  const filtered = useMemo(() =>
    filterProject === "ALL" ? articles : articles.filter((a) => a.project.id === filterProject),
  [articles, filterProject]);

  // Build day → articles map for the current month
  const dayMap = useMemo(() => {
    const map: Record<number, ArticleRow[]> = {};
    filtered.forEach((a) => {
      const d = a.scheduledAt ? new Date(a.scheduledAt) : null;
      if (d && d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(a);
      }
    });
    return map;
  }, [filtered, year, month]);

  // Unscheduled articles
  const unscheduled = useMemo(() =>
    filtered.filter((a) => !a.scheduledAt && !["POSTED", "APPROVED"].includes(a.status)),
  [filtered]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow    = getFirstDayOfWeek(year, month);
  const today       = now.getDate();

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  async function saveSchedule(articleId: string) {
    if (!dateInput) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: new Date(dateInput).toISOString() }),
      });
      if (!res.ok) throw new Error();
      toast.success("กำหนดวันเผยแพร่แล้ว");
      // Optimistic update — reload page to reflect
      window.location.reload();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
      setEditingId(null);
    }
  }

  // Upcoming 30 days for list view
  const upcoming = useMemo(() => {
    return filtered
      .filter((a) => a.scheduledAt)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Content Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">วางแผนการเผยแพร่บทความ</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Project Filter */}
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="text-xs border border-gray-100 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-400/30"
          >
            <option value="ALL">ทุก Project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setView("month")}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all", view === "month" ? "bg-white shadow text-gray-900" : "text-gray-500")}
            >
              <CalendarDays className="h-3.5 w-3.5" />รายเดือน
            </button>
            <button
              onClick={() => setView("list")}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all", view === "list" ? "bg-white shadow text-gray-900" : "text-gray-500")}
            >
              <List className="h-3.5 w-3.5" />รายการ
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* ── Calendar / List ── */}
        <div className="xl:col-span-3">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {/* Month Nav */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="text-base font-bold text-gray-900">
                {MONTH_TH[month]} {year + 543}
              </h2>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {view === "month" ? (
              <>
                {/* Day headers */}
                <div className="grid grid-cols-7 border-b border-gray-100">
                  {DAY_TH.map((d) => (
                    <div key={d} className="px-2 py-2 text-center text-xs font-bold text-gray-400 uppercase tracking-wide">
                      {d}
                    </div>
                  ))}
                </div>
                {/* Cells */}
                <div className="grid grid-cols-7 auto-rows-[minmax(80px,auto)]">
                  {/* Empty cells before day 1 */}
                  {Array.from({ length: firstDow }).map((_, i) => (
                    <div key={`empty-${i}`} className="border-r border-b border-gray-50 bg-gray-50/30" />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day  = i + 1;
                    const isToday = day === today && month === now.getMonth() && year === now.getFullYear();
                    const dayArticles = dayMap[day] ?? [];
                    return (
                      <div
                        key={day}
                        onMouseEnter={() => setHoveredDay(day)}
                        onMouseLeave={() => setHoveredDay(null)}
                        className={cn(
                          "border-r border-b border-gray-100 p-1.5 min-h-[80px] transition-colors",
                          isToday && "bg-green-50/50",
                          hoveredDay === day && "bg-gray-50"
                        )}
                      >
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold mb-1",
                          isToday ? "bg-green-500 text-white" : "text-gray-600"
                        )}>
                          {day}
                        </div>
                        <div className="space-y-0.5">
                          {dayArticles.slice(0, 3).map((a) => (
                            <Link key={a.id} href={`/articles/${a.id}`}>
                              <div
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-medium truncate leading-4 cursor-pointer hover:opacity-80",
                                  STATUS_COLOR[a.status] ?? "bg-gray-100 text-gray-600"
                                )}
                                title={a.title}
                              >
                                <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1 flex-shrink-0", projectColors[a.project.id])} />
                                {a.title}
                              </div>
                            </Link>
                          ))}
                          {dayArticles.length > 3 && (
                            <div className="text-[10px] text-gray-400 px-1.5">+{dayArticles.length - 3} อื่นๆ</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* List view */
              <div className="divide-y divide-gray-50">
                {upcoming.length === 0 && (
                  <div className="py-12 text-center text-sm text-gray-400">ยังไม่มีบทความที่กำหนดวันเผยแพร่</div>
                )}
                {upcoming.map((a) => {
                  const d = new Date(a.scheduledAt!);
                  return (
                    <Link key={a.id} href={`/articles/${a.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="w-12 text-center flex-shrink-0">
                        <p className="text-lg font-bold text-gray-900 leading-none">{d.getDate()}</p>
                        <p className="text-xs text-gray-400">{MONTH_TH[d.getMonth()].slice(0, 3)}</p>
                      </div>
                      <div className={cn("w-1 h-10 rounded-full flex-shrink-0", projectColors[a.project.id])} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate text-sm">{a.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{a.project.name}{a.assignedTo ? ` · ${a.assignedTo.name}` : ""}</p>
                      </div>
                      <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0", STATUS_COLOR[a.status] ?? "bg-gray-100 text-gray-600")}>
                        {a.status}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 px-1 mt-3 flex-wrap">
            {projects.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className={cn("w-2.5 h-2.5 rounded-full", projectColors[p.id])} />
                {p.name}
              </div>
            ))}
          </div>
        </div>

        {/* ── Sidebar: Unscheduled ── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">ยังไม่กำหนดวัน</span>
            <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{unscheduled.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[500px]">
            {unscheduled.length === 0 && (
              <div className="py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-300 mx-auto mb-2" />
                <p className="text-xs text-gray-400">บทความทุกชิ้นกำหนดวันแล้ว</p>
              </div>
            )}
            {unscheduled.map((a) => (
              <div key={a.id} className="border-b border-gray-50 last:border-0 px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0", projectColors[a.project.id])} />
                  <div className="flex-1 min-w-0">
                    <Link href={`/articles/${a.id}`}>
                      <p className="text-xs font-semibold text-gray-800 hover:text-green-700 truncate">{a.title}</p>
                    </Link>
                    <p className="text-xs text-gray-400 mt-0.5">{a.project.name}</p>
                    {editingId === a.id ? (
                      <div className="mt-2 space-y-1.5">
                        <input
                          type="date"
                          value={dateInput}
                          onChange={(e) => setDateInput(e.target.value)}
                          className="w-full text-xs border border-gray-100 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-400/30"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => saveSchedule(a.id)}
                            disabled={saving || !dateInput}
                            className="flex-1 text-xs font-semibold bg-green-600 text-white py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            {saving ? "..." : "บันทึก"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="flex-1 text-xs text-gray-400 border border-gray-100 py-1 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingId(a.id); setDateInput(""); }}
                        className="mt-1.5 flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium"
                      >
                        <Plus className="h-3 w-3" />กำหนดวัน
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {unscheduled.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100">
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                {unscheduled.length} บทความยังไม่มีกำหนด
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
