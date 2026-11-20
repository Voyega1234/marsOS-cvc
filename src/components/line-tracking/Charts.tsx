"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";
import { CATEGORICAL, OTHER_COLOR } from "@/components/ui/Widgets";
import { dayLabel } from "@/lib/line-tracking/overview";

export const CHART_COLORS = [...CATEGORICAL, OTHER_COLOR];

export interface Slice {
  name: string;
  value: number;
}

const TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid rgb(0 14 63 / 0.12)", fontSize: 12 };
const CURSOR = { fill: "rgb(0 14 63 / 0.06)" };

/** Colour of slice i: the caller's own colour when given, else the palette in order. */
const sliceColor = (i: number, colors?: string[]) => colors?.[i] ?? CHART_COLORS[Math.min(i, CHART_COLORS.length - 1)];

/**
 * Donut chart with a big number in the middle. `colors` (one per slice, same order as `data`)
 * is for data whose colour belongs to the entity, such as a lead status.
 */
export function DonutChart({
  data,
  centerValue,
  centerLabel,
  colors,
}: {
  data: Slice[];
  centerValue?: string;
  centerLabel?: string;
  colors?: string[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">ยังไม่มีข้อมูล</div>;
  }
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={62}
            outerRadius={92}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={sliceColor(i, colors)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number, n: string) => [`${v} (${((v / total) * 100).toFixed(0)}%)`, n]}
            contentStyle={TOOLTIP_STYLE}
          />
        </PieChart>
      </ResponsiveContainer>
      {centerValue !== undefined && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold tracking-tight text-gray-900">{centerValue}</div>
          {centerLabel && <div className="text-xs text-gray-500">{centerLabel}</div>}
        </div>
      )}
    </div>
  );
}

/** Small legend list to pair with the donut: name, share and value. `colors` as in DonutChart. */
export function ChartLegend({ data, colors, decimals = 0 }: { data: Slice[]; colors?: string[]; decimals?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {data.map((d, i) => (
        <li key={d.name} className="flex items-center gap-2 py-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: sliceColor(i, colors) }}
          />
          <span className="min-w-0 flex-1 truncate text-gray-700" title={d.name}>{d.name}</span>
          <span className="w-14 shrink-0 text-right tabular-nums text-gray-500">{((d.value / total) * 100).toFixed(decimals)}%</span>
          <span className="w-14 shrink-0 text-right font-medium tabular-nums text-gray-900">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bar chart. */
export function BarChartCard({
  data,
  color = "#1d48f3",
}: {
  data: Slice[];
  color?: string;
}) {
  if (!data.some((d) => d.value > 0)) {
    return <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">ยังไม่มีข้อมูล</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[Math.min(i, CHART_COLORS.length - 1)] || color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

type DailyLeadsRow = { day: string; leads: number; purchases: number };

function DailyLeadsTip({ active, payload }: { active?: boolean; payload?: { payload: DailyLeadsRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="px-3 py-2 text-xs shadow-sm" style={{ ...TOOLTIP_STYLE, background: "rgb(var(--surface))" }}>
      <div className="font-semibold text-gray-900">{dayLabel(row.day)}</div>
      <div className="mt-1 flex items-center gap-2 text-gray-700">
        <span className="h-0.5 w-3 rounded-full" style={{ background: CHART_COLORS[0] }} />
        Leads <span className="ml-auto pl-3 font-semibold tabular-nums text-gray-900">{row.leads.toLocaleString()}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-gray-500">
        <span className="w-3" />
        ปิดการขายแล้ว <span className="ml-auto pl-3 font-semibold tabular-nums text-gray-900">{row.purchases.toLocaleString()}</span>
      </div>
    </div>
  );
}

/**
 * Leads per day, one line. One point per calendar day, oldest first; the tooltip also shows how
 * many of that day's leads are closed by now. Needs at least two days: the caller shows a single
 * day as text.
 */
export function DailyLeadsChart({ points }: { points: DailyLeadsRow[] }) {
  if (points.length < 2) {
    return <div className="flex h-[240px] items-center justify-center text-sm text-gray-500">ยังไม่มีข้อมูล</div>;
  }
  // A dot per day while they still fit; a long window is a plain line with a dot on hover.
  const dots = points.length <= 31 ? { r: 3, fill: CHART_COLORS[0], stroke: "#fff", strokeWidth: 2 } : false;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={points} margin={{ top: 8, right: 28, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="lt-daily-leads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.18} />
            <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<DailyLeadsTip />} cursor={{ stroke: "rgb(0 14 63 / 0.25)", strokeWidth: 1 }} />
        <Area
          type="linear"
          dataKey="leads"
          name="Leads"
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          fill="url(#lt-daily-leads)"
          dot={dots}
          activeDot={{ r: 5, fill: CHART_COLORS[0], stroke: "#fff", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
