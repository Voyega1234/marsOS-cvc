import { cn } from "@/lib/utils";

// โลโก้รูปถูกถอดตามคำสั่งเจ้าของ 2026-08-19 — แบรนด์ใช้ชื่อ "MarsOS" เป็นตัวอักษรเท่านั้น
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold text-brand-navy tracking-tight", className)}>MarsOS</span>
  );
}
