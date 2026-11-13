"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** สวิตช์เลือกช่วง/มุมมอง (2–4 ตัวเลือก) */
export function Segmented<T extends string>({ options, value, onChange, size = "md", className, ariaLabel }: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  size?: "md" | "sm";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("seg inline-flex max-w-full overflow-x-auto", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn("seg-item", size === "sm" && "!px-2.5 !py-1 !text-xs")}
        >
          {o.label}
          {typeof o.count === "number" ? <span className="tabular-nums opacity-70">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
