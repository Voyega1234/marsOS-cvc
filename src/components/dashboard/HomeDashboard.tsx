"use client";

import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { th } from "date-fns/locale";
import {
  AlertCircle, CheckCircle2, Clock, FileText,
  Globe, RefreshCw, Send, Pencil, Eye,
} from "lucide-react";

interface PendingEntry {
  idx: number;
  date: string;
  keyword: string;
  title: string;
  articleStatus: string;
}

interface ProjectRow {
  id: string;
  name: string;
  website: string;
  status: string;
  updatedAt: Date;
  total: number;
  pending: number;
  writing: number;
  review: number;
  approved: number;
  pushed: number;
  done: number;
  progress: number;
  pendingEntries: PendingEntry[];
  hasPendingWork: boolean;
}

interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  createdAt: Date;
  userName: string;
  newValue: string;
}

interface Props {
  userName: string;
  projectRows: ProjectRow[];
  summary: {
    totalProjects: number;
    totalArticles: number;
    totalPending: number;
    totalWriting: number;
    totalReview: number;
    totalPushed: number;
  };
  recentActivity: ActivityEntry[];
}

const STATUS_LABEL: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: "รอเขียน",    color: "bg-gray-100 text-gray-500",    icon: <Clock size={10} /> },
  writing:  { label: "กำลังเขียน", color: "bg-blue-100 text-blue-600",   icon: <RefreshCw size={10} className="animate-spin" /> },
  review:   { label: "รอตรวจ",     color: "bg-amber-100 text-amber-700",  icon: <Eye size={10} /> },
  approved: { label: "Approved",   color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 size={10} /> },
  pushed:   { label: "Pushed",     color: "bg-teal-100 text-teal-700",    icon: <Send size={10} /> },
};

const ACTION_LABEL: Record<string, string> = {
  ARTICLE_WRITE:   "เขียนบทความ",
  ARTICLE_PUSHED:  "Push ขึ้นเว็บ",
  ROLE_CHANGED:    "เปลี่ยน Role",
  CREATE:          "สร้างรายการ",
  UPDATE:          "แก้ไข",
  DELETE:          "ลบ",
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, color: "bg-gray-100 text-gray-500", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${s.color}`}>
      {s.icon}{s.label}
    </span>
  );
}

export function HomeDashboard({ userName, projectRows, summary, recentActivity }: Props) {
  const today = format(new Date(), "EEEE d MMMM yyyy", { locale: th });

  // Projects with pending work — sort review first, then writing, then pending
  const activeProjects = projectRows
    .filter(p => p.hasPendingWork)
    .sort((a, b) => (b.review + b.writing * 0.5) - (a.review + a.writing * 0.5));

  const idleProjects = projectRows.filter(p => !p.hasPendingWork && p.total > 0);

  return (
    <div className="space-y-6 max-w-6xl">

      {/* Header */}
      <div>
        <p className="text-xs text-gray-400 mb-0.5">{today}</p>
        <h1 className="text-xl font-bold text-gray-900">
          สวัสดี{userName ? `, ${userName}` : ""} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">ภาพรวมงานที่ค้างอยู่ในระบบ</p>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: "Projects",      value: summary.totalProjects, color: "bg-gray-900 text-white" },
          { label: "บทความทั้งหมด", value: summary.totalArticles, color: "bg-gray-100 text-gray-700" },
          { label: "รอเขียน",       value: summary.totalPending,  color: summary.totalPending > 0  ? "bg-gray-100 text-gray-600" : "bg-gray-50 text-gray-400" },
          { label: "กำลังเขียน",    value: summary.totalWriting,  color: summary.totalWriting > 0  ? "bg-blue-100 text-blue-700" : "bg-gray-50 text-gray-400" },
          { label: "รอตรวจ",        value: summary.totalReview,   color: summary.totalReview > 0   ? "bg-amber-100 text-amber-700" : "bg-gray-50 text-gray-400" },
          { label: "Pushed แล้ว",   value: summary.totalPushed,   color: summary.totalPushed > 0   ? "bg-emerald-100 text-emerald-700" : "bg-gray-50 text-gray-400" },
        ].map(s => (
          <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${s.color}`}>
            <span>{s.value}</span>
            <span className="font-normal opacity-70">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── งานค้าง ── */}
      {activeProjects.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-500" />
            งานที่ค้างอยู่ ({activeProjects.length} client)
          </h2>

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] gap-0 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wide">
              <span>Client</span>
              <span className="text-center">รอเขียน</span>
              <span className="text-center">กำลังเขียน</span>
              <span className="text-center">รอตรวจ</span>
              <span className="text-center">Progress</span>
              <span></span>
            </div>

            {activeProjects.map((p, i) => (
              <div key={p.id} className={`${i !== activeProjects.length - 1 ? "border-b border-gray-50" : ""}`}>
                {/* Row */}
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] gap-0 px-5 py-3.5 items-center hover:bg-gray-50/50 transition-colors">
                  {/* Client */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {(p.review > 0) && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />}
                      {(p.writing > 0 && p.review === 0) && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 animate-pulse" />}
                      {(p.pending > 0 && p.writing === 0 && p.review === 0) && <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />}
                      <span className="font-semibold text-gray-900 text-sm truncate">{p.name}</span>
                    </div>
                    {p.website && (
                      <p className="text-[11px] text-gray-400 truncate mt-0.5 ml-4">{p.website}</p>
                    )}
                  </div>
                  {/* Stats */}
                  <div className="text-center">
                    <span className={`text-sm font-bold ${p.pending > 0 ? "text-gray-600" : "text-gray-300"}`}>{p.pending}</span>
                  </div>
                  <div className="text-center">
                    <span className={`text-sm font-bold ${p.writing > 0 ? "text-blue-600" : "text-gray-300"}`}>{p.writing}</span>
                  </div>
                  <div className="text-center">
                    <span className={`text-sm font-bold ${p.review > 0 ? "text-amber-600" : "text-gray-300"}`}>{p.review}</span>
                  </div>
                  {/* Progress */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${p.progress}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium w-7 text-right">{p.progress}%</span>
                  </div>
                  {/* Action */}
                  <div className="flex justify-end">
                    <Link
                      href={`/projects/${p.id}?tab=${p.review > 0 ? "review" : "articles"}`}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 transition-colors"
                    >
                      {p.review > 0 ? <Eye size={11} /> : <Pencil size={11} />}
                      {p.review > 0 ? "ตรวจ" : "เขียน"}
                    </Link>
                  </div>
                </div>

                {/* Pending entries list */}
                {p.pendingEntries.length > 0 && (
                  <div className="px-5 pb-3 space-y-1 ml-4">
                    {p.pendingEntries.map(e => (
                      <div key={e.idx} className="flex items-center gap-2 py-0.5">
                        <StatusChip status={e.articleStatus || "pending"} />
                        <span className="text-xs text-gray-500 truncate flex-1">{e.title || e.keyword}</span>
                        {e.date && (
                          <span className="text-[10px] text-gray-300 shrink-0">{e.date}</span>
                        )}
                      </div>
                    ))}
                    {(p.pending + p.writing + p.review) > p.pendingEntries.length && (
                      <Link href={`/projects/${p.id}?tab=articles`} className="text-[10px] text-blue-500 hover:underline">
                        + อีก {(p.pending + p.writing + p.review) - p.pendingEntries.length} บทความ →
                      </Link>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Projects ที่เสร็จแล้ว / ไม่มีงานค้าง ── */}
      {idleProjects.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-500" />
            ไม่มีงานค้าง ({idleProjects.length} client)
          </h2>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {idleProjects.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-4 px-5 py-3 hover:bg-gray-50/50 transition-colors ${i !== idleProjects.length - 1 ? "border-b border-gray-50" : ""}`}
              >
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-700">{p.name}</span>
                  <span className="text-[11px] text-gray-400 ml-2">{p.pushed}/{p.total} pushed</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${p.progress}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-7 text-right">{p.progress}%</span>
                </div>
                <Link href={`/projects/${p.id}?tab=articles`} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
                  ดู →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {projectRows.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-500 font-medium">ยังไม่มี client</p>
          <p className="text-gray-400 text-sm mt-1">ไปที่ Clients เพื่อสร้าง project แรก</p>
          <Link href="/projects" className="inline-block mt-4 px-4 py-2 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-700 transition-colors">
            + สร้าง Client
          </Link>
        </div>
      )}

      {/* ── Activity Log ── */}
      {recentActivity.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <FileText size={14} className="text-gray-400" />
            กิจกรรมล่าสุด
          </h2>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
            {recentActivity.slice(0, 15).map(a => {
              let detail = ""
              try {
                const v = JSON.parse(a.newValue || "{}")
                if (v.title) detail = v.title
                else if (v.keyword) detail = v.keyword
              } catch { /* ignore */ }

              return (
                <div key={a.id} className="flex items-start gap-3 px-5 py-3">
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-gray-500">{a.userName?.[0]?.toUpperCase() ?? "?"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700">
                      <span className="font-semibold">{a.userName}</span>
                      {" "}
                      <span className="text-gray-500">{ACTION_LABEL[a.action] ?? a.action}</span>
                      {detail && <span className="text-gray-600"> — {detail}</span>}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true, locale: th })}
                    </p>
                  </div>
                  <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-mono shrink-0">{a.action}</span>
                </div>
              );
            })}
          </div>
          {recentActivity.length > 15 && (
            <div className="mt-2 text-center">
              <Link href="/activity-logs" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
                ดู Activity Logs ทั้งหมด →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
