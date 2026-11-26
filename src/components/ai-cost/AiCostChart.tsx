"use client";

import { useState } from "react";

import { chartColor } from "@/components/ds";
import { AI_COST_MODULES, aiCostModuleByKey } from "@/lib/ai-cost-modules";
import { fmtInt, fmtThb } from "@/lib/ai-cost-format";
import type { DailyPoint } from "@/lib/ai-cost-data";

const colorOf = (key: string) => chartColor(Math.max(0, AI_COST_MODULES.findIndex((m) => m.key === key)));
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** กราฟแท่งรายวัน (CSS ล้วน) — แต่ละแท่งซ้อนสีตามระบบ */
export function AiCostChart({ daily }: { daily: DailyPoint[] }) {
  const [hover, setHover] = useState<DailyPoint | null>(null);
  const max = Math.max(...daily.map((d) => d.cost), 0.000001);
  const used = AI_COST_MODULES.filter((m) => daily.some((d) => (d.byModule[m.key] ?? 0) > 0));
  const shown = hover;

  return (
    <div>
      <div className="mb-2 min-h-[20px] text-xs text-gray-600" aria-live="polite">
        {shown ? (
          <>
            <span className="font-semibold text-brand-navy">{dmy(shown.date)}</span> · {fmtThb(shown.cost)} · {fmtInt(shown.calls)} ครั้ง
          </>
        ) : (
          <span className="text-gray-400">เอาเมาส์ชี้ (หรือแตะ) แท่งเพื่อดูรายวัน</span>
        )}
      </div>
      <div className={`flex h-40 items-end overflow-hidden ${daily.length > 60 ? "gap-0" : "gap-px sm:gap-0.5"}`} role="img" aria-label="ค่าใช้จ่ายรายวัน" onMouseLeave={() => setHover(null)}>
        {daily.map((d) => {
          const h = d.cost > 0 ? Math.max((d.cost / max) * 100, 2) : 0;
          const parts = Object.entries(d.byModule).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
          return (
            <button
              type="button"
              key={d.date}
              title={`${dmy(d.date)} · ${fmtThb(d.cost)} · ${fmtInt(d.calls)} ครั้ง`}
              onMouseEnter={() => setHover(d)}
              onFocus={() => setHover(d)}
              onClick={() => setHover(d)}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <span className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm opacity-90 group-hover:opacity-100" style={{ height: `${h}%` }}>
                {parts.map(([k, v]) => (
                  <span key={k} style={{ height: `${(v / d.cost) * 100}%`, background: colorOf(k) }} />
                ))}
              </span>
              {d.cost === 0 && <span className="h-px w-full" style={{ background: "var(--chart-track)" }} />}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{daily[0] ? dmy(daily[0].date) : ""}</span>
        <span>{daily.length > 2 ? dmy(daily[Math.floor(daily.length / 2)].date) : ""}</span>
        <span>{daily.length > 1 ? dmy(daily[daily.length - 1].date) : ""}</span>
      </div>
      {used.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {used.map((m) => (
            <li key={m.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(m.key) }} aria-hidden />
              {aiCostModuleByKey(m.key).label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
