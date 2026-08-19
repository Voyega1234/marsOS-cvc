"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { STATUS_COLORS, RISK_COLORS } from "./constants";
import type { CEMode, CEStatus, RiskLevel } from "./types";

export function StatusBadge({ status }: { status: CEStatus | string }) {
  const cls = STATUS_COLORS[status as CEStatus] ?? "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>
      {status}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel | string }) {
  const cls = RISK_COLORS[risk as RiskLevel] ?? "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", cls)}>
      Risk: {risk || "—"}
    </span>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-gray-200 bg-white p-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            {title && <h3 className="text-sm font-semibold text-brand-navy">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>
  );
}

/** Segmented toggle: "กรอกฟอร์ม" | "วาง Prompt ดิบ" — ใช้ที่หัวตัวแก้ไขของทุก Layer */
export function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: CEMode;
  onChange: (mode: CEMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("form")}
        className={cn(
          "rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          mode === "form" ? "bg-white text-brand-navy shadow-sm" : "text-gray-500 hover:text-gray-700"
        )}
      >
        กรอกฟอร์ม
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("raw")}
        className={cn(
          "rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          mode === "raw" ? "bg-white text-brand-navy shadow-sm" : "text-gray-500 hover:text-gray-700"
        )}
      >
        วาง Prompt ดิบ
      </button>
    </div>
  );
}

/** แจ้งเตือนตอนกด "กรอกฟอร์ม" ขณะอยู่โหมดดิบ แต่เนื้อหาปัจจุบันไม่ใช่ JSON ที่แปลงเป็นฟอร์มได้ */
export function RawToFormNotice({ onStartFresh }: { onStartFresh: () => void }) {
  return (
    <div className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      <p>เนื้อหาปัจจุบันเป็นข้อความดิบ — แก้ในโหมดดิบ หรือเริ่มฟอร์มใหม่ (ทับของเดิมเมื่อบันทึก)</p>
      <button
        type="button"
        onClick={onStartFresh}
        className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        เริ่มฟอร์มใหม่
      </button>
    </div>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-400">
      {children}
    </p>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cn(
          "relative flex h-full w-full flex-col border-l border-gray-200 bg-white shadow-xl",
          wide ? "max-w-lg" : "max-w-md"
        )}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-brand-navy">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="ปิด"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function completeness(filled: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((filled / total) * 100);
}
