import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { PipelineStep, ArticleStatus } from "@/types";

interface PipelineStepCardProps {
  step: PipelineStep;
  count: number;
  currentStatus?: ArticleStatus;
  isActive?: boolean;
  onClick?: () => void;
}

export function PipelineStepCard({ step, count, isActive, onClick }: PipelineStepCardProps) {
  const colorMap: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    blue:   { bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-700",   icon: "text-blue-500" },
    purple: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", icon: "text-purple-500" },
    orange: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: "text-orange-500" },
    green:  { bg: "bg-green-50",  border: "border-green-200",  text: "text-green-700",  icon: "text-green-500" },
    pink:   { bg: "bg-pink-50",   border: "border-pink-200",   text: "text-pink-700",   icon: "text-pink-500" },
    teal:   { bg: "bg-teal-50",   border: "border-teal-200",   text: "text-teal-700",   icon: "text-teal-500" },
    indigo: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", icon: "text-indigo-500" },
  };
  const colors = colorMap[step.color] ?? colorMap.blue;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 p-4 rounded-xl border-2 transition-all",
        colors.bg, colors.border,
        isActive && "ring-2 ring-offset-2 ring-green-500",
        onClick && "cursor-pointer hover:shadow-md"
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-semibold uppercase tracking-wider", colors.text)}>{step.label}</span>
        {count > 0 ? (
          <CheckCircle2 className={cn("h-4 w-4", colors.icon)} />
        ) : (
          <Circle className="h-4 w-4 text-gray-300" />
        )}
      </div>
      <div className={cn("text-2xl font-bold", colors.text)}>{count}</div>
      <div className="text-xs text-gray-500">{step.labelTh}</div>
    </div>
  );
}
