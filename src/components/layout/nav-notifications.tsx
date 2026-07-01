"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import Link from "next/link";

interface Notification {
  id: string;
  avatar?: string;
  fallback: string;
  text: string;
  time: string;
}

interface Props {
  notifications: Notification[];
}

export function NotificationsPopover({ notifications }: Props) {
  const [open, setOpen] = useState(false);
  const count = notifications.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-900 text-[9px] font-semibold text-white">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 p-0 shadow-lg rounded-xl border border-gray-100"
      >
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-[13px] font-semibold text-gray-900">Notifications</p>
        </div>
        {notifications.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">No notifications</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600">
                  {n.fallback}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] text-gray-700 leading-snug">{n.text}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{n.time}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-gray-100 px-4 py-2.5">
          <Link
            href="/activity-logs"
            onClick={() => setOpen(false)}
            className="text-[12px] text-gray-500 hover:text-gray-700 transition-colors"
          >
            View all activity →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
