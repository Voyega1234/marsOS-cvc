"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "muted" | "ok" | "warn" | "bad" | "info";

// ต้องเขียนชื่อคลาสเต็ม ๆ เพื่อไม่ให้ Tailwind ตัดทิ้ง
const CHIP_CLASS: Record<ChipTone, string> = {
  muted: "chip-muted",
  ok: "chip-ok",
  warn: "chip-warn",
  bad: "chip-bad",
  info: "chip-info",
};

/** ป้ายสถานะ / ปุ่มกรอง (ถ้าส่ง onClick จะเป็นปุ่ม) */
export function Chip({ tone, dot = false, active, onClick, children, className, title }: {
  tone?: ChipTone;
  dot?: boolean;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  const cls = cn("chip", tone && CHIP_CLASS[tone], className);
  const inner = (
    <>
      {dot ? <span className="chip-dot" aria-hidden /> : null}
      {children}
    </>
  );
  if (onClick) {
    return (
      <button type="button" title={title} aria-pressed={active} onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <span title={title} className={cls}>{inner}</span>;
}
