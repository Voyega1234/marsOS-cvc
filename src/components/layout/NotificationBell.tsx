"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, CheckCheck, ExternalLink, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

const TYPE_ICON: Record<string, { emoji: string; color: string }> = {
  AI_JOB_DONE:        { emoji: "✅", color: "bg-green-50" },
  AI_JOB_FAILED:      { emoji: "❌", color: "bg-red-50" },
  ARTICLE_ASSIGNED:   { emoji: "📝", color: "bg-blue-50" },
  REVIEW_REQUESTED:   { emoji: "🔍", color: "bg-amber-50" },
  ARTICLE_APPROVED:   { emoji: "✅", color: "bg-green-50" },
  REVISION_REQUIRED:  { emoji: "✏️", color: "bg-rose-50" },
  COMMENT_ADDED:      { emoji: "💬", color: "bg-purple-50" },
  ARTICLE_PUBLISHED:  { emoji: "🚀", color: "bg-emerald-50" },
  COST_ALERT:         { emoji: "⚠️", color: "bg-orange-50" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [prevUnread, setPrevUnread] = useState(0);
  const [pulse, setPulse] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.isRead).length;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data: Notification[] = await res.json();
        setItems(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Pulse animation when new unread arrives
  useEffect(() => {
    if (unread > prevUnread && prevUnread !== 0) {
      setPulse(true);
      setTimeout(() => setPulse(false), 2000);
    }
    setPrevUnread(unread);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 15000); // poll every 15s
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }

  async function markAllRead() {
    await fetch("/api/notifications", { method: "DELETE" });
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors relative"
      >
        <Bell className={cn("h-4 w-4 transition-transform", pulse && "animate-bounce")} />
        {unread > 0 && (
          <span className={cn(
            "absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center",
            pulse && "animate-ping-once"
          )}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-900">แจ้งเตือน</span>
              {unread > 0 && (
                <span className="text-xs font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full">{unread}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium px-2 py-1 rounded-lg hover:bg-green-50 transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  อ่านทั้งหมด
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-400">กำลังโหลด...</div>
            )}
            {!loading && items.length === 0 && (
              <div className="py-8 text-center">
                <Bell className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">ยังไม่มีการแจ้งเตือน</p>
              </div>
            )}
            {items.slice(0, 10).map((n) => {
              const meta = TYPE_ICON[n.type] ?? { emoji: "🔔", color: "bg-gray-50" };
              const content = (
                <div
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors",
                    !n.isRead && "bg-blue-50/40"
                  )}
                  onClick={() => !n.isRead && markRead(n.id)}
                >
                  <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-base", meta.color)}>
                    {meta.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm leading-snug", !n.isRead ? "font-semibold text-gray-900" : "text-gray-700")}>
                      {n.title}
                    </p>
                    {n.body && <p className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</p>}
                    <p className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
                  {n.link && <ExternalLink className="h-3.5 w-3.5 text-gray-300 flex-shrink-0 mt-1" />}
                </div>
              );

              return n.link ? (
                <Link key={n.id} href={n.link} onClick={() => { markRead(n.id); setOpen(false); }}>
                  {content}
                </Link>
              ) : (
                <div key={n.id}>{content}</div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs text-green-600 hover:text-green-700 font-medium"
            >
              ดูทั้งหมด {items.length} รายการ
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
