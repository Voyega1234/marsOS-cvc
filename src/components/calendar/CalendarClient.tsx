"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays, List, Plus, Clock, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  EMPTY_PLAN,
  planViolation,
  timelineEntries,
  type TimelinePlan,
} from "@/lib/project-timeline";
import {
  OVERVIEW_STATUSES,
  overviewDay,
  overviewTime,
  type OverviewArticle,
  type OverviewClient,
} from "@/lib/article-overview";
import {
  EMPTY_OVERVIEW_FILTER,
  OverviewFilterBar,
  STATUS_CONFIG,
  SourceBadge,
  StatusChip,
  matchOverviewFilter,
  useMounted,
  type OverviewFilter,
} from "@/components/articles/article-status";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CLIENT_PALETTE = [
  "bg-violet-400", "bg-blue-400", "bg-green-400", "bg-amber-400",
  "bg-rose-400", "bg-teal-400", "bg-orange-400", "bg-pink-400",
  "bg-cyan-400", "bg-lime-400", "bg-fuchsia-400", "bg-sky-400",
];

// เวลาเริ่มต้นเมื่อกำหนดวันให้ Upload/PBN จากปฏิทิน (เวลาเครื่องผู้ใช้) — แก้เวลาละเอียดได้ที่หน้าของลูกค้า
const UPLOAD_DEFAULT_TIME = "09:00";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  // Monday-based: 0=Mon … 6=Sun
  const d = new Date(year, month, 1).getDay();
  return (d + 6) % 7;
}
function ymd(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTH_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const DAY_TH   = ["จ","อ","พ","พฤ","ศ","ส","อา"];
const DAY_FULL_TH = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];

const STATUS_ORDER: Record<string, number> = Object.fromEntries(OVERVIEW_STATUSES.map((s, i) => [s, i]));

function formatDayTitle(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `วัน${DAY_FULL_TH[dow]}ที่ ${d} ${MONTH_TH[m - 1]} ${y + 543}`;
}

export function CalendarClient({
  articles,
  clients,
  plans,
}: {
  /** บทความทั้งระบบ: SEO SME + Upload Article + PBN */
  articles: OverviewArticle[];
  clients: OverviewClient[];
  /** ช่วงเวลาทำงานของแต่ละโปรเจกต์ SEO SME (คีย์คือ project id) */
  plans?: Record<string, TimelinePlan>;
}) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [view, setView]   = useState<"month" | "list">("month");
  const [filter, setFilter] = useState<OverviewFilter>(EMPTY_OVERVIEW_FILTER);
  const [openDay, setOpenDay]       = useState<string | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [dateInput, setDateInput]   = useState("");
  const [saving, setSaving]         = useState(false);
  // วันของ Upload/PBN มาจาก ISO — คำนวณตามเวลาเครื่องหลัง mount (server render เป็น UTC)
  const mounted = useMounted();

  // สีประจำ client (จุดหน้าชื่อบทความ)
  const clientColors = useMemo(() => {
    const map: Record<string, string> = {};
    clients.forEach((c, i) => { map[c.id] = CLIENT_PALETTE[i % CLIENT_PALETTE.length]; });
    return map;
  }, [clients]);

  const filtered = useMemo(() => articles.filter((a) => matchOverviewFilter(a, filter)), [articles, filter]);

  // วัน (YYYY-MM-DD) → บทความ เรียงตามสถานะ แล้วตามเวลา
  const byDay = useMemo(() => {
    const map: Record<string, OverviewArticle[]> = {};
    filtered.forEach((a) => {
      const day = a.publishAt && !mounted ? "" : overviewDay(a);
      if (!day) return;
      (map[day] ??= []).push(a);
    });
    for (const list of Object.values(map)) {
      list.sort((x, y) => (STATUS_ORDER[x.status] - STATUS_ORDER[y.status]) || overviewTime(x).localeCompare(overviewTime(y)));
    }
    return map;
  }, [filtered, mounted]);

  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const monthDays = useMemo(
    () => Object.keys(byDay).filter((d) => d.startsWith(monthPrefix)).sort(),
    [byDay, monthPrefix],
  );
  const monthCount = monthDays.reduce((s, d) => s + byDay[d].length, 0);

  // ยังไม่มีวันเผยแพร่ (ตัดที่ push แล้วออก)
  const unscheduled = useMemo(
    () => (mounted ? filtered.filter((a) => !overviewDay(a) && a.status !== "pushed") : []),
    [filtered, mounted],
  );

  // client ที่มีบทความในเดือนนี้ — legend สีจุด
  const monthClients = useMemo(() => {
    const ids = new Set<string>();
    for (const d of monthDays) for (const a of byDay[d]) ids.add(a.clientId);
    return clients.filter((c) => ids.has(c.id));
  }, [monthDays, byDay, clients]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow    = getFirstDayOfWeek(year, month);
  const todayKey    = ymd(now.getFullYear(), now.getMonth(), now.getDate());

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function planOf(projectId: string): TimelinePlan {
    return plans?.[projectId] ?? EMPTY_PLAN;
  }

  /**
   * กำหนดวันเผยแพร่จากแถบ "ยังไม่กำหนดวัน"
   * SEO SME: เขียนวันกลับเข้า Project.timeline (ต้องอยู่ในช่วงงานของโปรเจกต์)
   * Upload/PBN: ตั้ง pushPrefs.publishAt ผ่าน schedule API — เวลา UPLOAD_DEFAULT_TIME ตามเครื่องผู้ใช้
   */
  async function saveSchedule(row: OverviewArticle) {
    if (!dateInput) return;
    if (row.source === "seo-sme") {
      const violation = planViolation(planOf(row.clientId), dateInput);
      if (violation) {
        toast.error(`เลือกวันนี้ไม่ได้ — ${violation} ของโปรเจกต์ แก้ช่วงเวลาได้ที่หน้า Project Timeline`);
        return;
      }
    }
    setSaving(true);
    try {
      if (row.source === "seo-sme") {
        const res = await fetch(`/api/projects/${row.clientId}`);
        if (!res.ok) throw new Error();
        const proj = await res.json();
        const entries = timelineEntries<Record<string, unknown>>(proj?.timeline);
        const entry = entries[row.entryIndex];
        if (!entry) throw new Error();
        entries[row.entryIndex] = { ...entry, date: dateInput };
        const save = await fetch(`/api/projects/${row.clientId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeline: { entries } }),
        });
        if (!save.ok) throw new Error();
      } else {
        if (!row.uploadArticleId) throw new Error();
        const publishAt = new Date(`${dateInput}T${UPLOAD_DEFAULT_TIME}`);
        if (Number.isNaN(publishAt.getTime())) throw new Error();
        const save = await fetch(`/api/upload-article/articles/${row.uploadArticleId}/schedule`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publishAt: publishAt.toISOString() }),
        });
        if (!save.ok) throw new Error();
      }
      toast.success("กำหนดวันเผยแพร่แล้ว");
      window.location.reload();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
      setEditingId(null);
    }
  }

  const openItems = openDay ? byDay[openDay] ?? [] : [];
  const openCounts = openItems.reduce<Record<string, number>>((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const filterActive = !!(filter.source || filter.status || filter.client || filter.search);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">Content Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">วางแผนการเผยแพร่บทความทั้งระบบ — SEO SME, Upload Article, PBN · กดที่วันเพื่อดูรายละเอียด</p>
        </div>
        {/* View Toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setView("month")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all", view === "month" ? "bg-white shadow text-brand-navy" : "text-gray-500")}
          >
            <CalendarDays className="h-3.5 w-3.5" />รายเดือน
          </button>
          <button
            onClick={() => setView("list")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all", view === "list" ? "bg-white shadow text-brand-navy" : "text-gray-500")}
          >
            <List className="h-3.5 w-3.5" />รายการ
          </button>
        </div>
      </div>

      <OverviewFilterBar articles={articles} clients={clients} filter={filter} onChange={setFilter} />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* ── Calendar / List ── */}
        <div className="xl:col-span-3 min-w-0">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {/* Month Nav */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button onClick={prevMonth} aria-label="เดือนก่อน" className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-center">
                <h2 className="text-base font-bold text-brand-navy" data-testid="calendar-month">
                  {MONTH_TH[month]} {year + 543}
                </h2>
                <p className="text-[11px] text-gray-400">{monthCount} บทความในเดือนนี้</p>
              </div>
              <button onClick={nextMonth} aria-label="เดือนถัดไป" className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {view === "month" ? (
              <div className="overflow-x-auto">
                {/* Day headers */}
                <div className="grid grid-cols-7 min-w-[640px] border-b border-gray-100">
                  {DAY_TH.map((d) => (
                    <div key={d} className="px-2 py-2 text-center text-xs font-bold text-gray-400 uppercase tracking-wide">
                      {d}
                    </div>
                  ))}
                </div>
                {/* Cells */}
                <div className="grid grid-cols-7 min-w-[640px] auto-rows-[minmax(88px,auto)]">
                  {/* Empty cells before day 1 */}
                  {Array.from({ length: firstDow }).map((_, i) => (
                    <div key={`empty-${i}`} className="border-r border-b border-gray-50 bg-gray-50/30" />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day  = i + 1;
                    const key  = ymd(year, month, day);
                    const isToday = key === todayKey;
                    const dayArticles = byDay[key] ?? [];
                    return (
                      <button
                        type="button"
                        key={day}
                        data-day={key}
                        onClick={() => setOpenDay(key)}
                        aria-label={`${formatDayTitle(key)} — ${dayArticles.length} บทความ`}
                        className={cn(
                          "border-r border-b border-gray-100 p-1.5 min-h-[88px] text-left align-top flex flex-col transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue cursor-pointer",
                          isToday && "bg-green-50/50"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold",
                            isToday ? "bg-green-500 text-white" : "text-gray-600"
                          )}>
                            {day}
                          </span>
                          {dayArticles.length > 0 && (
                            <span className="text-[10px] font-semibold text-gray-400">{dayArticles.length}</span>
                          )}
                        </div>
                        <div className="space-y-0.5 w-full">
                          {dayArticles.slice(0, 3).map((a) => (
                            <div
                              key={a.id}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-medium truncate leading-4",
                                STATUS_CONFIG[a.status].color
                              )}
                              title={`${a.title} · ${a.clientName} · ${STATUS_CONFIG[a.status].label}`}
                            >
                              <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1 flex-shrink-0", clientColors[a.clientId])} />
                              {a.title}
                            </div>
                          ))}
                          {dayArticles.length > 3 && (
                            <div className="text-[10px] font-medium text-brand-blue px-1.5">+{dayArticles.length - 3} อื่นๆ</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* List view — บทความของเดือนที่เลือก เรียงตามวัน */
              <div className="divide-y divide-gray-50" data-testid="calendar-list">
                {monthDays.length === 0 && (
                  <div className="py-12 text-center text-sm text-gray-400">ไม่มีบทความที่กำหนดวันเผยแพร่ในเดือนนี้</div>
                )}
                {monthDays.flatMap((day) => byDay[day].map((a) => {
                  const d = Number(day.slice(8, 10));
                  const time = overviewTime(a);
                  return (
                    <Link key={a.id} href={a.href} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="w-12 text-center flex-shrink-0">
                        <p className="text-lg font-bold text-brand-navy leading-none">{d}</p>
                        <p className="text-xs text-gray-400">{MONTH_TH[month].slice(0, 3)}</p>
                      </div>
                      <div className={cn("w-1 h-10 rounded-full flex-shrink-0", clientColors[a.clientId])} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-brand-navy truncate text-sm">{a.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <SourceBadge source={a.source} />
                          <span className="text-xs text-gray-400">{a.clientName}{time ? ` · ${time} น.` : ""}</span>
                        </div>
                      </div>
                      <StatusChip status={a.status} />
                    </Link>
                  );
                }))}
              </div>
            )}
          </div>

          {/* Legend — client ที่มีบทความในเดือนนี้ */}
          {monthClients.length > 0 && (
            <div className="flex items-center gap-3 px-1 mt-3 flex-wrap">
              {monthClients.map((c) => (
                <div key={c.id} className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className={cn("w-2.5 h-2.5 rounded-full", clientColors[c.id])} />
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sidebar: Unscheduled ── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">ยังไม่กำหนดวัน</span>
            <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{unscheduled.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[60vh] sm:max-h-[500px]">
            {unscheduled.length === 0 && (
              <div className="py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-300 mx-auto mb-2" />
                <p className="text-xs text-gray-400">บทความทุกชิ้นกำหนดวันแล้ว</p>
              </div>
            )}
            {unscheduled.map((a) => {
              const plan = a.source === "seo-sme" ? planOf(a.clientId) : EMPTY_PLAN;
              return (
                <div key={a.id} className="border-b border-gray-50 last:border-0 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0", clientColors[a.clientId])} />
                    <div className="flex-1 min-w-0">
                      <Link href={a.href}>
                        <p className="text-xs font-semibold text-gray-800 hover:text-green-700 truncate">{a.title}</p>
                      </Link>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <StatusChip status={a.status} />
                        <span className="text-[11px] text-gray-400 truncate">{a.clientName}</span>
                      </div>
                      {editingId === a.id ? (
                        <div className="mt-2 space-y-1.5">
                          <input
                            type="date"
                            value={dateInput}
                            min={plan.startDate ?? undefined}
                            max={plan.endDate ?? undefined}
                            onChange={(e) => setDateInput(e.target.value)}
                            className="w-full text-xs border border-gray-100 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-400/30"
                          />
                          {(plan.startDate || plan.endDate) && (
                            <p className="text-[10px] text-gray-400">
                              ช่วงงานโปรเจกต์ {plan.startDate ?? "ไม่กำหนด"} ถึง{" "}
                              {plan.endDate ?? "ไม่กำหนด"}
                            </p>
                          )}
                          {a.source !== "seo-sme" && (
                            <p className="text-[10px] text-gray-400">ตั้งเวลา {UPLOAD_DEFAULT_TIME} น. — แก้เวลาได้ที่หน้าของลูกค้า</p>
                          )}
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => saveSchedule(a)}
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
              );
            })}
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

      {/* ── รายละเอียดของวันที่กด ── */}
      <Dialog open={!!openDay} onOpenChange={(o) => { if (!o) setOpenDay(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-3 p-0 overflow-hidden" data-testid="calendar-day-dialog">
          <DialogHeader className="px-6 pt-6 pb-0 text-left">
            <DialogTitle className="text-base text-brand-navy pr-6">{openDay ? formatDayTitle(openDay) : ""}</DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              {openItems.length} บทความ{filterActive ? " (ตาม filter ที่เลือก)" : ""}
            </DialogDescription>
          </DialogHeader>
          {openItems.length > 0 && (
            <div className="px-6 flex flex-wrap gap-1.5">
              {OVERVIEW_STATUSES.filter((s) => openCounts[s]).map((s) => (
                <span key={s} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold", STATUS_CONFIG[s].color)}>
                  {STATUS_CONFIG[s].label} {openCounts[s]}
                </span>
              ))}
            </div>
          )}
          <div className="overflow-y-auto px-6 pb-6 divide-y divide-gray-100 border-t border-gray-100">
            {openItems.length === 0 && (
              <p className="py-10 text-center text-sm text-gray-400">ไม่มีบทความในวันนี้{filterActive ? "ตาม filter ที่เลือก" : ""}</p>
            )}
            {openItems.map((a) => {
              const time = overviewTime(a);
              return (
                <div key={a.id} className="py-3 flex items-start gap-3" data-testid="calendar-day-item">
                  <span className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", clientColors[a.clientId])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 leading-snug">{a.title || a.keyword}</p>
                    {a.keyword && a.keyword !== a.title && (
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate">keyword: {a.keyword}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <SourceBadge source={a.source} />
                      <span className="text-[11px] text-gray-500">{a.clientName}</span>
                      {time && <span className="text-[11px] text-gray-400">· {time} น.</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <StatusChip status={a.status} />
                    <Link href={a.href} className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:underline whitespace-nowrap">
                      <ExternalLink size={10} /> ไปดู
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
