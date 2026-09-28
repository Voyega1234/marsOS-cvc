import type { UploadArticleStatus } from "@/lib/upload-article/types";

const CONFIG: Record<UploadArticleStatus, { label: string; className: string }> = {
  WRITING: { label: "กำลังเขียน", className: "bg-sky-100 text-sky-700" },
  IMPORTED: { label: "นำเข้าแล้ว", className: "bg-gray-100 text-gray-600" },
  GENERATED: { label: "Generate แล้ว", className: "bg-blue-100 text-brand-blue" },
  REVIEWED: { label: "ผ่าน Review", className: "bg-emerald-100 text-emerald-700" },
  PUSHING: { label: "กำลัง Push", className: "bg-amber-100 text-amber-700" },
  PUSHED: { label: "Push แล้ว", className: "bg-purple-100 text-purple-700" },
  FAILED: { label: "Push ไม่สำเร็จ", className: "bg-rose-100 text-rose-600" },
};

export default function UploadStatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const cfg = CONFIG[status as UploadArticleStatus] ?? { label: status, className: "bg-gray-100 text-gray-500" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.className} ${className}`}>
      {cfg.label}
    </span>
  );
}
