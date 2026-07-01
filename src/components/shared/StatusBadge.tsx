import { cn } from "@/lib/utils";
import { STATUS_CONFIG } from "@/types";
import type { ArticleStatus } from "@/types";

interface StatusBadgeProps {
  status: string;
  showThai?: boolean;
  className?: string;
}

export function StatusBadge({ status, showThai = true, className }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status as ArticleStatus] ?? { label: status, labelTh: status, color: "text-gray-600", bg: "bg-gray-100" };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", cfg.color, cfg.bg, className)}>
      {showThai ? cfg.labelTh : cfg.label}
    </span>
  );
}
