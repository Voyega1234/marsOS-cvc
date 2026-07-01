"use client";

const FUNNEL: Record<string, string> = {
  TOFU: "bg-sky-100 text-sky-800",
  MOFU: "bg-violet-100 text-violet-800",
  BOFU: "bg-rose-100 text-rose-800",
};

export function FunnelBadge({ stage, className = "" }: { stage: string; className?: string }) {
  const base = FUNNEL[stage] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${base} ${className}`}>
      {stage}
    </span>
  );
}
