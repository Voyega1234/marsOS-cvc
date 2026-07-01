import { cn } from "@/lib/utils";
import { FUNNEL_CONFIG } from "@/types";
import type { FunnelStage } from "@/types";

interface FunnelBadgeProps {
  stage: string;
  className?: string;
}

export function FunnelBadge({ stage, className }: FunnelBadgeProps) {
  const cfg: { label: string; labelTh?: string; color: string; bg: string } =
    FUNNEL_CONFIG[stage as FunnelStage] ?? { label: stage, color: "text-gray-600", bg: "bg-gray-100" };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold", cfg.color, cfg.bg, className)}>
      {cfg.labelTh ?? cfg.label}
    </span>
  );
}
