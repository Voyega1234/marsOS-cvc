"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Globe,
  FileText,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Users,
  CalendarDays,
  Wallet,
  ListChecks,
  Link2,
  RefreshCw,
} from "lucide-react";

import type { WorkspaceProject, WorkspaceLiveStats } from "./types";
import { canSeeInternalCost } from "./types";

interface Props {
  project: WorkspaceProject;
  stats: WorkspaceLiveStats;
  userRole: string;
  onNavigate?: (tabId: string) => void;
}

/* ───────────────────────────── API response types ───────────────────────────── */

interface OverviewProject {
  name: string;
  clientName: string | null;
  website: string;
  industry: string | null;
  businessType: string;
  status: string;
  monthlyTarget: number | null;
  aiCostLimit: number | null;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
  accentColor: string;
  owner: { name: string | null };
  createdAt: string;
}

interface OverviewArticleStatusCount {
  status: string;
  count: number;
}

interface OverviewRecentArticle {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

interface OverviewData {
  project: OverviewProject;
  articles: {
    byStatus: OverviewArticleStatusCount[];
    total: number;
    publishedThisMonth: number;
    recent: OverviewRecentArticle[];
  };
  keywords: { count: number };
  aiCost: {
    totalThisMonth: number;
    jobCountThisMonth: number;
    byType: { jobType: string; cost: number }[];
  };
  seoTasks: { area: string; status: string; count: number }[];
  reviewPending: number;
}

/* ───────────────────────────── Labels & helpers ───────────────────────────── */

const ARTICLE_STATUS_LABELS: Record<string, string> = {
  NEW: "ใหม่",
  KEYWORD_RESEARCHING: "กำลังหา Keyword",
  KEYWORD_DONE: "Keyword เสร็จ",
  CONTENT_MAP_DONE: "Content Map เสร็จ",
  OUTLINE_GENERATING: "กำลังสร้าง Outline",
  OUTLINE_DONE: "Outline เสร็จ",
  OUTLINE_APPROVED: "Outline อนุมัติแล้ว",
  ARTICLE_GENERATING: "กำลังเขียน",
  WRITING: "กำลังเขียน",
  ARTICLE_DONE: "เขียนเสร็จ",
  IMAGE_PROMPT_DONE: "สร้างภาพเสร็จ",
  SEO_REVIEW: "รอ SEO Review",
  REVIEW: "รอ Review",
  REVIEWING: "กำลัง Review",
  REVISION_REQUIRED: "ต้องแก้ไข",
  APPROVED: "อนุมัติแล้ว",
  WORDPRESS_DRAFTED: "ร่างใน WordPress",
  POSTED: "เผยแพร่แล้ว",
  ERROR: "ผิดพลาด",
};

const PROJECT_STATUS_LABELS: Record<string, { label: string; classes: string }> = {
  ACTIVE: { label: "Active", classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PAUSED: { label: "Paused", classes: "bg-amber-50 text-amber-700 border-amber-200" },
  ARCHIVED: { label: "Archived", classes: "bg-gray-100 text-gray-600 border-gray-200" },
  COMPLETED: { label: "Completed", classes: "bg-blue-50 text-blue-700 border-blue-200" },
};

function articleStatusLabel(status: string) {
  return ARTICLE_STATUS_LABELS[status] ?? status;
}

function articleStatusBadgeClasses(status: string) {
  if (status === "POSTED" || status === "APPROVED") return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (status === "ERROR" || status === "REVISION_REQUIRED") return "bg-red-50 text-red-700 border border-red-200";
  if (status === "SEO_REVIEW" || status === "REVIEW" || status === "REVIEWING") return "bg-amber-50 text-amber-700 border border-amber-200";
  if (status === "WORDPRESS_DRAFTED") return "bg-blue-50 text-blue-700 border border-blue-200";
  return "bg-gray-100 text-gray-600 border border-gray-200";
}

function projectStatusBadge(status: string) {
  return PROJECT_STATUS_LABELS[status] ?? { label: status, classes: "bg-gray-100 text-gray-600 border-gray-200" };
}

function formatDateTh(value: string) {
  return new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTimeTh(value: string) {
  return new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* ───────────────────────────── Small UI pieces ───────────────────────────── */

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}

function KpiCard({ label, value, hint, onClick }: KpiCardProps) {
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`flex flex-col items-start rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition ${
        clickable ? "cursor-pointer hover:border-indigo-300 hover:shadow-md" : "cursor-default"
      }`}
    >
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="mt-1 text-2xl font-bold text-brand-navy">{value}</span>
      {hint && <span className="mt-1 text-[11px] text-gray-400">{hint}</span>}
    </button>
  );
}

function ProgressBar({ pct, color = "bg-indigo-500" }: { pct: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full rounded-full bg-gray-100">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function ConnectionRow({ label, value }: { label: string; value: string | null }) {
  const connected = Boolean(value);
  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 ${
        connected ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <Link2 className={`h-4 w-4 ${connected ? "text-emerald-600" : "text-amber-600"}`} />
        <span className="text-sm font-medium text-gray-800">{label}</span>
      </div>
      <span className={`text-xs font-medium ${connected ? "text-emerald-700" : "text-amber-700"}`}>
        {connected ? `เชื่อมแล้ว: ${value}` : "ยังไม่เชื่อม — ใส่ค่านี้ใน Project Settings"}
      </span>
    </div>
  );
}

/* ───────────────────────────── Loading / Error states ───────────────────────────── */

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6 pb-10">
      {[220, 140, 220, 160, 160, 220].map((h, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" style={{ height: h }} />
      ))}
    </div>
  );
}

function OverviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <AlertTriangle className="mx-auto h-6 w-6 text-red-500" />
      <p className="mt-2 text-sm font-medium text-red-700">โหลดข้อมูลภาพรวมไม่สำเร็จ</p>
      <p className="mt-1 text-xs text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        <RefreshCw className="h-4 w-4" /> ลองใหม่
      </button>
    </div>
  );
}

/* ───────────────────────────── Main component ───────────────────────────── */

export function ClientOverview({ project, stats, userRole, onNavigate }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const showCost = canSeeInternalCost(userRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/overview`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as OverviewData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  function handleNavigate(tabId: string) {
    onNavigate?.(tabId);
  }

  if (loading && !data) return <OverviewSkeleton />;
  if (error && !data) return <OverviewError message={error} onRetry={load} />;
  if (!data) return null;

  const displayName = data.project.clientName ?? data.project.name;
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  const statusBadge = projectStatusBadge(data.project.status);

  const monthlyTarget = data.project.monthlyTarget;
  const publishProgressPct = monthlyTarget ? Math.round((data.articles.publishedThisMonth / monthlyTarget) * 100) : 0;

  const aiCostLimit = data.project.aiCostLimit;
  const aiCostPct = aiCostLimit ? Math.round((data.aiCost.totalThisMonth / aiCostLimit) * 100) : 0;

  const seoAreas: Array<{ key: string; label: string; navTab: string }> = [
    { key: "ONPAGE", label: "On-Page", navTab: "on-page" },
    { key: "TECHNICAL", label: "Technical", navTab: "technical" },
  ];

  return (
    <div className="flex flex-col gap-6 pb-10">
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          <span>รีเฟรชข้อมูลล่าสุดไม่สำเร็จ ({error}) — แสดงข้อมูลที่โหลดไว้ล่าสุด</span>
          <button type="button" onClick={load} className="font-medium underline">
            ลองใหม่
          </button>
        </div>
      )}

      {/* 1. Client Hero */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold text-white"
              style={{ backgroundColor: data.project.accentColor || project.accentColor || "#4f46e5" }}
            >
              {initial}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-brand-navy">{displayName}</h1>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge.classes}`}>
                  <CheckCircle2 className="h-3 w-3" /> {statusBadge.label}
                </span>
              </div>
              <a
                href={data.project.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
              >
                <Globe className="h-3.5 w-3.5" />
                {data.project.website}
              </a>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>อุตสาหกรรม: {data.project.industry ?? "ไม่ระบุ"}</span>
                <span>ประเภทธุรกิจ: {data.project.businessType}</span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" /> Project Owner: {data.project.owner.name ?? "—"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> เริ่มโปรเจกต์: {formatDateTh(data.project.createdAt)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 md:flex-col">
            <button
              type="button"
              onClick={() => handleNavigate("timeline-view")}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              <CalendarDays className="h-4 w-4" /> Project Timeline
            </button>
            <button
              type="button"
              onClick={() => handleNavigate("report")}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <FileText className="h-4 w-4" /> ดู Report
            </button>
          </div>
        </div>
      </section>

      {/* 2. KPI row */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-brand-navy">KPI สรุป</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="บทความทั้งหมด"
            value={data.articles.total.toLocaleString()}
            onClick={() => handleNavigate("articles")}
          />
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <span className="text-xs font-medium text-gray-500">เผยแพร่เดือนนี้</span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-2xl font-bold text-brand-navy">{data.articles.publishedThisMonth}</span>
              {monthlyTarget && <span className="text-sm text-gray-400">/ {monthlyTarget}</span>}
            </div>
            {monthlyTarget ? (
              <div className="mt-2">
                <ProgressBar pct={publishProgressPct} />
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-gray-400">ยังไม่ตั้งเป้า — ตั้งได้ที่ Project Settings</p>
            )}
          </div>
          <KpiCard
            label="Keywords ในคลัง"
            value={data.keywords.count.toLocaleString()}
            onClick={() => handleNavigate("keywords")}
          />
          <KpiCard
            label="รอ Review"
            value={data.reviewPending.toLocaleString()}
            onClick={() => handleNavigate("review")}
          />
        </div>
      </section>

      {/* 3. สถานะบทความ */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-brand-navy">
          <FileText className="h-4 w-4 text-indigo-600" /> สถานะบทความ
        </h2>
        {data.articles.byStatus.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่มีบทความในโปรเจกต์นี้</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.articles.byStatus.map((row) => {
              const pct = data.articles.total > 0 ? Math.round((row.count / data.articles.total) * 100) : 0;
              return (
                <button
                  key={row.status}
                  type="button"
                  onClick={() => handleNavigate("articles")}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5 text-left hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${articleStatusBadgeClasses(row.status)}`}>
                    {articleStatusLabel(row.status)}
                  </span>
                  <div className="flex-1">
                    <ProgressBar pct={pct} />
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-gray-800">{row.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. SEO Checklist progress */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-brand-navy">
          <ListChecks className="h-4 w-4 text-indigo-600" /> SEO Checklist
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {seoAreas.map((area) => {
            const rows = data.seoTasks.filter((row) => row.area === area.key);
            const total = rows.reduce((sum, row) => sum + row.count, 0);
            const done = rows.filter((row) => row.status === "DONE").reduce((sum, row) => sum + row.count, 0);
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <button
                key={area.key}
                type="button"
                onClick={() => handleNavigate(area.navTab)}
                className="flex flex-col rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-left hover:border-indigo-200 hover:bg-indigo-50/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">{area.label}</span>
                  {total > 0 && (
                    <span className="text-xs font-semibold text-gray-600">
                      {done}/{total} ({pct}%)
                    </span>
                  )}
                </div>
                {total > 0 ? (
                  <div className="mt-2">
                    <ProgressBar pct={pct} color={pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-indigo-500"} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">ยังไม่มี checklist — เปิดหน้า {area.label} เพื่อเริ่ม</p>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* 5. AI cost (role-gated) */}
      {showCost && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-navy">
            <Wallet className="h-4 w-4 text-indigo-600" /> ค่าใช้จ่าย AI เดือนนี้
          </h2>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-brand-navy">${data.aiCost.totalThisMonth.toFixed(2)}</span>
            {aiCostLimit ? (
              <span className="text-sm text-gray-500">/ งบ ${aiCostLimit.toFixed(2)}</span>
            ) : null}
          </div>
          {aiCostLimit ? (
            <div className="mt-2 max-w-md">
              <ProgressBar pct={aiCostPct} color={aiCostPct >= 90 ? "bg-red-500" : aiCostPct >= 70 ? "bg-amber-500" : "bg-indigo-500"} />
            </div>
          ) : (
            <p className="mt-1 text-xs text-gray-400">ยังไม่ตั้งงบ — ตั้งได้ที่ Project Settings</p>
          )}
          {data.aiCost.byType.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              <p className="text-xs font-medium text-gray-500">แยกตามประเภทงาน</p>
              {data.aiCost.byType.map((item) => (
                <div key={item.jobType} className="flex items-center justify-between text-sm text-gray-700">
                  <span>{item.jobType}</span>
                  <span className="font-medium text-gray-800">${item.cost.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 6. การเชื่อมต่อข้อมูล */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-navy">
          <Link2 className="h-4 w-4 text-indigo-600" /> การเชื่อมต่อข้อมูล
        </h2>
        <div className="flex flex-col gap-2">
          <ConnectionRow label="Google Search Console" value={data.project.gscSiteUrl} />
          <ConnectionRow label="Google Analytics 4" value={data.project.ga4PropertyId} />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          ข้อมูล Organic Clicks / Ranking ดูได้ที่แท็บ Report เมื่อเชื่อม GSC แล้ว
        </p>
        <button
          type="button"
          onClick={() => handleNavigate("report")}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ไปที่ Report <ChevronRight className="h-4 w-4" />
        </button>
      </section>

      {/* 7. บทความล่าสุด */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-navy">
          <FileText className="h-4 w-4 text-indigo-600" /> บทความล่าสุด
        </h2>
        {data.articles.recent.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่มีบทความ</p>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {data.articles.recent.map((article) => (
              <li key={article.id}>
                <button
                  type="button"
                  onClick={() => handleNavigate("articles")}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0 truncate text-sm text-gray-800">{article.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${articleStatusBadgeClasses(article.status)}`}>
                      {articleStatusLabel(article.status)}
                    </span>
                    <span className="text-xs text-gray-400">{formatDateTimeTh(article.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
