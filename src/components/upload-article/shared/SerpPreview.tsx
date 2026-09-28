"use client";

/**
 * ตัวอย่างหน้าตาบทความบน Google Search — เขียนแยกเฉพาะ Upload Article
 * (ห้าม import จาก ClientDetailTabs ตาม spec) เลยเขียนใหม่แบบง่าย ๆ ที่นี่
 */
import { useState } from "react";

export default function SerpPreview({
  siteHost,
  title,
  description,
  slug,
}: {
  siteHost: string;
  title: string;
  description: string;
  slug: string;
}) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const cleanHost = (siteHost || "example.com").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const displayTitle = title.trim() || "หัวข้อบทความจะแสดงตรงนี้";
  const displayDesc = description.trim() || "คำอธิบายบทความ (meta description) จะแสดงตรงนี้";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 w-fit">
        {(["mobile", "desktop"] as const).map(d => (
          <button
            key={d}
            type="button"
            onClick={() => setDevice(d)}
            className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors ${
              device === d ? "bg-white shadow-sm text-brand-navy" : "text-gray-500"
            }`}
          >
            {d === "mobile" ? "Mobile" : "Desktop"}
          </button>
        ))}
      </div>
      <div className={`rounded-xl border border-gray-100 bg-white px-4 py-3 ${device === "mobile" ? "max-w-[360px]" : ""}`}>
        <div className="flex items-center gap-1 text-[13px] text-gray-800">
          <span className="truncate">{cleanHost}</span>
          <span className="text-gray-400">›</span>
          <span className="truncate text-gray-400">{slug || "…"}</span>
        </div>
        <div className="text-[18px] leading-snug text-[#1a0dab] mt-0.5 line-clamp-2">{displayTitle}</div>
        <p className="text-[13px] leading-snug text-gray-600 mt-0.5 line-clamp-2">{displayDesc}</p>
      </div>
    </div>
  );
}
