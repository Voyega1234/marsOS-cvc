"use client";

// ─────────────────────────────────────────────────────────────────────────────
//  ProjectTimeline — แผนงานทั้งโปรเจกต์
//
//  คำสั่งเจ้าของ 2026-09-11: ทีมเป็นคนกำหนดวันเริ่มงาน/วันจบงานเอง งานไม่ได้เริ่ม
//  จากการลงบทความ ตารางลงบทความจึงเป็นแค่งานย่อยที่ต้องอยู่ในช่วงที่ทีมตั้งไว้
//  ส่วนงาน On-Page / Technical / Indexing เป็นงานหลักในไทม์ไลน์เดียวกัน
//
//  ช่วงเวลาโปรเจกต์เก็บใน Project.timeline (ดู src/lib/project-timeline.ts)
//  ไม่มี mock data — ทุกอย่างมาจาก API จริงของโปรเจกต์
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  LayoutGrid,
  List as ListIcon,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import {
  EMPTY_PLAN,
  parseTimeline,
  planViolation,
  type TimelinePlan,
} from "@/lib/project-timeline";
import type { WorkspaceProject } from "./types";
import { useSeoTaskSync } from "./useSeoTaskSync";

interface Props {
  project: WorkspaceProject;
  userRole: string;
}

// ── Real data shapes ─────────────────────────────────────────────────────────

/** Subset ของ TimelineEntry ตามที่ ClientDetailTabs.tsx ใช้จริง (Project.timeline JSON) */
interface RawTimelineEntry {
  date?: string;
  title?: string;
  keyword?: string;
  weekLabel?: string;
  phase?: number;
  priority?: string;
  intent?: string;
  volume?: number;
  isCore?: boolean;
}

interface ArticleLite {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

interface SeoTaskLite {
  id: string;
  area: string;
  category: string;
  title: string;
  detail: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  owner?: { id: string; name: string | null } | null;
}

type DerivedStatus =
  | "Not Started"
  | "In Progress"
  | "Waiting for Review"
  | "Approved"
  | "Published"
  | "Error";

interface TimelineItem {
  id: string;
  date: string;
  title: string;
  keyword?: string;
  status: DerivedStatus;
  matchedArticle: ArticleLite | null;
}

type SelectedDrawer =
  | { kind: "content"; item: TimelineItem }
  | { kind: "seo"; item: SeoTaskLite }
  | null;

type ViewMode = "gantt" | "list" | "kanban";

// ── Status meta ──────────────────────────────────────────────────────────────

const STATUS_LIST: DerivedStatus[] = [
  "Not Started",
  "In Progress",
  "Waiting for Review",
  "Approved",
  "Published",
  "Error",
];

const STATUS_META: Record<DerivedStatus, { color: string; dot: string; text: string; badgeBg: string; label: string }> = {
  "Not Started": { color: "#9CA3AF", dot: "bg-gray-400", text: "text-gray-600", badgeBg: "bg-gray-50", label: "Not Started" },
  "In Progress": { color: "#3B82F6", dot: "bg-blue-500", text: "text-brand-blue", badgeBg: "bg-blue-50", label: "In Progress" },
  "Waiting for Review": { color: "#F59E0B", dot: "bg-amber-500", text: "text-amber-600", badgeBg: "bg-amber-50", label: "Waiting for Review" },
  Approved: { color: "#10B981", dot: "bg-emerald-500", text: "text-emerald-600", badgeBg: "bg-emerald-50", label: "Approved" },
  Published: { color: "#0D9488", dot: "bg-teal-600", text: "text-teal-700", badgeBg: "bg-teal-50", label: "Published" },
  Error: { color: "#EF4444", dot: "bg-red-500", text: "text-red-600", badgeBg: "bg-red-50", label: "Error" },
};

const PRIORITY_BADGE: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-600",
  MEDIUM: "bg-blue-100 text-blue-700",
  HIGH: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
  URGENT: "bg-red-100 text-red-700",
};

function priorityBadge(p?: string | null) {
  return PRIORITY_BADGE[(p ?? "MEDIUM").toUpperCase()] ?? "bg-gray-100 text-gray-600";
}

function seoTaskStatusMeta(status: string) {
  const s = (status || "TODO").toUpperCase();
  if (s === "DONE" || s === "COMPLETED") return { dot: "bg-emerald-500", text: "text-emerald-600", label: "เสร็จแล้ว" };
  if (s === "IN_PROGRESS" || s === "DOING") return { dot: "bg-blue-500", text: "text-brand-blue", label: "กำลังทำ" };
  return { dot: "bg-gray-400", text: "text-gray-600", label: "ยังไม่เริ่ม" };
}

function isSeoTaskDone(status: string) {
  const s = (status || "").toUpperCase();
  return s === "DONE" || s === "COMPLETED";
}

/** ผูก status บทความจริง (Article.status) เข้ากับสถานะที่ผู้ใช้เข้าใจได้ */
function deriveStatus(dbStatus: string | undefined): DerivedStatus {
  if (!dbStatus) return "Not Started";
  if (dbStatus === "WRITING") return "In Progress";
  if (dbStatus === "ARTICLE_DONE" || dbStatus === "SEO_REVIEW") return "Waiting for Review";
  if (dbStatus === "APPROVED") return "Approved";
  if (dbStatus === "WORDPRESS_DRAFTED" || dbStatus === "POSTED") return "Published";
  if (dbStatus === "ERROR") return "Error";
  return "Not Started";
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function toDate(iso: string): Date {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d;
}

function formatDateTh(iso?: string | null) {
  if (!iso) return "—";
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTimeTh(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function monthKey(iso: string) {
  const d = toDate(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectTimeline({ project, userRole }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawEntries, setRawEntries] = useState<RawTimelineEntry[]>([]);
  const [articles, setArticles] = useState<ArticleLite[]>([]);
  const [seoTasks, setSeoTasks] = useState<SeoTaskLite[]>([]);

  // ช่วงเวลาโปรเจกต์ที่ทีมตั้งเอง — plan คือค่าที่บันทึกแล้ว, draft คือค่าที่กำลังแก้
  const [plan, setPlan] = useState<TimelinePlan>(EMPTY_PLAN);
  const [planDraft, setPlanDraft] = useState<TimelinePlan>(EMPTY_PLAN);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("gantt");
  const [statusFilter, setStatusFilter] = useState<DerivedStatus | "all">("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [selected, setSelected] = useState<SelectedDrawer>(null);

  const isReadOnly = userRole === "CLIENT"; // read-only anyway — no mutations on this page

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [projRes, artRes, taskRes] = await Promise.all([
        fetch(`/api/projects/${project.id}`),
        fetch(`/api/articles?projectId=${project.id}`),
        fetch(`/api/projects/${project.id}/seo-tasks`),
      ]);
      if (!projRes.ok) throw new Error("โหลดข้อมูลโปรเจกต์ไม่สำเร็จ");
      const proj = await projRes.json();
      const articlesJson = artRes.ok ? await artRes.json() : [];
      const seoTasksJson = taskRes.ok ? await taskRes.json() : [];

      const doc = parseTimeline<RawTimelineEntry>(proj?.timeline);
      const entries = doc.entries;

      setPlan(doc.plan);
      // refetch เงียบ ๆ ห้ามลบสิ่งที่ทีมกำลังพิมพ์อยู่ในช่องวันที่
      if (!quiet) setPlanDraft(doc.plan);
      setRawEntries(entries);
      setArticles(Array.isArray(articlesJson) ? articlesJson : []);
      setSeoTasks(Array.isArray(seoTasksJson) ? seoTasksJson : []);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาดในการโหลดข้อมูล");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // งาน SEO ถูกแก้จากแท็บ On-Page/Technical/Indexing หรือแท็บ browser อื่น → refetch เงียบ ๆ
  const quietRefetch = useCallback(() => fetchData(true), [fetchData]);
  useSeoTaskSync(project.id, quietRefetch);

  /**
   * บันทึกช่วงเวลาโปรเจกต์
   * ส่งเฉพาะ plan — ฝั่ง API จะ merge เข้ากับรายการบทความเดิมให้เอง
   * (mergeTimelineWrite ใน src/lib/project-timeline.ts) จึงไม่มีทางทับตารางบทความหาย
   */
  const savePlan = useCallback(async () => {
    if (planDraft.startDate && planDraft.endDate && planDraft.endDate < planDraft.startDate) {
      setPlanError("วันจบงานต้องไม่มาก่อนวันเริ่มงาน");
      return;
    }
    setSavingPlan(true);
    setPlanError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeline: { plan: planDraft } }),
      });
      if (!res.ok) throw new Error("บันทึกช่วงเวลาไม่สำเร็จ");
      const saved = await res.json();
      const doc = parseTimeline<RawTimelineEntry>(saved?.timeline);
      setPlan(doc.plan);
      setPlanDraft(doc.plan);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "บันทึกช่วงเวลาไม่สำเร็จ");
    } finally {
      setSavingPlan(false);
    }
  }, [project.id, planDraft]);

  const planDays =
    plan.startDate && plan.endDate
      ? Math.round((toDate(plan.endDate).getTime() - toDate(plan.startDate).getTime()) / 86400000) + 1
      : 0;

  const planDirty =
    planDraft.startDate !== plan.startDate ||
    planDraft.endDate !== plan.endDate ||
    (planDraft.note ?? "") !== (plan.note ?? "");

  // ── Derive content items: match timeline entry ↔ real article by trimmed title ──
  const items: TimelineItem[] = useMemo(() => {
    const articleMap = new Map<string, ArticleLite>();
    for (const a of articles) {
      if (a.title) articleMap.set(a.title.trim(), a);
    }
    return rawEntries
      .filter((e) => e?.date && e?.title)
      .map((e, idx) => {
        const matched = articleMap.get((e.title ?? "").trim()) ?? null;
        return {
          id: `${e.date}-${idx}`,
          date: e.date as string,
          title: e.title as string,
          keyword: e.keyword,
          status: deriveStatus(matched?.status),
          matchedArticle: matched,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [rawEntries, articles]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(monthKey(it.date));
    for (const t of seoTasks) if (t.dueDate) set.add(monthKey(t.dueDate));
    return Array.from(set).sort();
  }, [items, seoTasks]);

  const monthFilteredItems = useMemo(
    () => (monthFilter === "all" ? items : items.filter((it) => monthKey(it.date) === monthFilter)),
    [items, monthFilter]
  );

  const filteredItems = useMemo(
    () => (statusFilter === "all" ? monthFilteredItems : monthFilteredItems.filter((it) => it.status === statusFilter)),
    [monthFilteredItems, statusFilter]
  );

  const seoTasksWithDue = useMemo(() => {
    return seoTasks
      .filter((t) => !!t.dueDate)
      .filter((t) => monthFilter === "all" || monthKey(t.dueDate as string) === monthFilter)
      .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string));
  }, [seoTasks, monthFilter]);

  const seoTasksNoDue = useMemo(() => seoTasks.filter((t) => !t.dueDate), [seoTasks]);

  // งานที่วันหลุดช่วงที่ทีมตั้งไว้ — เตือนให้เห็น ไม่ซ่อน เพราะเป็นของจริงใน DB
  const outOfRange = useMemo(() => {
    const rows: { key: string; kind: "content" | "seo"; title: string; date: string; reason: string }[] = [];
    for (const it of items) {
      const reason = planViolation(plan, it.date);
      if (reason) rows.push({ key: `c-${it.id}`, kind: "content", title: it.title, date: it.date, reason });
    }
    for (const t of seoTasks) {
      const reason = planViolation(plan, t.dueDate);
      if (reason) rows.push({ key: `s-${t.id}`, kind: "seo", title: t.title, date: t.dueDate as string, reason });
    }
    return rows;
  }, [items, seoTasks, plan]);

  const statusCounts = useMemo(() => {
    const counts: Record<DerivedStatus, number> = {
      "Not Started": 0,
      "In Progress": 0,
      "Waiting for Review": 0,
      Approved: 0,
      Published: 0,
      Error: 0,
    };
    for (const it of monthFilteredItems) counts[it.status]++;
    return counts;
  }, [monthFilteredItems]);

  const donutSegments = useMemo(() => {
    const total = monthFilteredItems.length || 1;
    let cumulative = 0;
    return STATUS_LIST.map((status) => {
      const count = statusCounts[status];
      const fraction = count / total;
      const startAngle = cumulative * 360;
      cumulative += fraction;
      const endAngle = cumulative * 360;
      return { status, count, fraction, startAngle, endAngle };
    });
  }, [statusCounts, monthFilteredItems.length]);

  const progressPct = items.length
    ? Math.round((items.filter((it) => it.status === "Published").length / items.length) * 100)
    : 0;

  const seoOpenCount = seoTasks.filter((t) => !isSeoTaskDone(t.status)).length;
  const seoDoneCount = seoTasks.filter((t) => isSeoTaskDone(t.status)).length;

  const groupedByMonth = useMemo(() => {
    const groups = new Map<string, TimelineItem[]>();
    for (const it of filteredItems) {
      const key = monthKey(it.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, entries]) => ({ key, label: monthLabel(key), entries }));
  }, [filteredItems]);

  function handleStatusSegmentClick(status: DerivedStatus) {
    setStatusFilter((prev) => (prev === status ? "all" : status));
  }

  function clearFilters() {
    setStatusFilter("all");
    setMonthFilter("all");
  }

  const hasPlan = Boolean(plan.startDate || plan.endDate);
  const hasAnyData = items.length > 0 || seoTasks.length > 0 || hasPlan;

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="h-5 w-40 rounded bg-gray-100" />
          <div className="mt-2 h-4 w-64 rounded bg-gray-100" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="h-4 w-24 rounded bg-gray-100" />
              <div className="mt-4 h-24 rounded bg-gray-50" />
            </div>
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-brand-navy">Project Timeline</h2>
            <p className="text-sm text-gray-500">
              {project.clientName ?? project.name} · งาน SEO ทั้งหมด + ตารางลงบทความ ภายในช่วงเวลาที่ทีมกำหนด
            </p>
          </div>

          {!error && hasAnyData && (
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("gantt")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "gantt" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <CalendarDays className="h-4 w-4" />
                Gantt
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "list" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <ListIcon className="h-4 w-4" />
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("kanban")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "kanban" ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                Kanban
              </button>
            </div>
          )}
        </div>

        {!error && hasAnyData && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as DerivedStatus | "all")}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">สถานะทั้งหมด</option>
              {STATUS_LIST.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">เดือนทั้งหมด</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>

            {(statusFilter !== "all" || monthFilter !== "all") && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                ล้างตัวกรอง
              </button>
            )}

            {isReadOnly && (
              <span className="ml-auto text-xs text-gray-400">มุมมองอ่านอย่างเดียว</span>
            )}
          </div>
        )}
      </div>

      {/* ── ช่วงเวลาโปรเจกต์ — ทีมกำหนดเอง งานทุกอย่างยึดตามช่วงนี้ ── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-brand-navy">
              <CalendarDays className="h-4 w-4 text-indigo-600" />
              ช่วงเวลาทำงานของโปรเจกต์
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              ทีมเลือกวันเริ่มงานและวันจบงานเอง งาน SEO และตารางลงบทความทั้งหมดต้องอยู่ในช่วงนี้
            </p>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              onClick={savePlan}
              disabled={savingPlan || !planDirty}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              {savingPlan ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {savingPlan ? "กำลังบันทึก" : "บันทึกช่วงเวลา"}
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">วันเริ่มงาน</label>
            <input
              type="date"
              value={planDraft.startDate ?? ""}
              max={planDraft.endDate ?? undefined}
              disabled={isReadOnly}
              onChange={(e) => setPlanDraft((p) => ({ ...p, startDate: e.target.value || null }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">วันจบงาน</label>
            <input
              type="date"
              value={planDraft.endDate ?? ""}
              min={planDraft.startDate ?? undefined}
              disabled={isReadOnly}
              onChange={(e) => setPlanDraft((p) => ({ ...p, endDate: e.target.value || null }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">บันทึกของทีม (ไม่บังคับ)</label>
            <input
              type="text"
              value={planDraft.note ?? ""}
              disabled={isReadOnly}
              placeholder="เช่น งวดที่ 1 — SEO ฐานราก + บทความชุดแรก"
              onChange={(e) => setPlanDraft((p) => ({ ...p, note: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>
        </div>

        {planError && <p className="mt-2 text-xs text-red-600">{planError}</p>}

        {hasPlan ? (
          <p className="mt-2 text-xs text-gray-500">
            ช่วงงานปัจจุบัน: <span className="font-medium text-brand-navy">{formatDateTh(plan.startDate)}</span> ถึง{" "}
            <span className="font-medium text-brand-navy">{formatDateTh(plan.endDate)}</span>
            {planDays ? ` · รวม ${planDays} วัน` : ""}
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-600">
            ยังไม่ได้ตั้งช่วงเวลา — ตั้งก่อน แล้วแท็บ Content Map จะจำกัดวันลงบทความให้อยู่ในช่วงนี้อัตโนมัติ
          </p>
        )}

        {outOfRange.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800">
              มี {outOfRange.length} รายการที่วันอยู่นอกช่วงงาน — แก้วันในแท็บต้นทางหรือขยายช่วงงาน
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {outOfRange.slice(0, 8).map((r) => (
                <li key={r.key} className="text-[11px] text-amber-700">
                  · [{r.kind === "content" ? "บทความ" : "งาน SEO"}] {r.title} — {formatDateTh(r.date)} {r.reason}
                </li>
              ))}
              {outOfRange.length > 8 && (
                <li className="text-[11px] text-amber-600">· และอีก {outOfRange.length - 8} รายการ</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchData()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            ลองใหม่
          </button>
        </div>
      ) : !hasAnyData ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
          <CalendarDays className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-700">ยังไม่มีแผนงาน</p>
          <p className="mt-1 text-sm text-gray-500">
            เริ่มจากตั้งวันเริ่มงาน/วันจบงานด้านบน แล้วเพิ่มงาน SEO ในแท็บ On-Page / Technical / Indexing
            <br />
            ตารางลงบทความสร้างได้จากแท็บ Content Map (เลือก keywords → Generate Content Map)
          </p>
          {seoTasks.length > 0 && (
            <p className="mt-4 text-xs text-gray-400">
              โปรเจกต์นี้มีงาน SEO อยู่ {seoTasks.length} งาน — เปิดดูได้ในแท็บ On-Page / Technical
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Status Donut */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-brand-navy">สรุปสถานะบทความ</h3>
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0">
                  {donutSegments.map((seg) => {
                    if (seg.count === 0) return null;
                    const r = 40;
                    const cx = 50;
                    const cy = 50;
                    const startRad = (seg.startAngle - 90) * (Math.PI / 180);
                    const endRad = (seg.endAngle - 90) * (Math.PI / 180);
                    const x1 = cx + r * Math.cos(startRad);
                    const y1 = cy + r * Math.sin(startRad);
                    const x2 = cx + r * Math.cos(endRad);
                    const y2 = cy + r * Math.sin(endRad);
                    const largeArc = seg.endAngle - seg.startAngle > 180 ? 1 : 0;
                    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                    const isActive = statusFilter === seg.status;
                    return (
                      <path
                        key={seg.status}
                        d={path}
                        fill={STATUS_META[seg.status].color}
                        opacity={statusFilter === "all" || isActive ? 1 : 0.3}
                        stroke="#fff"
                        strokeWidth={1}
                        className="cursor-pointer transition"
                        onClick={() => handleStatusSegmentClick(seg.status)}
                      >
                        <title>{`${seg.status}: ${seg.count} บทความ`}</title>
                      </path>
                    );
                  })}
                  <circle cx={50} cy={50} r={22} fill="white" />
                  <text x={50} y={47} textAnchor="middle" className="fill-gray-900 text-[14px] font-semibold">
                    {monthFilteredItems.length}
                  </text>
                  <text x={50} y={59} textAnchor="middle" className="fill-gray-500 text-[7px]">
                    บทความทั้งหมด
                  </text>
                </svg>
                <div className="flex flex-1 flex-col gap-1">
                  {STATUS_LIST.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStatusSegmentClick(s)}
                      className={`flex items-center justify-between rounded px-1.5 py-0.5 text-left text-xs transition hover:bg-gray-50 ${
                        statusFilter === s ? "bg-gray-100" : ""
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-gray-600">
                        <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />
                        {s}
                      </span>
                      <span className="font-medium text-brand-navy">{statusCounts[s]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-brand-navy">
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                ความคืบหน้าโดยรวม
              </h3>
              <p className="text-3xl font-semibold text-brand-navy">{progressPct}%</p>
              <p className="mt-1 text-xs text-gray-500">
                เผยแพร่แล้ว {items.filter((it) => it.status === "Published").length} / {items.length} บทความ
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {/* SEO tasks mini card */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-brand-navy">
                <ClipboardList className="h-4 w-4 text-indigo-600" />
                งาน SEO
              </h3>
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-2xl font-semibold text-brand-navy">{seoOpenCount}</p>
                  <p className="text-xs text-gray-500">ค้างอยู่</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-emerald-600">{seoDoneCount}</p>
                  <p className="text-xs text-gray-500">เสร็จแล้ว</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-gray-400">{seoTasksNoDue.length}</p>
                  <p className="text-xs text-gray-500">ไม่มีกำหนด</p>
                </div>
              </div>
            </div>
          </div>

          {/* Main view area */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            {viewMode === "gantt" && (
              <GanttView
                plan={plan}
                groupedByMonth={groupedByMonth}
                seoTasksWithDue={seoTasksWithDue}
                onItemClick={(item) => setSelected({ kind: "content", item })}
                onSeoClick={(task) => setSelected({ kind: "seo", item: task })}
              />
            )}
            {viewMode === "list" && (
              <ListView
                items={filteredItems}
                seoTasks={seoTasksWithDue}
                onItemClick={(item) => setSelected({ kind: "content", item })}
                onSeoClick={(task) => setSelected({ kind: "seo", item: task })}
              />
            )}
            {viewMode === "kanban" && (
              <KanbanView items={monthFilteredItems} onItemClick={(item) => setSelected({ kind: "content", item })} />
            )}
          </div>

          {seoTasksNoDue.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-brand-navy">งาน SEO ที่ยังไม่มีกำหนด ({seoTasksNoDue.length})</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {seoTasksNoDue.map((t) => {
                  const meta = seoTaskStatusMeta(t.status);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelected({ kind: "seo", item: t })}
                      className="rounded-lg border border-gray-200 p-2.5 text-left text-xs transition hover:border-indigo-300 hover:shadow"
                    >
                      <p className="font-medium text-brand-navy">{t.title}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className={`flex items-center gap-1 ${meta.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${priorityBadge(t.priority)}`}>
                          {t.priority}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {selected && <DetailDrawer selected={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Gantt View ───────────────────────────────────────────────────────────────

function GanttView({
  plan,
  groupedByMonth,
  seoTasksWithDue,
  onItemClick,
  onSeoClick,
}: {
  plan: TimelinePlan;
  groupedByMonth: { key: string; label: string; entries: TimelineItem[] }[];
  seoTasksWithDue: SeoTaskLite[];
  onItemClick: (item: TimelineItem) => void;
  onSeoClick: (task: SeoTaskLite) => void;
}) {
  const allDates: Date[] = [
    ...groupedByMonth.flatMap((g) => g.entries.map((e) => toDate(e.date))),
    ...seoTasksWithDue.map((t) => toDate(t.dueDate as string)),
    ...(plan.startDate ? [toDate(plan.startDate)] : []),
    ...(plan.endDate ? [toDate(plan.endDate)] : []),
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let rangeStart: Date;
  let rangeEnd: Date;
  if (allDates.length === 0) {
    rangeStart = new Date(today.getTime() - 14 * 86400000);
    rangeEnd = new Date(today.getTime() + 14 * 86400000);
  } else {
    // ช่วงของกราฟยึดวันที่จริงทั้งหมด รวมช่วงงานที่ทีมตั้งไว้ด้วย
    const times = allDates.map((d) => d.getTime());
    rangeStart = new Date(Math.min(...times) - 7 * 86400000);
    rangeEnd = new Date(Math.max(...times) + 7 * 86400000);
  }
  const rangeDays = Math.max(Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000), 1);

  function dayOffset(iso: string) {
    return Math.round((toDate(iso).getTime() - rangeStart.getTime()) / 86400000);
  }
  function pct(days: number) {
    return (days / rangeDays) * 100;
  }

  const todayOffset = Math.round((today.getTime() - rangeStart.getTime()) / 86400000);
  const todayPct = pct(todayOffset);

  const markers: { label: string; offset: number }[] = [];
  for (let d = 0; d <= rangeDays; d += 7) {
    const date = new Date(rangeStart.getTime() + d * 86400000);
    markers.push({ label: date.toLocaleDateString("th-TH", { day: "numeric", month: "short" }), offset: d });
  }

  const noData = groupedByMonth.length === 0 && seoTasksWithDue.length === 0 && !plan.startDate && !plan.endDate;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 800 }}>
        <div className="relative mb-2 flex border-b border-gray-200 pb-2 pl-48">
          <div className="relative h-5 flex-1">
            {markers.map((m) => (
              <span key={m.offset} className="absolute text-[11px] font-medium text-gray-500" style={{ left: `${pct(m.offset)}%` }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-48 right-0">
            <div className="absolute top-0 bottom-0 w-px bg-red-400" style={{ left: `${todayPct}%` }}>
              <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-red-500">วันนี้</span>
            </div>
          </div>

          {/* แถบช่วงงานของโปรเจกต์ — ทุกงานควรอยู่ในแถบนี้ */}
          {(plan.startDate || plan.endDate) && (
            <div className="flex items-center border-b border-gray-200 py-1.5">
              <div className="w-48 shrink-0 pr-2 text-xs font-semibold text-brand-navy">ช่วงงานโปรเจกต์</div>
              <div className="relative h-6 flex-1">
                <div
                  className="absolute top-1.5 h-3 rounded-full bg-indigo-200 ring-1 ring-indigo-300"
                  title={`${formatDateTh(plan.startDate)} — ${formatDateTh(plan.endDate)}`}
                  style={{
                    left: `${pct(plan.startDate ? dayOffset(plan.startDate) : 0)}%`,
                    width: `${Math.max(
                      pct(
                        (plan.endDate ? dayOffset(plan.endDate) : rangeDays) -
                          (plan.startDate ? dayOffset(plan.startDate) : 0)
                      ),
                      1
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {seoTasksWithDue.length > 0 && (
            <div className="relative">
              <div className="sticky left-0 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                งาน SEO (On-Page / Technical / Indexing)
              </div>
              {seoTasksWithDue.map((task) => {
                const offset = dayOffset(task.dueDate as string);
                const meta = seoTaskStatusMeta(task.status);
                return (
                  <div key={task.id} className="flex items-center border-b border-gray-100 py-1.5">
                    <div className="w-48 shrink-0 truncate pr-2 text-xs text-gray-700" title={task.title}>
                      {task.title}
                    </div>
                    <div className="relative h-6 flex-1">
                      <button
                        type="button"
                        onClick={() => onSeoClick(task)}
                        title={`${task.title}\nกำหนดส่ง: ${formatDateTh(task.dueDate)}\nสถานะ: ${meta.label}`}
                        className={`absolute top-1 h-4 w-4 -translate-x-1/2 rotate-45 cursor-pointer ${meta.dot} ring-2 ring-white transition hover:scale-125`}
                        style={{ left: `${pct(offset)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {groupedByMonth.length > 0 && (
            <div className="relative mt-2 border-t border-gray-200 pt-1">
              {/* ตารางลงบทความเป็นงานย่อยของแผนงานหลัก (คำสั่งเจ้าของ 2026-09-11) */}
              <div className="sticky left-0 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">
                ตารางลงบทความ (งานย่อย)
              </div>
          {groupedByMonth.map((group) => (
            <div key={group.key} className="relative">
              <div className="sticky left-0 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-700">{group.label}</div>
              {group.entries.map((entry) => {
                const offset = dayOffset(entry.date);
                const meta = STATUS_META[entry.status];
                return (
                  <div key={entry.id} className="flex items-center border-b border-gray-100 py-1.5">
                    <div className="w-48 shrink-0 truncate pr-2 text-xs text-gray-700" title={entry.title}>
                      {entry.title}
                    </div>
                    <div className="relative h-6 flex-1">
                      <button
                        type="button"
                        onClick={() => onItemClick(entry)}
                        title={`${entry.title}\nวันที่: ${formatDateTh(entry.date)}\nสถานะ: ${entry.status}`}
                        className={`absolute top-1 h-4 w-4 -translate-x-1/2 cursor-pointer rounded-full ${meta.dot} ring-2 ring-white transition hover:scale-125`}
                        style={{ left: `${pct(offset)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
            </div>
          )}

          {noData && <p className="py-6 text-center text-sm text-gray-500">ไม่พบรายการตามตัวกรองที่เลือก</p>}
        </div>
      </div>
    </div>
  );
}

// ── List View ────────────────────────────────────────────────────────────────

function ListView({
  items,
  seoTasks,
  onItemClick,
  onSeoClick,
}: {
  items: TimelineItem[];
  seoTasks: SeoTaskLite[];
  onItemClick: (item: TimelineItem) => void;
  onSeoClick: (task: SeoTaskLite) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-3">งาน</th>
            <th className="py-2 pr-3">วันที่</th>
            <th className="py-2 pr-3">สถานะจริง</th>
            <th className="py-2 pr-3">บทความที่เชื่อม</th>
          </tr>
        </thead>
        <tbody>
          {seoTasks.map((t) => {
            const meta = seoTaskStatusMeta(t.status);
            return (
              <tr
                key={t.id}
                onClick={() => onSeoClick(t)}
                className="cursor-pointer border-b border-gray-100 bg-indigo-50/40 transition hover:bg-indigo-50"
              >
                <td className="py-2 pr-3">
                  <p className="font-medium text-brand-navy">{t.title}</p>
                  <p className="text-xs text-gray-400">
                    งาน SEO · {t.area} · {t.category}
                  </p>
                </td>
                <td className="py-2 pr-3 text-gray-600">{formatDateTh(t.dueDate)}</td>
                <td className="py-2 pr-3">
                  <span className={`inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium ${meta.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                </td>
                <td className="py-2 pr-3 text-center text-gray-300">—</td>
              </tr>
            );
          })}
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => onItemClick(item)}
              className="cursor-pointer border-b border-gray-100 transition hover:bg-gray-50"
            >
              <td className="py-2 pr-3">
                <p className="font-medium text-brand-navy">{item.title}</p>
                {item.keyword && <p className="text-xs text-gray-400">{item.keyword}</p>}
              </td>
              <td className="py-2 pr-3 text-gray-600">{formatDateTh(item.date)}</td>
              <td className="py-2 pr-3">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_META[item.status].text} ${STATUS_META[item.status].badgeBg}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[item.status].dot}`} />
                  {item.status}
                </span>
              </td>
              <td className="py-2 pr-3 text-center">
                {item.matchedArticle ? (
                  <span className="text-emerald-600" title={item.matchedArticle.title}>✓</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && seoTasks.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-sm text-gray-500">
                ไม่พบรายการตามตัวกรองที่เลือก
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Kanban View ──────────────────────────────────────────────────────────────

function KanbanView({ items, onItemClick }: { items: TimelineItem[]; onItemClick: (item: TimelineItem) => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-3">
        {STATUS_LIST.map((status) => {
          const columnItems = items.filter((it) => it.status === status);
          return (
            <div key={status} className="w-64 shrink-0 rounded-xl bg-gray-50 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                  <span className={`h-2 w-2 rounded-full ${STATUS_META[status].dot}`} />
                  {status}
                </span>
                <span className="text-xs text-gray-400">{columnItems.length}</span>
              </div>
              <div className="space-y-2">
                {columnItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick(item)}
                    className="block w-full rounded-lg border border-gray-200 bg-white p-2.5 text-left shadow-sm transition hover:shadow"
                  >
                    <p className="text-xs font-medium text-brand-navy">{item.title}</p>
                    {item.keyword && <p className="mt-0.5 text-[11px] text-gray-500">{item.keyword}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-gray-400">{formatDateTh(item.date)}</span>
                      {item.matchedArticle && <span className="text-[11px] text-emerald-600">✓ เชื่อมแล้ว</span>}
                    </div>
                  </button>
                ))}
                {columnItems.length === 0 && <p className="px-1 py-2 text-center text-[11px] text-gray-400">ไม่มีรายการ</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail Drawer ────────────────────────────────────────────────────────────

function DetailDrawer({ selected, onClose }: { selected: NonNullable<SelectedDrawer>; onClose: () => void }) {
  const isContent = selected.kind === "content";
  const meta = isContent ? STATUS_META[selected.item.status] : seoTaskStatusMeta(selected.item.status);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="text-base font-semibold text-brand-navy">{isContent ? "รายละเอียดบทความ" : "รายละเอียดงาน SEO"}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {isContent ? (
            <>
              <div>
                <p className="text-lg font-semibold text-brand-navy">{selected.item.title}</p>
                <span
                  className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_META[selected.item.status].text} ${STATUS_META[selected.item.status].badgeBg}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[selected.item.status].dot}`} />
                  {selected.item.status}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">วันที่ในตาราง</dt>
                  <dd className="text-brand-navy">{formatDateTh(selected.item.date)}</dd>
                </div>
                {selected.item.keyword && (
                  <div>
                    <dt className="text-xs text-gray-500">Keyword</dt>
                    <dd className="text-brand-navy">{selected.item.keyword}</dd>
                  </div>
                )}
                <div className="col-span-2">
                  <dt className="text-xs text-gray-500">บทความที่เชื่อม</dt>
                  <dd className="text-brand-navy">
                    {selected.item.matchedArticle ? selected.item.matchedArticle.title : "ไม่พบบทความ"}
                  </dd>
                </div>
                {selected.item.matchedArticle && (
                  <>
                    <div>
                      <dt className="text-xs text-gray-500">สถานะบทความ (DB)</dt>
                      <dd className="text-brand-navy">{selected.item.matchedArticle.status}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">อัปเดตล่าสุด</dt>
                      <dd className="text-brand-navy">{formatDateTimeTh(selected.item.matchedArticle.updatedAt)}</dd>
                    </div>
                  </>
                )}
              </dl>

              {selected.item.matchedArticle ? (
                <p className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-700">เปิดดูในแท็บ Article เพื่อดูเนื้อหาฉบับเต็ม</p>
              ) : (
                <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">ยังไม่มีบทความสำหรับหัวข้อนี้ — เริ่มเขียนได้ในแท็บ Article</p>
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-lg font-semibold text-brand-navy">{selected.item.title}</p>
                <span className={`mt-1 inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium ${meta.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Category</dt>
                  <dd className="text-brand-navy">{selected.item.category}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Area</dt>
                  <dd className="text-brand-navy">{selected.item.area}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Priority</dt>
                  <dd>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadge(selected.item.priority)}`}>
                      {selected.item.priority}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">กำหนดส่ง</dt>
                  <dd className="text-brand-navy">{formatDateTh(selected.item.dueDate)}</dd>
                </div>
                {selected.item.owner?.name && (
                  <div>
                    <dt className="text-xs text-gray-500">ผู้รับผิดชอบ</dt>
                    <dd className="text-brand-navy">{selected.item.owner.name}</dd>
                  </div>
                )}
                {selected.item.detail && (
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-500">รายละเอียด</dt>
                    <dd className="text-brand-navy">{selected.item.detail}</dd>
                  </div>
                )}
              </dl>
            </>
          )}

          <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
