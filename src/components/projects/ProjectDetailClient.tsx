"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft, Globe, ExternalLink, Settings, ChevronRight,
  Key, Search, Map, FileText, PenLine, Image, CheckCircle2,
  Rocket, AlertTriangle, Sparkles, Check,
} from "lucide-react";
import type { Role } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProjectData = {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  businessType: string;
  industry: string | null;
  language: string;
  market: string | null;
  status: string;
  notes: string | null;
  projectContext: string | null;
  imageStyleGuide: string | null;
  automationMode: string;
  gtmContainerId: string | null;
  updatedAt: Date;
  createdAt: Date;
  owner: { id: string; name: string | null } | null;
  members: { id: string; role: string; user: { id: string; name: string | null; role: string } }[];
  _count: { articles: number; keywords: number };
  defaultTemplate: { id: string; name: string } | null;
};

type ActivityLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  user: { name: string | null };
};

type Props = {
  project: ProjectData;
  statusMap: Record<string, number>;
  keywordStatusMap: Record<string, number>;
  recentActivity: ActivityLog[];
  userRole: Role;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function statCount(map: Record<string, number>, keys: string[]): number {
  return keys.reduce((s, k) => s + (map[k] ?? 0), 0);
}

const STATUS_PILL: Record<string, string> = {
  ACTIVE:    "bg-green-100 text-green-700 border border-green-200",
  PLANNING:  "bg-blue-100 text-blue-700 border border-blue-200",
  PAUSED:    "bg-yellow-100 text-yellow-700 border border-yellow-200",
  COMPLETED: "bg-gray-100 text-gray-600 border border-gray-100",
  ARCHIVED:  "bg-gray-100 text-gray-400 border border-gray-100",
};

const ACTION_MAP: Record<string, string> = {
  GENERATE_OUTLINE:      "สร้าง Outline",
  GENERATE_ARTICLE:      "เขียนบทความ",
  RUN_SEO_CHECK:         "ตรวจ SEO",
  GENERATE_IMAGE_PROMPT: "สร้าง Image Prompt",
  SEND_TO_WORDPRESS:     "ส่ง WordPress",
  KEYWORD_RESEARCH:      "วิจัย Keyword",
  GENERATE_CONTENT_MAP:  "สร้าง Content Map",
  CREATE:                "สร้าง",
  UPDATE:                "อัปเดต",
};

// ── Next Recommended Action ───────────────────────────────────────────────────

function buildNextAction(
  statusMap: Record<string, number>,
  keywordStatusMap: Record<string, number>,
  projectId: string,
): { icon: React.ReactNode; titleTh: string; descTh: string; href: string; btnTh: string; variant: "green" | "amber" | "blue" } | null {
  const totalKw     = Object.values(keywordStatusMap).reduce((a, b) => a + b, 0);
  const inReview    = statCount(statusMap, ["SEO_REVIEW", "REVISION_REQUIRED"]);
  const approved    = statusMap["APPROVED"] ?? 0;
  const needOutline = statCount(statusMap, ["NEW", "KEYWORD_DONE", "CONTENT_MAP_DONE"]);
  const needArticle = statCount(statusMap, ["OUTLINE_APPROVED"]);
  const needSEO     = statCount(statusMap, ["ARTICLE_DONE", "IMAGE_PROMPT_DONE"]);

  if (inReview > 0)
    return { icon: <AlertTriangle className="h-5 w-5" />, titleTh: `มีบทความรอตรวจ SEO ${inReview} บทความ`, descTh: "ทีม Reviewer ต้องดำเนินการตรวจสอบคุณภาพก่อนส่ง WordPress", href: `/projects/${projectId}/review`, btnTh: "เปิดคิวตรวจ →", variant: "amber" };
  if (approved > 0)
    return { icon: <Rocket className="h-5 w-5" />, titleTh: `${approved} บทความพร้อมส่ง WordPress Draft`, descTh: "บทความผ่านการอนุมัติแล้ว สามารถส่งไป WordPress ได้ทันที", href: `/projects/${projectId}/articles`, btnTh: "ส่ง WordPress →", variant: "green" };
  if (needSEO > 0)
    return { icon: <Search className="h-5 w-5" />, titleTh: `${needSEO} บทความพร้อมให้ตรวจ SEO`, descTh: "บทความเขียนเสร็จแล้ว กด Run SEO Check เพื่อประเมินคุณภาพ", href: `/projects/${projectId}/articles`, btnTh: "ไปหน้าบทความ →", variant: "blue" };
  if (needArticle > 0)
    return { icon: <PenLine className="h-5 w-5" />, titleTh: `${needArticle} บทความรอเขียน HTML`, descTh: "Outline ผ่านการอนุมัติแล้ว กด Generate Article เพื่อเขียนบทความ", href: `/projects/${projectId}/articles`, btnTh: "ไปหน้าบทความ →", variant: "blue" };
  if (needOutline > 0)
    return { icon: <FileText className="h-5 w-5" />, titleTh: `${needOutline} บทความรอสร้าง Outline`, descTh: "สร้าง Outline โครงร่างบทความก่อนเขียนเนื้อหา", href: `/projects/${projectId}/articles`, btnTh: "ไปหน้าบทความ →", variant: "blue" };
  if (totalKw === 0)
    return { icon: <Key className="h-5 w-5" />, titleTh: "เริ่มต้น: เพิ่ม Seed Keywords", descTh: "เพิ่ม keyword หลักเพื่อให้ AI วิจัยและวางแผนบทความ", href: `/projects/${projectId}/keywords`, btnTh: "ไปหน้า Keywords →", variant: "blue" };
  return null;
}

// ── Workflow Step Config ──────────────────────────────────────────────────────

const STEP_ICONS = [Key, Search, Map, FileText, PenLine, Image, CheckCircle2, Rocket];
const STEP_COLORS = [
  "bg-violet-50 border-violet-200 text-violet-700",
  "bg-blue-50 border-blue-200 text-blue-700",
  "bg-sky-50 border-sky-200 text-sky-700",
  "bg-orange-50 border-orange-200 text-orange-700",
  "bg-green-50 border-green-200 text-green-700",
  "bg-pink-50 border-pink-200 text-pink-700",
  "bg-teal-50 border-teal-200 text-teal-700",
  "bg-indigo-50 border-indigo-200 text-indigo-700",
];

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProjectDetailClient({
  project, statusMap, keywordStatusMap, recentActivity,
}: Props) {
  const totalKeywords  = Object.values(keywordStatusMap).reduce((a, b) => a + b, 0);
  const totalArticles  = project._count.articles;

  const outlinesDone   = statCount(statusMap, ["OUTLINE_DONE", "OUTLINE_APPROVED", "ARTICLE_GENERATING", "ARTICLE_DONE", "IMAGE_PROMPT_DONE", "SEO_REVIEW", "SEO_DONE", "REVISION_REQUIRED", "APPROVED", "WORDPRESS_DRAFTED", "POSTED"]);
  const articlesDone   = statCount(statusMap, ["ARTICLE_DONE", "IMAGE_PROMPT_DONE", "SEO_REVIEW", "SEO_DONE", "REVISION_REQUIRED", "APPROVED", "WORDPRESS_DRAFTED", "POSTED"]);
  const withImages     = statCount(statusMap, ["IMAGE_PROMPT_DONE", "SEO_REVIEW", "SEO_DONE", "REVISION_REQUIRED", "APPROVED", "WORDPRESS_DRAFTED", "POSTED"]);
  const waitingReview  = statCount(statusMap, ["SEO_REVIEW", "REVISION_REQUIRED"]);
  const approved       = statusMap["APPROVED"] ?? 0;
  const wpDrafted      = statCount(statusMap, ["WORDPRESS_DRAFTED", "POSTED"]);
  const errors         = statusMap["ERROR"] ?? 0;
  const generatedKw    = keywordStatusMap["GENERATED"] ?? 0;

  // Project completion progress
  const completedArticles = statCount(statusMap, ["APPROVED", "WORDPRESS_DRAFTED", "POSTED"]);
  const overallProgress   = totalArticles > 0 ? Math.round((completedArticles / totalArticles) * 100) : 0;

  const nextAction = buildNextAction(statusMap, keywordStatusMap, project.id);

  const workflowSteps = [
    { step: 1, title: "Seed Keywords",     titleTh: "เพิ่ม Keywords",      icon: 0, count: totalKeywords,  unit: "keywords",         desc: "เพิ่ม keyword หลักสำหรับลูกค้ารายนี้",               href: `/projects/${project.id}/keywords`,    btn: "ไปหน้า Keywords" },
    { step: 2, title: "Keyword Research",  titleTh: "วิจัย Keywords",      icon: 1, count: generatedKw,   unit: "generated",        desc: "AI วิเคราะห์ keyword และ search intent",             href: `/projects/${project.id}/keywords`,    btn: "ไปหน้า Keywords" },
    { step: 3, title: "Content Map",       titleTh: "วางแผน Content Map",  icon: 2, count: totalArticles, unit: "planned",          desc: "วางแผนหัวข้อบทความแบ่งตาม TOFU / MOFU / BOFU",      href: `/projects/${project.id}/content-map`, btn: "ดู Content Map" },
    { step: 4, title: "Article Outlines",  titleTh: "สร้าง Outline",       icon: 3, count: outlinesDone,  unit: "outlines done",    desc: "สร้างโครงร่างบทความด้วย AI",                         href: `/projects/${project.id}/articles`,    btn: "ไปหน้าบทความ" },
    { step: 5, title: "Write Articles",    titleTh: "เขียนบทความ HTML",    icon: 4, count: articlesDone,  unit: "articles done",    desc: "AI เขียนบทความ HTML พร้อมใช้งาน Elementor",         href: `/projects/${project.id}/articles`,    btn: "ไปหน้าบทความ" },
    { step: 6, title: "Image Prompts",     titleTh: "สร้าง Image Prompts", icon: 5, count: withImages,    unit: "with images",      desc: "สร้าง prompt รูปภาพ cover สำหรับแต่ละบทความ",       href: `/projects/${project.id}/articles`,    btn: "ไปหน้าบทความ" },
    { step: 7, title: "SEO Review",        titleTh: "ตรวจสอบ SEO",         icon: 6, count: waitingReview, unit: "waiting",          desc: "ทีม SEO ตรวจสอบคุณภาพก่อนส่ง WordPress",            href: `/projects/${project.id}/review`,      btn: "เปิด Review Queue" },
    { step: 8, title: "WordPress Draft",   titleTh: "ส่ง WordPress Draft", icon: 7, count: wpDrafted,    unit: "drafted",          desc: "ส่งบทความที่ผ่านการอนุมัติไปยัง WordPress draft",    href: `/projects/${project.id}/articles`,    btn: "ไปหน้าบทความ" },
  ];

  const tabs = [
    { label: "Overview",    href: `/projects/${project.id}` },
    { label: "Keywords",    href: `/projects/${project.id}/keywords` },
    { label: "Content Map", href: `/projects/${project.id}/content-map` },
    { label: "Articles",    href: `/projects/${project.id}/articles` },
    { label: "Review",      href: `/projects/${project.id}/review` },
    { label: "Settings",    href: `/projects/${project.id}/settings` },
  ];

  const statusClass = STATUS_PILL[project.status] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="space-y-5 pb-12">

      {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-green-600 transition-colors">
        <ArrowLeft className="h-4 w-4" />
        กลับหน้า Projects
      </Link>

      {/* ── Project Header ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-lg font-bold text-gray-900">{project.name}</h1>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusClass}`}>{project.status}</span>
            </div>
            {project.clientName && project.clientName !== project.name && (
              <p className="text-sm text-gray-400 mb-2">{project.clientName}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
              {project.website && (
                <a href={`https://${project.website}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-500 hover:text-blue-700 transition-colors">
                  <Globe className="h-3.5 w-3.5" />
                  {project.website}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {project.businessType && <span>💼 {project.businessType}</span>}
              {project.language && <span>🌍 {project.language.toUpperCase()}</span>}
              {project.owner?.name && <span>👤 {project.owner.name}</span>}
              {project.automationMode !== "MANUAL" && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                  project.automationMode === "FULL_AUTO"
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}>
                  {project.automationMode === "FULL_AUTO" ? "⚡ Full Auto" : "🔁 Semi-Auto"}
                </span>
              )}
              {project.gtmContainerId && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-b border-gray-100lue-100 font-medium">
                  GTM ✓
                </span>
              )}
            </div>
          </div>
          <Link
            href={`/projects/${project.id}/settings`}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-50 transition-colors flex-shrink-0"
          >
            <Settings className="h-4 w-4" />
            ตั้งค่าโปรเจกต์
          </Link>
        </div>

        {/* Pipeline progress — stage by stage */}
        <div className="mt-5 pt-5 border-t border-gray-50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">Pipeline Progress</span>
            <span className="text-sm font-bold text-green-600">{overallProgress}% — {completedArticles}/{totalArticles} บทความ</span>
          </div>
          {totalArticles > 0 ? (
            <div className="space-y-1.5">
              {[
                { label: "Outline",      count: outlinesDone,  color: "bg-orange-400" },
                { label: "เขียนแล้ว",   count: articlesDone,  color: "bg-green-400" },
                { label: "รอ Review",    count: waitingReview, color: "bg-purple-400" },
                { label: "อนุมัติแล้ว", count: approved,      color: "bg-emerald-500" },
                { label: "WP Draft",     count: wpDrafted,     color: "bg-blue-400" },
                { label: "Posted",       count: statusMap["POSTED"] ?? 0, color: "bg-green-600" },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-20 shrink-0 text-right">{label}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${color} rounded-full transition-all duration-500`}
                      style={{ width: totalArticles > 0 ? `${Math.round((count / totalArticles) * 100)}%` : "0%" }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-8 shrink-0">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">ยังไม่มีบทความ</p>
          )}
          {errors > 0 && (
            <p className="text-xs text-red-500 mt-2">⚠ {errors} บทความมีข้อผิดพลาด</p>
          )}
        </div>
      </div>

      {/* ── Next Recommended Action ──────────────────────────────────────── */}
      {nextAction && (
        <div className={`rounded-2xl border p-5 flex items-center justify-between gap-4 ${
          nextAction.variant === "amber" ? "bg-amber-50 border-amber-200" :
          nextAction.variant === "green" ? "bg-green-50 border-green-200" :
          "bg-blue-50 border-blue-200"
        }`}>
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-xl flex-shrink-0 ${
              nextAction.variant === "amber" ? "bg-amber-100 text-amber-600" :
              nextAction.variant === "green" ? "bg-green-100 text-green-600" :
              "bg-blue-100 text-blue-600"
            }`}>
              {nextAction.icon}
            </div>
            <div>
              <p className={`font-semibold text-sm ${
                nextAction.variant === "amber" ? "text-amber-900" :
                nextAction.variant === "green" ? "text-green-900" :
                "text-blue-900"
              }`}>
                ขั้นตอนถัดไปที่แนะนำ: {nextAction.titleTh}
              </p>
              <p className={`text-sm mt-0.5 ${
                nextAction.variant === "amber" ? "text-amber-700" :
                nextAction.variant === "green" ? "text-green-700" :
                "text-blue-700"
              }`}>
                {nextAction.descTh}
              </p>
            </div>
          </div>
          <Link
            href={nextAction.href}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold flex-shrink-0 transition-colors ${
              nextAction.variant === "amber" ? "bg-amber-500 hover:bg-amber-600 text-white" :
              nextAction.variant === "green" ? "bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white" :
              "bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white"
            }`}
          >
            {nextAction.btnTh}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* ── Tab Nav ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <nav className="flex border-b border-gray-100 overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="px-5 py-3.5 text-sm font-medium text-gray-500 hover:text-green-700 hover:bg-green-50/60 whitespace-nowrap border-b border-gray-100-2 border-transparent hover:border-green-500 transition-all"
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <div className="p-6 space-y-8">

          {/* Stats Grid */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">สรุปภาพรวม</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {[
                { label: "Keywords",     value: totalKeywords, color: "text-slate-700",  bg: "bg-gray-50" },
                { label: "บทความทั้งหมด", value: totalArticles, color: "text-slate-700",  bg: "bg-gray-50" },
                { label: "Outline Done", value: outlinesDone,  color: "text-blue-600",   bg: "bg-blue-50" },
                { label: "Article Done", value: articlesDone,  color: "text-purple-600", bg: "bg-purple-50" },
                { label: "รอตรวจ",       value: waitingReview, color: "text-amber-600",  bg: "bg-amber-50" },
                { label: "อนุมัติแล้ว",   value: approved,      color: "text-green-600",  bg: "bg-green-50" },
                { label: "WP Drafted",  value: wpDrafted,     color: "text-teal-600",   bg: "bg-teal-50" },
                { label: "Errors",      value: errors,        color: "text-red-600",    bg: "bg-red-50" },
              ].map((s) => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-tight">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow Steps */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
              ขั้นตอนการผลิตบทความ SEO
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {workflowSteps.map((ws) => {
                const StepIcon = STEP_ICONS[ws.icon];
                const colorClass = STEP_COLORS[ws.icon];
                const isActionable = ws.count > 0;

                return (
                  <div
                    key={ws.step}
                    className="group border border-gray-100 rounded-2xl p-4 hover:border-green-200 hover:bg-green-50/20 transition-all"
                  >
                    <div className="flex items-start gap-3.5">
                      {/* Step number + icon */}
                      <div className={`w-11 h-11 rounded-xl border flex-shrink-0 flex items-center justify-center ${colorClass}`}>
                        <StepIcon className="h-5 w-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <div>
                            <span className="text-xs text-gray-400 mr-1.5">Step {ws.step}</span>
                            <span className="text-sm font-semibold text-gray-900">{ws.titleTh}</span>
                          </div>
                          {/* Count pill */}
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                            isActionable
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-400"
                          }`}>
                            {ws.count} {ws.unit}
                          </span>
                        </div>

                        <p className="text-xs text-gray-500 mb-3">{ws.desc}</p>

                        <Link
                          href={ws.href}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 hover:text-green-800 group-hover:underline transition-colors"
                        >
                          {ws.btn}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Activity */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
              กิจกรรมล่าสุด
            </h2>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">ยังไม่มีกิจกรรม</p>
            ) : (
              <div className="space-y-1">
                {recentActivity.map((log) => {
                  const actionTh = ACTION_MAP[log.action] ?? log.action;
                  return (
                    <div key={log.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(log.user.name ?? "?").charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-gray-700 truncate">
                          <span className="font-medium">{log.user.name ?? "Unknown"}</span>
                          <span className="text-gray-400"> · {actionTh} </span>
                          <span className="text-gray-600">{log.entityType}</span>
                        </span>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-4">
                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
