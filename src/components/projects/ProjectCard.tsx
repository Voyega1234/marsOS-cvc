"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Globe, AlertCircle, CheckCircle2, Clock, PauseCircle, ArchiveX, PlayCircle } from "lucide-react";

type TimelineStats = { total: number; writing: number; review: number; approved: number; pushed: number };

type ProjectWithStats = {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  businessType: string;
  industry: string | null;
  language: string;
  market: string | null;
  status: string;
  updatedAt: Date;
  monthlyTarget?: number | null;
  owner: { id: string; name: string | null } | null;
  _count: { articles: number; keywords: number; members: number };
  statusMap: Record<string, number>;
  timelineStats?: TimelineStats;
  userRole?: string;
};

function nextActionFromTimeline(ts: TimelineStats): { labelTh: string; variant: "warning" | "info" | "success" | "neutral" } | null {
  if (ts.review > 0)   return { labelTh: `มีบทความรอตรวจ ${ts.review} บทความ`, variant: "warning" };
  if (ts.approved > 0) return { labelTh: `${ts.approved} บทความพร้อมส่ง Push`, variant: "success" };
  if (ts.writing > 0)  return { labelTh: `กำลังเขียน ${ts.writing} บทความ…`, variant: "neutral" };
  return null;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    "bg-green-50 text-green-700 border border-green-200",
  PLANNING:  "bg-blue-50 text-blue-700 border border-blue-200",
  PAUSED:    "bg-yellow-50 text-yellow-700 border border-yellow-200",
  COMPLETED: "bg-gray-100 text-gray-600 border border-gray-100",
  ARCHIVED:  "bg-gray-100 text-gray-400 border border-gray-100",
};

const NEXT_ACTION_STYLES = {
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  info:    "bg-blue-50 border-blue-200 text-blue-800",
  success: "bg-green-50 border-green-200 text-green-800",
  neutral: "bg-gray-50 border-gray-100 text-gray-600",
};

const NEXT_ACTION_ICONS = {
  warning: <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />,
  info:    <Clock className="h-3.5 w-3.5 flex-shrink-0" />,
  success: <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />,
  neutral: <Clock className="h-3.5 w-3.5 flex-shrink-0" />,
};

export default function ProjectCard({ project }: { project: ProjectWithStats }) {
  const ts = project.timelineStats ?? { total: 0, writing: 0, review: 0, approved: 0, pushed: 0 }
  const total    = ts.total
  const done     = ts.approved + ts.pushed
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  const hint     = total > 0 ? nextActionFromTimeline(ts) : null
  const [currentStatus, setCurrentStatus] = useState(project.status)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const statusClass = STATUS_COLORS[currentStatus] ?? "bg-gray-100 text-gray-600 border border-gray-100"
  const isAdmin = project.userRole === 'ADMIN' || project.userRole === 'USER'

  async function handleStatusChange(newStatus: string) {
    if (updatingStatus) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) setCurrentStatus(newStatus)
    } finally {
      setUpdatingStatus(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 hover:border-green-200 hover:shadow-lg transition-all duration-200 flex flex-col group">
      <div className="p-5 flex-1 space-y-4">

        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900 leading-tight truncate group-hover:text-green-700 transition-colors">
              {project.name}
            </h3>
            {project.clientName && project.clientName !== project.name && (
              <p className="text-sm text-gray-400 mt-0.5 truncate">{project.clientName}</p>
            )}
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${statusClass}`}>
            {currentStatus}
          </span>
        </div>

        {/* Website */}
        {project.website && (
          <div className="flex items-center gap-1.5 text-sm text-blue-500">
            <Globe className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{project.website}</span>
          </div>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {project.businessType && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{project.businessType}</span>
          )}
          {project.industry && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{project.industry}</span>
          )}
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full uppercase font-medium">{project.language}</span>
        </div>

        {/* Next action hint */}
        {hint && (
          <div className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border font-medium ${NEXT_ACTION_STYLES[hint.variant]}`}>
            {NEXT_ACTION_ICONS[hint.variant]}
            <span>{hint.labelTh}</span>
          </div>
        )}

        {/* Progress bar */}
        {total > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
              <span>ความคืบหน้า</span>
              <span className="font-semibold text-gray-600">{progress}%
                {project.monthlyTarget ? <span className="font-normal text-gray-400 ml-1">· target {project.monthlyTarget}/เดือน</span> : null}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 py-3 border-t border-b border-gray-50">
          {[
            { value: ts.total,    label: "บทความทั้งหมด", color: "text-gray-800" },
            { value: ts.writing,  label: "กำลังเขียน",    color: "text-blue-600" },
            { value: ts.review,   label: "รอตรวจ",        color: "text-amber-600" },
            { value: ts.pushed,   label: "Pushed",        color: "text-teal-600" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 leading-tight mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Footer meta */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{project.owner?.name ? `👤 ${project.owner.name}` : ""}</span>
          <span>{formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}</span>
        </div>
      </div>

      {/* CTA footer */}
      <div className="px-5 pb-5 pt-1 space-y-2">
        <Link
          href={`/projects/${project.id}`}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] active:bg-green-800 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          เปิดโปรเจกต์
          <ArrowRight className="h-4 w-4" />
        </Link>
        <div className="flex gap-2">
          <Link
            href={`/projects/${project.id}?tab=articles`}
            className="flex-1 text-center py-1.5 text-sm text-gray-500 border border-gray-100 rounded-xl hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            บทความ
          </Link>
          <Link
            href={`/projects/${project.id}?tab=keywords`}
            className="flex-1 text-center py-1.5 text-sm text-gray-500 border border-gray-100 rounded-xl hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            Keywords
          </Link>
        </div>

        {isAdmin && (
          <div className="flex gap-2 pt-1 border-t border-gray-50">
            {currentStatus !== 'PAUSED' && currentStatus !== 'ARCHIVED' && (
              <button
                onClick={() => handleStatusChange('PAUSED')}
                disabled={updatingStatus}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-amber-600 border border-amber-100 rounded-xl hover:bg-amber-50 transition-colors disabled:opacity-40"
              >
                <PauseCircle size={12} /> ระงับ
              </button>
            )}
            {currentStatus === 'PAUSED' && (
              <button
                onClick={() => handleStatusChange('ACTIVE')}
                disabled={updatingStatus}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-green-600 border border-green-100 rounded-xl hover:bg-green-50 transition-colors disabled:opacity-40"
              >
                <PlayCircle size={12} /> เปิดใช้งาน
              </button>
            )}
            {currentStatus !== 'ARCHIVED' ? (
              <button
                onClick={() => { if (confirm(`Archive "${project.name}"? ยังสามารถกู้คืนได้`)) handleStatusChange('ARCHIVED') }}
                disabled={updatingStatus}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 border border-gray-100 rounded-xl hover:bg-gray-50 hover:text-red-500 hover:border-red-100 transition-colors disabled:opacity-40"
              >
                <ArchiveX size={12} /> Archive
              </button>
            ) : (
              <button
                onClick={() => handleStatusChange('ACTIVE')}
                disabled={updatingStatus}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-green-600 border border-green-100 rounded-xl hover:bg-green-50 transition-colors disabled:opacity-40"
              >
                <PlayCircle size={12} /> กู้คืน
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
