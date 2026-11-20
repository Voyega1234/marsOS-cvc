import Link from "next/link";
import { DATE_RANGES, activeRangeKey, type RangeQuery } from "@/lib/line-tracking/date-range";

/**
 * The date-range chips + custom range picker used on Marketing Funnel, rendered as a
 * shared control so Overview and Leads CRM offer exactly the same choices.
 *
 * `extra` carries any other query params of the host page (e.g. the Leads search box)
 * so switching the date does not silently drop them.
 */
export function DateRangeFilter({
  base,
  query,
  extra = {},
}: {
  base: string;
  query: RangeQuery;
  extra?: Record<string, string | undefined>;
}) {
  const active = activeRangeKey(query);
  const keep = Object.entries(extra).filter(([, v]) => v != null && v !== "") as [string, string][];
  const href = (rangeKey: string) => {
    const qs = new URLSearchParams([["range", rangeKey], ...keep]);
    return `${base}?${qs.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {DATE_RANGES.map((r) => (
        <Link
          key={r.key}
          href={href(r.key)}
          className={`rounded-full px-3 py-2 text-sm sm:py-1.5 ${
            active === r.key ? "bg-brand-blue text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          {r.label}
        </Link>
      ))}
      <form action={base} method="get" className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
        <input type="hidden" name="range" value="custom" />
        {keep.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="date" name="from" defaultValue={query.from} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs sm:flex-none" />
        <span className="text-slate-400">–</span>
        <input type="date" name="to" defaultValue={query.to} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs sm:flex-none" />
        <button
          type="submit"
          className={`rounded-full px-3 py-2 text-sm sm:py-1.5 ${
            active === "custom" ? "bg-brand-blue text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
          }`}
        >
          เลือกช่วง
        </button>
      </form>
    </div>
  );
}
