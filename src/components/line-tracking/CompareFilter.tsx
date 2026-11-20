import Link from "next/link";
import type { ReactNode } from "react";
import { COMPARE_MODES, delta, windowLabel, type CompareInfo, type CompareQuery } from "@/lib/line-tracking/compare";

/**
 * "เทียบกับ" row: which period the page's own date range is compared with.
 * Sits under the date-range chips on Overview, Leads CRM and Marketing Funnel.
 *
 * The page's date range (range / from / to) is read from `query` and kept in every link.
 * `extra` carries the host page's other parameters (search, channel, status...).
 */
export function CompareFilter({
  base,
  query,
  info,
  extra = {},
}: {
  base: string;
  query: CompareQuery;
  info: CompareInfo;
  extra?: Record<string, string | undefined>;
}) {
  const keep = Object.entries({ range: query.range, from: query.from, to: query.to, ...extra }).filter(
    ([, v]) => v != null && v !== "",
  ) as [string, string][];
  const href = (mode: string) => `${base}?${new URLSearchParams([...keep, ["cmp", mode]]).toString()}`;
  const chip = (on: boolean) =>
    `rounded-full px-3 py-2 text-sm sm:py-1.5 ${
      on ? "bg-brand-blue text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">เทียบกับ</span>
      {COMPARE_MODES.map((m) => (
        <Link key={m.key} href={href(m.key)} className={chip(info.mode === m.key)}>
          {m.label}
        </Link>
      ))}
      <form action={base} method="get" className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
        {keep.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="cmp" value="custom" />
        <input
          type="date"
          name="cfrom"
          aria-label="วันเริ่มของช่วงที่จะเทียบ"
          defaultValue={query.cfrom}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs sm:flex-none"
        />
        <span className="text-slate-400">–</span>
        <input
          type="date"
          name="cto"
          aria-label="วันสิ้นสุดของช่วงที่จะเทียบ"
          defaultValue={query.cto}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs sm:flex-none"
        />
        <button type="submit" className={chip(info.mode === "custom")}>
          เลือกช่วงเทียบ
        </button>
      </form>
      {info.window && <span className="text-xs text-slate-500">ช่วงที่เทียบ: {windowLabel(info.window)}</span>}
      {info.hint && <span className="text-xs text-amber-600">{info.hint}</span>}
      {info.window && (
        <span className="w-full text-[11px] text-slate-400">
          ทั้งสองช่วงนับ lead ตามวันที่แอด LINE และใช้สถานะล่าสุดของ lead — ช่วงที่เก่ากว่ามีเวลาปิดการขายนานกว่า
        </span>
      )}
    </div>
  );
}

/** ▲ 12% / ▼ 8% / → 0% against the comparison period. Green = better. */
export function DeltaBadge({
  cur,
  prev,
  lowerIsBetter = false,
  className = "text-xs font-semibold",
}: {
  cur: number;
  prev: number;
  /** For counts where a rise is bad news (blocked). */
  lowerIsBetter?: boolean;
  className?: string;
}) {
  const d = delta(cur, prev);
  const good = lowerIsBetter ? d.dir === "down" : d.dir === "up";
  const tone = d.dir === "flat" ? "text-slate-400" : good ? "text-emerald-600" : "text-rose-500";
  return <span className={`${className} ${tone}`}>{d.text}</span>;
}

/** One number of the current period with the comparison period under it. */
export function CompareTile({
  label,
  value,
  cur,
  prev,
  prevLabel,
  prevValue,
}: {
  label: string;
  value: ReactNode;
  cur: number;
  /** Null: no comparison period. */
  prev: number | null;
  prevLabel: string;
  prevValue?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-white p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="break-words text-xl font-bold text-slate-800 sm:text-2xl">{value}</span>
        {prev !== null && <DeltaBadge cur={cur} prev={prev} />}
      </div>
      <div className="text-[11px] text-slate-400">
        {prev !== null ? (
          <>
            {prevLabel}: {prevValue ?? prev.toLocaleString()}
          </>
        ) : (
          prevLabel
        )}
      </div>
    </div>
  );
}
