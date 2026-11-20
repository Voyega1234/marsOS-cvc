import Link from "next/link";
import type { ReactNode } from "react";
import { TRACK } from "@/components/ui/Widgets";

export function KpiCard({
  label,
  value,
  hint,
  accent = "bg-gray-100",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
  icon: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg ${accent}`}>{icon}</span>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-brand-navy">{value}</div>
      {hint && <div className="text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const toneClass = {
    default: "text-brand-navy",
    good: "text-green-600",
    bad: "text-red-500",
    warn: "text-amber-600",
  }[tone];
  return (
    <div className="card p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tracking-tight ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-brand-navy">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  // project / connection
  DRAFT: "bg-gray-100 text-gray-600",
  SETUP: "bg-amber-100 text-amber-700",
  LIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-gray-100 text-gray-600",
  CONNECTED: "bg-green-100 text-green-700",
  NOT_CONNECTED: "bg-gray-100 text-gray-600",
  ERROR: "bg-red-100 text-red-700",
  // lead status
  NEW: "bg-blue-100 text-blue-700",
  CONTACTED: "bg-indigo-100 text-indigo-700",
  QUALIFIED: "bg-violet-100 text-violet-700",
  QUOTED: "bg-amber-100 text-amber-700",
  BOOKED: "bg-teal-100 text-teal-700",
  WON: "bg-green-100 text-green-700",
  PAID: "bg-green-100 text-green-700",
  LOST: "bg-gray-100 text-gray-600",
  // conversion / event
  PENDING: "bg-amber-100 text-amber-700",
  SENT: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  SKIPPED: "bg-gray-100 text-gray-600",
  QUEUED: "bg-blue-100 text-blue-700",
  NOT_READY: "bg-gray-100 text-gray-600",
  PASS: "bg-green-100 text-green-700",
  FAIL: "bg-red-100 text-red-700",
  // channel groups
  "Paid Search": "bg-blue-100 text-blue-700",
  "Paid Social": "bg-fuchsia-100 text-fuchsia-700",
  "Paid Other": "bg-indigo-100 text-indigo-700",
  "AI Assistant": "bg-green-100 text-green-700",
  "Organic Search": "bg-teal-100 text-teal-700",
  "Organic Social": "bg-cyan-100 text-cyan-700",
  Email: "bg-amber-100 text-amber-700",
  Referral: "bg-violet-100 text-violet-700",
  Direct: "bg-gray-100 text-gray-600",
};

const BADGE_BASE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = BADGE_TONES[status] ?? "bg-gray-100 text-gray-600";
  return <span className={`${BADGE_BASE} ${tone}`}>{label ?? status}</span>;
}

export function MockBadge({ mock }: { mock: boolean }) {
  return mock ? (
    <span className={`${BADGE_BASE} bg-amber-100 text-amber-700`}>Mock mode</span>
  ) : (
    <span className={`${BADGE_BASE} bg-green-100 text-green-700`}>Real</span>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-gray-500">
        {text}
      </td>
    </tr>
  );
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="btn-secondary"
    >
      {children}
    </Link>
  );
}

export function Progress({ percent }: { percent: number }) {
  const p = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: TRACK }}>
      <div className="h-full rounded-full bg-brand-blue transition-all" style={{ width: `${p}%` }} />
    </div>
  );
}
