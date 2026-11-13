import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** การ์ดกระจก (หรือขาวทึบ) พร้อมหัวการ์ดเสริม */
export function Panel({ title, subtitle, actions, children, className, bodyClassName, padded = true, tone = "glass" }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
  tone?: "glass" | "solid";
}) {
  const hasHeader = Boolean(title || subtitle || actions);
  return (
    <section
      className={cn(
        "min-w-0 rounded-3xl border border-white/80 shadow-sm",
        tone === "solid" ? "bg-white" : "bg-white/70 backdrop-blur-xl",
        className,
      )}
    >
      {hasHeader ? (
        <header className={cn("flex flex-wrap items-start justify-between gap-3", padded ? "px-4 pt-4 md:px-5 md:pt-5" : "px-4 pt-4 md:px-5")}>
          <div className="min-w-0">
            {title ? <h2 className="text-[15px] font-semibold text-brand-navy">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(padded ? (hasHeader ? "p-4 pt-3 md:p-5 md:pt-4" : "p-4 md:p-5") : "", bodyClassName)}>{children}</div>
    </section>
  );
}
