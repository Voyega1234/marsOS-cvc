"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** แท็บขีดเส้นใต้ พร้อมตัวนับ */
export function UnderlineTabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { id: T; label: ReactNode; count?: number; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("utabs overflow-x-auto", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className="utab whitespace-nowrap shrink-0"
        >
          {t.icon}
          {t.label}
          {typeof t.count === "number" ? <span className="utab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
