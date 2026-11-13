"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FunnelBadge } from "@/components/shared/FunnelBadge";
import { formatDateTime, formatDate } from "@/lib/utils";
import { PageHeader, KpiTile, Panel } from "@/components/ds";
import type { ArticleStatus, FunnelStage } from "@/types";
import {
  FolderKanban, FileText, LayoutList, PenLine, ClipboardCheck,
  CheckCircle, Globe, CheckSquare, AlertCircle, DollarSign,
  TrendingUp, ArrowUpRight, Zap, Clock,
} from "lucide-react";

interface StatCard {
  label: string;
  value: number | string;
  icon: React.ElementType;
  tone: "plain" | "blue" | "sky" | "mist" | "navy" | "warm";
  href?: string;
  suffix?: string;
}

interface Props {
  userName: string;
  stats: {
    total: number;
    inReview: number;
    approved: number;
    posted: number;
    errors: number;
    aiJobsToday: number;
    needsAction: number;
    projectCount: number;
    outlinesDone: number;
    articlesDone: number;
    wpDrafted: number;
    aiCostMonth: number;
    monthlyTarget?: number;
    aiCostLimit?: number;
    postedThisMonth?: number;
  };
  stepCounts: { key: string; label: string; labelTh: string; count: number }[];
  upcomingDeadlines?: { id: string; title: string; scheduledAt: Date | null; status: string }[];
  allArticles: {
    id: string;
    title: string;
    status: string;
    funnelStage: string;
    updatedAt: Date;
    project: { id: string; name: string };
    keyword?: { keyword: string } | null;
    assignedTo?: { name: string | null } | null;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: Date;
    user: { name: string | null };
  }[];
  recentJobs: {
    id: string;
    jobType: string;
    status: string;
    modelProvider: string;
    estimatedCost?: number | null;
    createdAt: Date;
  }[];
  pipelineCounts?: Record<string, number>;
  myArticles?: unknown[];
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATE:                 "สร้างบทความ",
    UPDATE:                 "แก้ไข",
    DELETE:                 "ลบ",
    GENERATE_OUTLINE:       "สร้าง Outline",
    GENERATE_ARTICLE:       "เขียนบทความ",
    GENERATE_IMAGE_PROMPT:  "สร้าง Image Prompt",
    RUN_SEO_CHECK:          "ตรวจ SEO",
    SEND_TO_WORDPRESS:      "ส่ง WordPress",
    KEYWORD_RESEARCH:       "วิจัย Keyword",
    GENERATE_CONTENT_MAP:   "สร้าง Content Map",
    APPROVE_OUTLINE:        "Approve Outline",
    APPROVE_ARTICLE:        "Approve บทความ",
    REVISION_REQUIRED:      "ส่งกลับแก้ไข",
  };
  return map[action] ?? action;
}

export function ProfessionalDashboard({ userName, stats, stepCounts, allArticles, recentActivity, recentJobs, upcomingDeadlines = [] }: Props) {
  const recentArticles = allArticles.slice(0, 8);

  // Pinterest-style muted pastels — soft but identifiable
  const STAT_CARDS: StatCard[] = [
    { label: "Projects",        value: stats.projectCount,   icon: FolderKanban,  tone: "blue",  href: "/projects" },
    { label: "Articles",        value: stats.total,          icon: FileText,      tone: "sky",  href: "/articles" },
    { label: "Outlines Done",   value: stats.outlinesDone,   icon: LayoutList,    tone: "mist",  href: "/articles?step=outline" },
    { label: "Articles Done",   value: stats.articlesDone,   icon: PenLine,       tone: "mist",  href: "/articles?step=article" },
    { label: "Waiting Review",  value: stats.inReview,       icon: ClipboardCheck,tone: "warm",  href: "/review" },
    { label: "Approved",        value: stats.approved,       icon: CheckCircle,   tone: "mist",  href: "/articles?status=APPROVED" },
    { label: "WP Drafted",      value: stats.wpDrafted,      icon: Globe,         tone: "sky",  href: "/articles?status=WORDPRESS_DRAFTED" },
    { label: "Posted",          value: stats.posted,         icon: CheckSquare,   tone: "mist",  href: "/articles?status=POSTED" },
    { label: "Errors",          value: stats.errors,         icon: AlertCircle,   tone: "warm",  href: "/articles?status=ERROR" },
    { label: "AI Cost / Month", value: `$${stats.aiCostMonth.toFixed(2)}`, icon: DollarSign, tone: "navy", href: "/ai-jobs" },
  ];

  const JOB_TYPE_LABELS: Record<string, string> = {
    KEYWORD_RESEARCH: "Keyword",
    GENERATE_OUTLINE: "Outline",
    GENERATE_ARTICLE: "Article",
    GENERATE_IMAGE_PROMPT: "Image",
    RUN_SEO_CHECK: "SEO",
    SEND_TO_WORDPRESS: "WordPress",
    GENERATE_CONTENT_MAP: "Content Map",
  };

  return (
    <div className="space-y-6">

      {/* Greeting */}
      <PageHeader
        eyebrow="Dashboard"
        title={`สวัสดี, ${userName}`}
        subtitle={new Date().toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      />

      {/* Monthly Target Burn-down */}
      {stats.monthlyTarget && stats.monthlyTarget > 0 && (() => {
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysPassed  = now.getDate();
        const daysLeft    = daysInMonth - daysPassed;
        const posted      = stats.postedThisMonth ?? 0;
        const pct         = Math.min(100, Math.round((posted / stats.monthlyTarget) * 100));
        const onTrack     = posted >= Math.round((daysPassed / daysInMonth) * stats.monthlyTarget);
        const needed      = Math.max(0, stats.monthlyTarget - posted);
        const costPct     = stats.aiCostLimit ? Math.min(100, Math.round((stats.aiCostMonth / stats.aiCostLimit) * 100)) : null;
        return (
          <div className={`rounded-3xl border p-5 shadow-sm backdrop-blur ${onTrack ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70"}`}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-sm font-semibold text-brand-navy">เป้าหมายเดือนนี้</p>
                <p className="text-xs text-gray-500 mt-0.5">เหลือ {daysLeft} วัน · ต้องการอีก {needed} บทความ</p>
              </div>
              <div className="text-right">
                <p className={`text-2xl font-bold tabular-nums ${onTrack ? "text-green-600" : "text-amber-600"}`}>{posted}<span className="text-sm font-normal text-gray-400">/{stats.monthlyTarget}</span></p>
                <p className={`text-xs font-semibold ${onTrack ? "text-green-500" : "text-amber-500"}`}>{onTrack ? "✓ On track" : "⚠ ต้องเร่ง"}</p>
              </div>
            </div>
            <div className="h-2.5 bg-white/70 rounded-full overflow-hidden mb-1">
              <div className={`h-full rounded-full transition-all duration-700 ${onTrack ? "bg-green-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-400">
              <span>{pct}% of target</span>
              {costPct !== null && (
                <span className={costPct >= 90 ? "text-red-500 font-semibold" : ""}>
                  AI cost: ${stats.aiCostMonth.toFixed(2)} / ${stats.aiCostLimit?.toFixed(0)} {costPct >= 90 && "⚠"}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Onboarding checklist — shown only when no projects yet */}
      {stats.projectCount === 0 && (
        <div className="rounded-3xl border border-white/80 bg-brand-blue/10 px-5 py-5 shadow-sm">
          <p className="text-sm font-semibold text-blue-900 mb-1">ยินดีต้อนรับสู่ Mars 👋</p>
          <p className="text-xs text-brand-blue mb-4">ทำ 3 ขั้นตอนนี้ก็พร้อมเขียนบทความแรกได้เลย</p>
          <div className="space-y-2.5">
            <Link href="/projects" className="flex items-center gap-3 bg-white border border-blue-200 rounded-lg px-4 py-3 hover:bg-blue-50 transition-colors group">
              <span className="w-6 h-6 rounded-full bg-brand-blue text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-navy">สร้าง Project แรก</p>
                <p className="text-xs text-gray-500">ตั้งชื่อเว็บไซต์และ URL ที่ต้องการเขียนบทความให้</p>
              </div>
              <ArrowUpRight className="h-4 w-4 text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
            </Link>
            <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg px-4 py-3 opacity-50">
              <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center shrink-0">2</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-700">เชื่อมต่อ AI</p>
                <p className="text-xs text-gray-400">ใส่ API key เพื่อให้ Mars เขียนบทความจริง (ข้ามได้ ใช้ mock ก่อนได้)</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg px-4 py-3 opacity-50">
              <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center shrink-0">3</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-700">สร้างบทความแรก</p>
                <p className="text-xs text-gray-400">ใส่แค่ชื่อบทความ กด Full Auto — Mars จะเขียนให้เลย</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action required — shown only when there's something to do */}
      {(stats.needsAction > 0 || stats.inReview > 0 || stats.errors > 0 || stats.outlinesDone > 0) && (
        <div className="rounded-3xl border border-white/80 bg-amber-50/80 px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-amber-700 mb-3 uppercase tracking-wide">งานรอคุณอยู่</p>
          <div className="flex flex-wrap gap-2">
            {stats.outlinesDone > 0 && (
              <Link href="/articles?step=outline" className="flex items-center gap-2 bg-white border border-amber-200 rounded-full px-3.5 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors">
                <span className="w-5 h-5 rounded-full bg-amber-400 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{stats.outlinesDone}</span>
                Outline รอ Approve
              </Link>
            )}
            {stats.inReview > 0 && (
              <Link href="/review" className="flex items-center gap-2 bg-white border border-purple-200 rounded-full px-3.5 py-1.5 text-sm font-medium text-purple-800 hover:bg-purple-50 transition-colors">
                <span className="w-5 h-5 rounded-full bg-purple-400 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{stats.inReview}</span>
                รอ Review
              </Link>
            )}
            {stats.errors > 0 && (
              <Link href="/articles?status=ERROR" className="flex items-center gap-2 bg-white border border-red-200 rounded-full px-3.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors">
                <span className="w-5 h-5 rounded-full bg-red-400 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{stats.errors}</span>
                มีข้อผิดพลาด
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Upcoming deadlines — next 3 days */}
      {upcomingDeadlines.length > 0 && (
        <div className="rounded-3xl border border-white/80 bg-rose-50/80 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm">📅</span>
            <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide">Deadline ใน 3 วันนี้</p>
          </div>
          <div className="space-y-2">
            {upcomingDeadlines.map((a) => {
              const d = a.scheduledAt ? new Date(a.scheduledAt) : null;
              const daysLeft = d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : null;
              const isToday = daysLeft !== null && daysLeft <= 0;
              return (
                <Link key={a.id} href={`/articles/${a.id}`} className="flex items-center gap-3 bg-white border border-rose-100 rounded-lg px-3 py-2 hover:bg-rose-50 transition-colors group">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${isToday ? "bg-red-500 text-white" : "bg-rose-100 text-rose-700"}`}>
                    {isToday ? "วันนี้!" : `อีก ${daysLeft} วัน`}
                  </span>
                  <p className="text-sm text-gray-800 truncate flex-1 group-hover:text-rose-700">{a.title}</p>
                  <StatusBadge status={a.status} className="shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STAT_CARDS.map((card) => {
          const inner = (
            <KpiTile
              label={card.label}
              value={`${card.value}${card.suffix ? ` ${card.suffix}` : ""}`}
              tone={card.tone}
              icon={<card.icon className="h-4 w-4" />}
              className="h-full"
            />
          );
          return card.href ? (
            <Link key={card.label} href={card.href} className="group block min-w-0">{inner}</Link>
          ) : (
            <div key={card.label} className="min-w-0">{inner}</div>
          );
        })}
      </div>

      {/* Pipeline Progress */}
      <div className="glass rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-brand-navy">Pipeline Throughput</h2>
          <Link href="/articles" className="text-xs text-brand-blue hover:text-brand-deep font-medium">View All →</Link>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {stepCounts.map(({ key, label, labelTh, count }) => {
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            return (
              <Link key={key} href={`/articles?step=${key}`} className="group text-center">
                <div className="text-lg font-bold text-brand-navy group-hover:text-brand-blue transition-colors">{count}</div>
                <div className="text-xs text-gray-400 truncate">{label}</div>
                <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-brand-blue rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{pct}%</div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* Recent Articles */}
        <div className="xl:col-span-2 glass rounded-3xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100/70">
            <h2 className="text-sm font-semibold text-brand-navy">Recent Articles</h2>
            <Link href="/articles" className="text-xs text-brand-blue hover:text-brand-deep font-medium">View All →</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentArticles.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No articles yet</p>
            )}
            {recentArticles.map((article) => (
              <Link
                key={article.id}
                href={`/articles/${article.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-brand-mist/60 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-navy truncate group-hover:text-brand-blue transition-colors">{article.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">{article.project.name}</span>
                    {article.keyword && (
                      <span className="text-xs chip chip-info">{article.keyword.keyword}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <FunnelBadge stage={article.funnelStage as FunnelStage} />
                  <StatusBadge status={article.status as ArticleStatus} />
                  <span className="text-xs text-gray-400 hidden lg:block w-16 text-right">{formatDate(article.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-5">

          {/* Activity */}
          <div className="glass rounded-3xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100/70">
              <h2 className="text-sm font-semibold text-brand-navy">Activity</h2>
              <Link href="/activity-logs" className="text-xs text-brand-blue hover:text-brand-deep font-medium">All Logs →</Link>
            </div>
            <div className="px-5 py-3 divide-y divide-gray-50 max-h-52 overflow-auto">
              {recentActivity.length === 0 && (
                <p className="text-xs text-gray-400 py-4 text-center">No activity yet</p>
              )}
              {recentActivity.map((log) => (
                <div key={log.id} className="flex items-start gap-2.5 py-2.5">
                  <div className="w-6 h-6 rounded-full bg-brand-mist flex items-center justify-center text-xs font-bold text-brand-navy flex-shrink-0">
                    {log.user.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 leading-snug">
                      <span className="font-medium">{log.user.name}</span>{" "}
                      <span className="text-gray-500">{actionLabel(log.action)}</span>{" "}
                      <span className="text-gray-600 lowercase">{log.entityType}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(log.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent AI Jobs */}
          <div className="glass rounded-3xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100/70">
              <h2 className="text-sm font-semibold text-brand-navy flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                AI Jobs
              </h2>
              <Link href="/ai-jobs" className="text-xs text-brand-blue hover:text-brand-deep font-medium">All Jobs →</Link>
            </div>
            <div className="px-5 py-3 space-y-2">
              {recentJobs.length === 0 && (
                <p className="text-xs text-gray-400 py-3 text-center">No jobs yet</p>
              )}
              {recentJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-2 text-xs">
                  <span className={`chip ${
                    job.status === "DONE" ? "chip-ok" :
                    job.status === "FAILED" ? "chip-bad" :
                    "chip-info"
                  }`}>{job.status}</span>
                  <span className="text-gray-600 flex-1 truncate">{JOB_TYPE_LABELS[job.jobType] ?? job.jobType}</span>
                  <span className="text-amber-600 font-mono">${job.estimatedCost?.toFixed(4) ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
