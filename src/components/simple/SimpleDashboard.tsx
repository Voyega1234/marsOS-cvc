"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { STATUS_CONFIG, FUNNEL_CONFIG } from "@/types";
import type { ArticleStatus, FunnelStage } from "@/types";
import {
  ArrowRight, Search, Map, LayoutList, PenLine, Image as ImageIcon,
  CheckCircle, Globe, Clock, Plus, Sparkles, TrendingUp,
} from "lucide-react";

interface PipelineCard {
  emoji: string;
  icon: typeof Search;
  label: string;
  labelTh: string;
  description: string;
  count: number;
  actionLabel: string;
  href: string;
  gradient: string;
  border: string;
  iconBg: string;
  countColor: string;
}

interface MyArticle {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  updatedAt: Date;
  project: { name: string };
}

interface Props {
  userName: string;
  pipelineCounts: Record<string, number>;
  myArticles: MyArticle[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    createdAt: Date;
    user: { name: string | null };
  }[];
  stats: { total: number; approved: number; posted: number; needsAction: number };
}

const PIPELINE_CARDS: Omit<PipelineCard, "count">[] = [
  {
    emoji: "🔎", icon: Search, label: "Keyword Research", labelTh: "วิจัยคีย์เวิร์ด",
    description: "ค้นหาคำที่คนใช้ค้นหาสินค้า/บริการของคุณ",
    actionLabel: "ดูงานวิจัย", href: "/articles?step=keywords",
    gradient: "from-blue-50 to-sky-50", border: "border-b border-gray-100lue-100",
    iconBg: "bg-blue-100", countColor: "text-blue-700",
  },
  {
    emoji: "🧭", icon: Map, label: "Content Map", labelTh: "แผนเนื้อหา",
    description: "วางแผนบทความทั้งหมดในแต่ละ Funnel Stage",
    actionLabel: "ดูแผน", href: "/articles?step=contentmap",
    gradient: "from-violet-50 to-purple-50", border: "border-violet-100",
    iconBg: "bg-violet-100", countColor: "text-violet-700",
  },
  {
    emoji: "📝", icon: LayoutList, label: "Outline", labelTh: "โครงร่างบทความ",
    description: "สร้างโครงสร้างบทความก่อนเริ่มเขียน",
    actionLabel: "ดูโครงร่าง", href: "/articles?step=outline",
    gradient: "from-orange-50 to-amber-50", border: "border-orange-100",
    iconBg: "bg-orange-100", countColor: "text-orange-700",
  },
  {
    emoji: "📄", icon: PenLine, label: "Article HTML", labelTh: "เขียนบทความ",
    description: "เขียนเนื้อหาบทความ HTML เต็มรูปแบบ",
    actionLabel: "ดูบทความ", href: "/articles?step=article",
    gradient: "from-green-50 to-emerald-50", border: "border-green-100",
    iconBg: "bg-green-100", countColor: "text-green-700",
  },
  {
    emoji: "🖼️", icon: ImageIcon, label: "Image Prompt", labelTh: "สร้าง Prompt รูป",
    description: "สร้าง AI prompt สำหรับภาพประกอบบทความ",
    actionLabel: "ดู Prompt", href: "/articles?step=image",
    gradient: "from-pink-50 to-rose-50", border: "border-pink-100",
    iconBg: "bg-pink-100", countColor: "text-pink-700",
  },
  {
    emoji: "✅", icon: CheckCircle, label: "SEO Review", labelTh: "ตรวจสอบ SEO",
    description: "ตรวจสอบความถูกต้องและคุณภาพ SEO",
    actionLabel: "ตรวจสอบ", href: "/articles?step=review",
    gradient: "from-teal-50 to-cyan-50", border: "border-teal-100",
    iconBg: "bg-teal-100", countColor: "text-teal-700",
  },
  {
    emoji: "🌐", icon: Globe, label: "WordPress Draft", labelTh: "ส่ง WordPress",
    description: "ส่งบทความที่อนุมัติแล้วเข้า WordPress",
    actionLabel: "ส่งบทความ", href: "/articles?step=wordpress",
    gradient: "from-indigo-50 to-blue-50", border: "border-indigo-100",
    iconBg: "bg-indigo-100", countColor: "text-indigo-700",
  },
];

function getNextActionForArticle(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    NEW:                 { label: "สร้างโครงร่าง",     color: "bg-orange-500 text-white" },
    KEYWORD_RESEARCHING: { label: "รอผลวิจัย...",       color: "bg-blue-400 text-white" },
    KEYWORD_DONE:        { label: "สร้างโครงร่าง",     color: "bg-orange-500 text-white" },
    CONTENT_MAP_DONE:    { label: "สร้างโครงร่าง",     color: "bg-orange-500 text-white" },
    OUTLINE_GENERATING:  { label: "รอโครงร่าง...",      color: "bg-orange-400 text-white" },
    OUTLINE_DONE:        { label: "อนุมัติโครงร่าง",   color: "bg-amber-500 text-white" },
    OUTLINE_APPROVED:    { label: "เขียนบทความ",        color: "bg-green-600 text-white" },
    ARTICLE_GENERATING:  { label: "รอบทความ...",         color: "bg-green-400 text-white" },
    ARTICLE_DONE:        { label: "สร้าง Image",         color: "bg-pink-500 text-white" },
    IMAGE_PROMPT_DONE:   { label: "ตรวจ SEO",            color: "bg-teal-500 text-white" },
    SEO_REVIEW:          { label: "อนุมัติบทความ",      color: "bg-emerald-600 text-white" },
    REVISION_REQUIRED:   { label: "แก้ไขบทความ",        color: "bg-red-500 text-white" },
    APPROVED:            { label: "ส่ง WordPress",       color: "bg-indigo-600 text-white" },
    WORDPRESS_DRAFTED:   { label: "ดูใน WordPress",      color: "bg-indigo-400 text-white" },
    POSTED:              { label: "เผยแพร่แล้ว 🎉",     color: "bg-green-700 text-white" },
    ERROR:               { label: "ดูข้อผิดพลาด",       color: "bg-red-600 text-white" },
  };
  return map[status] ?? { label: "เปิดบทความ", color: "bg-gray-400 text-white" };
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "อรุณสวัสดิ์";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATE: "สร้าง",
    UPDATE: "แก้ไข",
    DELETE: "ลบ",
    GENERATE_OUTLINE: "สร้าง Outline",
    GENERATE_ARTICLE: "เขียนบทความ",
    GENERATE_IMAGE_PROMPT: "สร้าง Image Prompt",
    RUN_SEO_CHECK: "ตรวจ SEO",
    SEND_TO_WORDPRESS: "ส่ง WordPress",
    KEYWORD_RESEARCH: "วิจัย Keyword",
    GENERATE_CONTENT_MAP: "สร้าง Content Map",
  };
  return map[action] ?? action;
}

export function SimpleDashboard({ userName, pipelineCounts, myArticles, recentActivity, stats }: Props) {
  return (
    <div className="space-y-8">

      {/* Greeting */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {getGreeting()}, {userName} 👋
          </h1>
          <p className="text-gray-500 mt-1.5 text-base">
            มีบทความที่รอดำเนินการ{" "}
            <span className="font-semibold text-orange-600">{stats.needsAction} บทความ</span>
          </p>
        </div>
        <Link
          href="/articles/new"
          className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white font-medium rounded-xl transition-colors shadow-sm text-sm"
        >
          <Plus className="h-4 w-4" />
          บทความใหม่
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "บทความทั้งหมด", value: stats.total, icon: FileText2, color: "text-gray-700", bg: "bg-white", border: "border-gray-100" },
          { label: "รอดำเนินการ",   value: stats.needsAction, icon: Clock, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-100" },
          { label: "อนุมัติแล้ว",   value: stats.approved,    icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" },
          { label: "เผยแพร่แล้ว",   value: stats.posted,      icon: Globe, color: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-100" },
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl border ${s.border} ${s.bg} p-5 flex items-center gap-4`}>
            <div className={`p-2 rounded-xl ${s.bg}`}>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
            <div>
              <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">ขั้นตอนการผลิตบทความ</h2>
            <p className="text-sm text-gray-500 mt-0.5">คลิกที่การ์ดเพื่อดูบทความในขั้นตอนนั้น</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {PIPELINE_CARDS.map((card) => {
            const count = pipelineCounts[card.label] ?? 0;
            return (
              <Link key={card.label} href={card.href}>
                <div className={`bg-gradient-to-br ${card.gradient} border ${card.border} rounded-2xl p-4 hover:shadow-md transition-all cursor-pointer group`}>
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-2xl">{card.emoji}</span>
                    {count > 0 && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white/80 ${card.countColor}`}>
                        {count}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-gray-800 text-sm leading-tight">{card.labelTh}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-snug hidden lg:block">{card.description}</p>
                  <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${card.countColor} group-hover:underline`}>
                    {count > 0 ? (
                      <>
                        <span className={`text-xl font-bold ${card.countColor}`}>{count}</span>
                        <span className="text-gray-500 text-xs ml-1">บทความ</span>
                      </>
                    ) : (
                      <span className="text-gray-400">ว่างอยู่</span>
                    )}
                  </div>
                  <div className={`mt-2 flex items-center gap-1 text-xs font-medium ${card.countColor} opacity-0 group-hover:opacity-100 transition-opacity`}>
                    <span>{card.actionLabel}</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* My Articles */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">บทความของฉัน</h2>
            <Link href="/articles" className="text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
              ดูทั้งหมด <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {myArticles.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
              <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <PenLine className="h-8 w-8 text-green-400" />
              </div>
              <p className="font-semibold text-gray-700 text-lg">ยังไม่มีบทความที่มอบหมาย</p>
              <p className="text-sm text-gray-400 mt-2 mb-5">สร้างบทความใหม่หรือรับมอบหมายจากผู้จัดการ</p>
              <Link href="/articles/new" className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
                <Plus className="h-4 w-4" /> สร้างบทความแรก
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {myArticles.map((article) => {
                const next = getNextActionForArticle(article.status);
                const statusCfg = STATUS_CONFIG[article.status as ArticleStatus];
                const funnelCfg = FUNNEL_CONFIG[article.funnelStage as FunnelStage];
                return (
                  <Link key={article.id} href={`/articles/${article.id}`}>
                    <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-green-200 hover:shadow-md transition-all group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 group-hover:text-green-700 transition-colors line-clamp-2 leading-snug">
                            {article.title}
                          </p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-xs text-gray-500">{article.project.name}</span>
                            <span className="text-gray-300">·</span>
                            {funnelCfg && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${funnelCfg.bg} ${funnelCfg.color}`}>
                                {article.funnelStage}
                              </span>
                            )}
                            <span className="text-xs text-gray-400">{formatDate(article.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          {statusCfg && (
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                              {statusCfg.labelTh}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                        <span className="text-xs text-gray-400 font-medium">ขั้นตอนถัดไป:</span>
                        <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${next.color}`}>
                          {next.label}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-bold text-gray-900 mb-4">กิจกรรมล่าสุด</h2>
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            {recentActivity.length === 0 ? (
              <div className="text-center py-6">
                <TrendingUp className="h-8 w-8 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">ยังไม่มีกิจกรรม</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentActivity.map((log) => (
                  <div key={log.id} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-sm">
                      {log.user.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 leading-snug">
                        <span className="font-semibold">{log.user.name}</span>{" "}
                        <span className="text-gray-500">{actionLabel(log.action)}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(log.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline icon components to avoid import issues
function FileText2({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
