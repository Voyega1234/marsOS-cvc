"use client";

import { useRouter } from "next/navigation";
import { CHAT_FILTERS, type ChatFilter as ChatFilterKey } from "@/lib/line-tracking/services/leadFilters";

/**
 * Dropdown กรองตามการทัก — "ทักในช่วงวันที่นี้" ทำให้เห็นลูกค้าเก่าที่กลับมาทัก
 * (ช่วงวันที่ปกติกรองตามวันแอดครั้งแรก) ส่วน "เคยทัก / แค่แอด" แยกคนที่แอดแต่ไม่เคยพิมพ์ออก
 * `extra` พาพารามิเตอร์อื่นของหน้าไปด้วย สลับแล้วตัวกรองเดิมต้องไม่หาย
 */
export function ChatFilter({
  base,
  active,
  extra = {},
}: {
  base: string;
  active?: ChatFilterKey;
  extra?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const keep = Object.entries(extra).filter(([, v]) => v != null && v !== "") as [string, string][];
  const href = (chat?: string) => {
    const s = new URLSearchParams(chat ? [["chat", chat], ...keep] : keep).toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">การทัก</span>
      <select
        value={active ?? ""}
        onChange={(e) => router.push(href(e.target.value || undefined))}
        className={`w-full max-w-full rounded-full px-3 py-2 text-sm ring-1 sm:w-auto sm:py-1.5 ${
          active ? "bg-brand-blue text-white ring-brand-blue" : "bg-white text-slate-600 ring-slate-200"
        }`}
      >
        <option value="">ทั้งหมด (ช่วงวันที่ = วันแอดครั้งแรก)</option>
        {(Object.keys(CHAT_FILTERS) as ChatFilterKey[]).map((k) => (
          <option key={k} value={k}>
            {CHAT_FILTERS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
