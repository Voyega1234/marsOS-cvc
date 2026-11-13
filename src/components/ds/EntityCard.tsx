"use client";

import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** สี่เหลี่ยมโค้งมีตัวอักษรย่อ (หรือรูป) ขนาด 44px */
export function EntityAvatar({ label, color = "#1d48f3", src, size = 44 }: {
  label: string;
  color?: string;
  src?: string;
  size?: number;
}) {
  const initials = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
  const style = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={label} style={style} className="shrink-0 rounded-2xl object-cover" />;
  }
  return (
    <span
      aria-hidden
      style={{ ...style, backgroundColor: color, fontSize: Math.round(size * 0.36) }}
      className="flex shrink-0 items-center justify-center rounded-2xl font-semibold text-white"
    >
      {initials || "?"}
    </span>
  );
}

const STAT_TONE = {
  default: "text-brand-navy",
  ok: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-red-600",
} as const;

export interface EntityStat {
  label: ReactNode;
  value: ReactNode;
  tone?: keyof typeof STAT_TONE;
}

/** การ์ดเลือกรายการ (ลูกค้า/โปรเจกต์) กดได้ทั้งใบ */
export function EntityCard({ avatar, title, subtitle, badge, stats, footerLeft, footerRight, actions, href, onClick, className, children }: {
  avatar: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  stats?: EntityStat[];
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  actions?: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const titleEl = (
    <span className="block truncate text-[15px] font-semibold text-brand-navy">{title}</span>
  );
  const clickable = Boolean(onClick) && !href;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };
  const cells = (stats ?? []).slice(0, 4);
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? onKey : undefined}
      className={cn(
        "relative flex min-w-0 flex-col gap-3 rounded-3xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur-xl transition",
        "hover:-translate-y-0.5 hover:shadow-md",
        clickable && "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className="block after:absolute after:inset-0 after:rounded-3xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-blue/40">
              {titleEl}
            </Link>
          ) : titleEl}
          {subtitle ? <div className="truncate text-xs text-gray-500">{subtitle}</div> : null}
        </div>
        {badge ? <div className="relative z-10 shrink-0">{badge}</div> : null}
      </div>

      {cells.length > 0 ? (
        <div
          className="grid gap-2 rounded-2xl bg-brand-mist/60 px-3 py-2.5"
          style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
        >
          {cells.map((s, i) => (
            <div key={i} className="min-w-0">
              <div className="truncate text-[11px] text-gray-500">{s.label}</div>
              <div className={cn("truncate text-[15px] font-semibold tabular-nums", STAT_TONE[s.tone ?? "default"])}>{s.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {children ? <div className={cn(href && "relative z-10")}>{children}</div> : null}

      {footerLeft || footerRight ? (
        <div className="flex items-center justify-between gap-2 border-t border-gray-200/70 pt-3 text-xs text-gray-500">
          <div className="min-w-0 truncate">{footerLeft}</div>
          {footerRight ? <div className="relative z-10 shrink-0">{footerRight}</div> : null}
        </div>
      ) : null}

      {actions ? (
        <div className="relative z-10 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** กริดการ์ด 1 → 4 คอลัมน์ */
export function EntityGrid({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4", className)}>{children}</div>;
}
