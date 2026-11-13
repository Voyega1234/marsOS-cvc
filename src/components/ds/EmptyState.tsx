import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** สถานะว่าง: วงกลมไอคอนนุ่ม ๆ + ข้อความ + ปุ่ม */
export function EmptyState({ icon, title, description, action, className }: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 py-10 text-center", className)}>
      {icon ? (
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-mist text-brand-blue">{icon}</div>
      ) : null}
      <div className="text-[15px] font-semibold text-brand-navy">{title}</div>
      {description ? <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
