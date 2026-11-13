import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiTone = "plain" | "blue" | "sky" | "mist" | "navy" | "warm";

// ต้องเขียนชื่อคลาสเต็ม ๆ เพื่อไม่ให้ Tailwind ตัดทิ้ง
const KPI_CLASS: Record<KpiTone, string> = {
  plain: "",
  blue: "kpi-blue",
  sky: "kpi-sky",
  mist: "kpi-mist",
  navy: "kpi-navy",
  warm: "kpi-warm",
};

/** จัดรูปเปอร์เซ็นต์การเปลี่ยนแปลง: ทศนิยมไม่เกิน 1 ตำแหน่ง + เครื่องหมายชัดเจน */
function fmtDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "-"}${Math.abs(r)}`;
}

/** กล่องตัวเลขสีอ่อน พร้อม delta */
export function KpiTile({ label, value, hint, delta, deltaSuffix = "%", invertDelta = false, tone = "plain", icon, footer, className }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  delta?: number | null;
  deltaSuffix?: string;
  invertDelta?: boolean;
  tone?: KpiTone;
  icon?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  let deltaEl: ReactNode = null;
  if (typeof delta === "number" && Number.isFinite(delta)) {
    const rounded = Math.round(delta * 10) / 10;
    const good = invertDelta ? rounded < 0 : rounded > 0;
    const bad = invertDelta ? rounded > 0 : rounded < 0;
    const cls = rounded === 0 ? "delta-flat" : good ? "delta-up" : bad ? "delta-down" : "delta-flat";
    const Icon = rounded === 0 ? Minus : rounded > 0 ? ArrowUpRight : ArrowDownRight;
    deltaEl = (
      <span className={cls}>
        <Icon className="h-3 w-3" aria-hidden />
        {fmtDelta(delta)}{deltaSuffix}
      </span>
    );
  }
  const navy = tone === "navy";
  return (
    <div className={cn("kpi", KPI_CLASS[tone], className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="kpi-label min-w-0">{label}</div>
        {icon ? (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", navy ? "bg-white/15 text-white" : "bg-white/70 text-brand-blue")}>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-1">
        <div className="kpi-value">{value}</div>
        {deltaEl}
      </div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}
