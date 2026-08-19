"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { STATUS_STYLES } from "./mockData";

// ─── Status pill — always shows text, not just color ───────────────────────

export function StatusPill({ status, className = "" }: { status: string; className?: string }) {
  const s = STATUS_STYLES[status] ?? { bg: "bg-gray-50 border-gray-200", text: "text-gray-600", dot: "bg-gray-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${s.bg} ${s.text} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

// ─── Mock data badge — required by reality contract ────────────────────────

export function MockBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="ข้อมูลตัวอย่างสำหรับสาธิต UI ไม่ใช่ข้อมูลจริง"
      className={`inline-flex items-center rounded-full border border-dashed border-gray-300 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500 whitespace-nowrap ${className}`}
    >
      ตัวอย่าง
    </span>
  );
}

// ─── Section card ────────────────────────────────────────────────────────

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
          <div>
            {title && <h2 className="text-sm font-bold text-brand-navy">{title}</h2>}
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}

// ─── Centered modal (used by Connect Website Wizard) ────────────────────────

export function Modal({
  open,
  onClose,
  children,
  widthClassName = "max-w-3xl",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className={`relative w-full ${widthClassName} bg-white rounded-2xl border border-gray-200 shadow-xl my-8`}>
        {children}
      </div>
    </div>
  );
}

// ─── Right-side drawer with backdrop (logs, run detail, mapping, etc.) ─────

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  widthClassName = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 right-0 w-full ${widthClassName} bg-white border-l border-gray-200 shadow-xl flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-brand-navy">{title}</h3>
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex items-center gap-2 px-6 py-4 border-t border-gray-200 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small labeled field for detail views ──────────────────────────────────

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5 break-words">{value ?? "—"}</p>
    </div>
  );
}
