import Link from "next/link";
import { ALL_CHANNELS, activeChannelKey, type ChannelQuery } from "@/lib/line-tracking/services/channelService";
import type { ChannelOption } from "@/lib/line-tracking/services/leadService";

/**
 * ชิปกรอง "ราย channel" — ชุดควบคุมกลางของระบบ ใช้ได้ทุกโปรเจกต์/ทุกลูกค้า
 * คู่กับ DateRangeFilter: หน้าตาเดียวกัน กติกาเดียวกัน
 *
 * ตัวเลือกมาจากข้อมูลจริงของโปรเจกต์นั้น (listLeadChannels) ไม่ได้ hardcode —
 * ลูกค้าที่ยิงแต่ Paid Search จะไม่เห็นชิปว่าง ๆ ของช่องทางที่ไม่เคยมี lead
 *
 * `extra` พาพารามิเตอร์อื่นของหน้า (คำค้น, ช่วงวันที่) ไปด้วย กดสลับ channel แล้ว
 * ตัวกรองที่ตั้งไว้ต้องไม่หายไปเงียบ ๆ
 */
export function ChannelFilter({
  base,
  query,
  options,
  total,
  extra = {},
}: {
  base: string;
  query: ChannelQuery;
  options: ChannelOption[];
  total: number;
  extra?: Record<string, string | undefined>;
}) {
  const active = activeChannelKey(query);
  const keep = Object.entries(extra).filter(([, v]) => v != null && v !== "") as [string, string][];
  const href = (key: string) => {
    const qs = new URLSearchParams(key === ALL_CHANNELS ? keep : [["channel", key], ...keep]);
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  };

  // มี channel เดียวก็ไม่ต้องมีตัวกรองให้รก — กดยังไงผลก็เท่าเดิม
  if (options.length < 2) return null;

  const chip = (key: string, label: string, count: number) => (
    <Link
      key={key}
      href={href(key)}
      title={key === ALL_CHANNELS ? "ทุกช่องทาง" : key}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-2 text-sm sm:py-1.5 ${
        active === key
          ? "bg-brand-blue text-white"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-xs tabular-nums ${
          active === key ? "bg-white/20" : "bg-slate-100 text-slate-500"
        }`}
      >
        {count}
      </span>
    </Link>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-400">Channel</span>
      {chip(ALL_CHANNELS, "ทุกช่องทาง", total)}
      {options.map((o) => chip(o.key, o.label, o.count))}
    </div>
  );
}
