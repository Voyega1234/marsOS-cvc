"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck, Trash2, ExternalLink, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
};

const TYPE_META: Record<string, { emoji: string; color: string; label: string }> = {
  AI_JOB_DONE:        { emoji: "✅", color: "bg-green-50 border-green-100",   label: "AI เสร็จ" },
  AI_JOB_FAILED:      { emoji: "❌", color: "bg-red-50 border-red-100",       label: "AI Error" },
  ARTICLE_ASSIGNED:   { emoji: "📝", color: "bg-blue-50 border-blue-100",     label: "Assigned" },
  REVIEW_REQUESTED:   { emoji: "🔍", color: "bg-amber-50 border-amber-100",   label: "Review" },
  ARTICLE_APPROVED:   { emoji: "✅", color: "bg-emerald-50 border-emerald-100", label: "Approved" },
  REVISION_REQUIRED:  { emoji: "✏️", color: "bg-rose-50 border-rose-100",     label: "Revision" },
  COMMENT_ADDED:      { emoji: "💬", color: "bg-purple-50 border-purple-100", label: "Comment" },
  ARTICLE_PUBLISHED:  { emoji: "🚀", color: "bg-sky-50 border-sky-100",       label: "Published" },
  COST_ALERT:         { emoji: "⚠️", color: "bg-orange-50 border-orange-100", label: "Cost Alert" },
};

const FILTER_OPTIONS = [
  { value: "all",      label: "ทั้งหมด" },
  { value: "unread",   label: "ยังไม่อ่าน" },
  { value: "ai",       label: "AI Jobs" },
  { value: "articles", label: "บทความ" },
  { value: "alerts",   label: "แจ้งเตือน" },
];

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} วันที่แล้ว`;
  return new Date(date).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function matchFilter(n: Notification, filter: string): boolean {
  if (filter === "unread") return !n.isRead;
  if (filter === "ai") return n.type.startsWith("AI_");
  if (filter === "articles") return ["ARTICLE_ASSIGNED", "REVIEW_REQUESTED", "ARTICLE_APPROVED", "REVISION_REQUIRED", "COMMENT_ADDED", "ARTICLE_PUBLISHED"].includes(n.type);
  if (filter === "alerts") return n.type === "COST_ALERT";
  return true;
}

export function NotificationsPageClient({ notifications: initial }: { notifications: Notification[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>(initial);
  const [filter, setFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  const unread = items.filter((n) => !n.isRead).length;
  const filtered = items.filter((n) => matchFilter(n, filter));

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }

  async function markAllRead() {
    await fetch("/api/notifications", { method: "DELETE" });
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  async function deleteNotification(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Bell className="h-5 w-5 text-gray-600" />
            การแจ้งเตือน
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {unread > 0 ? `${unread} รายการที่ยังไม่ได้อ่าน` : "อ่านทั้งหมดแล้ว"}
          </p>
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1.5">
            <CheckCheck className="h-3.5 w-3.5" />
            อ่านทั้งหมด
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTER_OPTIONS.map((opt) => {
          const count = opt.value === "all" ? items.length
            : opt.value === "unread" ? items.filter((n) => !n.isRead).length
            : items.filter((n) => matchFilter(n, opt.value)).length;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                filter === opt.value
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {opt.label}
              {count > 0 && (
                <span className={cn("ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                  filter === opt.value ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <Bell className="h-10 w-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-400">ไม่มีการแจ้งเตือน</p>
          </div>
        )}

        {filtered.map((n) => {
          const meta = TYPE_META[n.type] ?? { emoji: "🔔", color: "bg-gray-50 border-gray-100", label: n.type };

          const inner = (
            <div
              className={cn(
                "group flex items-start gap-4 p-4 rounded-2xl border transition-all",
                meta.color,
                !n.isRead && "ring-1 ring-inset ring-blue-200",
                "hover:shadow-sm"
              )}
              onClick={() => { if (!n.isRead) markRead(n.id); }}
            >
              <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center flex-shrink-0 text-lg shadow-sm">
                {meta.emoji}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={cn("text-sm leading-snug", !n.isRead ? "font-semibold text-gray-900" : "text-gray-700")}>
                    {n.title}
                  </p>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {n.link && <ExternalLink className="h-3.5 w-3.5 text-gray-400" />}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteNotification(n.id); }}
                      className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/60 border border-gray-200 text-gray-500 font-medium">
                    {meta.label}
                  </span>
                  <span className="text-xs text-gray-400">{timeAgo(n.createdAt)}</span>
                  {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                </div>
              </div>
            </div>
          );

          return n.link ? (
            <Link key={n.id} href={n.link} className="block">
              {inner}
            </Link>
          ) : (
            <div key={n.id}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
