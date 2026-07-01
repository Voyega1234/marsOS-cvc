"use client";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800", PLANNING: "bg-blue-100 text-blue-800",
  PAUSED: "bg-yellow-100 text-yellow-800", COMPLETED: "bg-gray-100 text-gray-700",
  ARCHIVED: "bg-gray-100 text-gray-400", NEW: "bg-gray-100 text-gray-600",
  KEYWORD_DONE: "bg-cyan-100 text-cyan-700", OUTLINE_DONE: "bg-blue-100 text-blue-700",
  OUTLINE_APPROVED: "bg-indigo-100 text-indigo-700", ARTICLE_GENERATING: "bg-purple-50 text-purple-600",
  ARTICLE_DONE: "bg-purple-100 text-purple-700", SEO_REVIEW: "bg-yellow-100 text-yellow-700",
  SEO_DONE: "bg-teal-100 text-teal-700", SEO_NEEDS_REVISION: "bg-orange-100 text-orange-700",
  REVISION_REQUIRED: "bg-orange-100 text-orange-700", APPROVED: "bg-green-100 text-green-700",
  WORDPRESS_DRAFTED: "bg-teal-100 text-teal-800", POSTED: "bg-green-200 text-green-900",
  ERROR: "bg-red-100 text-red-700", GENERATED: "bg-blue-100 text-blue-700",
  EXCLUDED: "bg-gray-100 text-gray-400", ARTICLE_CREATED: "bg-green-100 text-green-700",
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const base = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
  const label = status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${base} ${className}`}>
      {label}
    </span>
  );
}
