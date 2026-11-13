"use client";

/**
 * กราฟ SVG/CSS ล้วน (ไม่มี chart lib) — ตัวเลขทุกจุดผ่าน safe() กัน NaN/Infinity
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

// สีที่ต้องสลับตามโหมดสว่าง/มืดใช้ตัวแปร CSS (--chart-* ใน globals.css) — โหมดสว่างได้ค่าเดิมทุกตัว
// ลำดับที่ 4 คือ Secure Navy: บนพื้นมืดมองไม่เห็น จึงสลับเป็นฟ้าอ่อนผ่าน --chart-navy
export const CHART_COLORS = ["#1d48f3", "#177cfe", "#6b8cef", "var(--chart-navy)", "#98a3b6", "#ffb95c", "#e35336"] as const;

export function chartColor(i: number): string {
  const n = CHART_COLORS.length;
  return CHART_COLORS[((Math.trunc(i) % n) + n) % n];
}

const GRID = "var(--chart-grid)";
const AXIS = "var(--chart-axis)";
const TRACK = "var(--chart-track)";
const EMERALD = "#10b981";
const AMBER = "#f59e0b";
const RED = "#ef4444";

function safe(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** 1.2K, 3.4M — จำนวนเต็มต่ำกว่า 1000 แสดงตามจริง */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const trim = (x: number) => String(Math.round(x * 10) / 10);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  if (Number.isInteger(n)) return String(n);
  if (abs < 100) return trim(n);
  return String(Math.round(n));
}

/** วัดความกว้างของกล่อง (px) */
function useWidth(ref: RefObject<HTMLElement>, initial = 600): number {
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const cw = el.clientWidth;
      if (cw > 0) setW(cw);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** ปัดค่าสูงสุดขึ้นเป็นเลขกลม */
function niceCeil(max: number): number {
  if (!(max > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / pow;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * pow;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [29, 72, 243];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  // สีที่เป็นตัวแปร CSS แปลงเป็นเลขไม่ได้ — ให้เบราว์เซอร์ผสมความโปร่งเอง
  if (!hex.startsWith("#")) return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function truncate(s: string, max: number): string {
  const arr = Array.from(s);
  return arr.length > max ? `${arr.slice(0, Math.max(1, max - 1)).join("")}…` : s;
}

/* ───────────────────────── ChartLegend ───────────────────────── */

export function ChartLegend({ items, className }: {
  items: { label: string; color: string; value?: ReactNode }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600", className)}>
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: it.color }} />
          <span>{it.label}</span>
          {it.value !== undefined ? <span className="font-semibold tabular-nums text-brand-navy">{it.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────── AreaChart ───────────────────────── */

export interface AreaSeries {
  name: string;
  color?: string;
  dashed?: boolean;
  fill?: boolean;
  points: { label: string; value: number | null }[];
}

export function AreaChart({ series, height = 240, formatValue = formatCompact, yTickCount = 4, showLegend = false, invertY = false, className, ariaLabel }: {
  series: AreaSeries[];
  height?: number;
  formatValue?: (n: number) => string;
  yTickCount?: number;
  showLegend?: boolean;
  invertY?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState<number | null>(null);

  const n = series.reduce((m, s) => Math.max(m, s.points.length), 0);
  const main = series[0];
  const cols = series.map((s, i) => s.color ?? chartColor(i));

  const all: number[] = [];
  series.forEach((s) => s.points.forEach((p) => { if (p.value !== null && Number.isFinite(p.value)) all.push(p.value); }));

  const legend = showLegend ? (
    <ChartLegend className="mt-2" items={series.map((s, i) => ({ label: s.name, color: cols[i] }))} />
  ) : null;

  if (!main || n < 2 || all.length === 0) {
    return (
      <div className={cn("w-full", className)}>
        <div
          ref={wrapRef}
          role="img"
          aria-label={ariaLabel}
          className="flex w-full items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-400"
          style={{ height }}
        >
          ยังไม่มีข้อมูล
        </div>
        {legend}
      </div>
    );
  }

  // สเกลแกน Y
  const dMin = Math.min(...all);
  const dMax = Math.max(...all);
  const ticksN = Math.max(1, Math.floor(yTickCount));
  let lo: number;
  let hi: number;
  if (invertY) {
    const span = dMax - dMin || Math.max(Math.abs(dMax), 1);
    lo = dMin - span * 0.1;
    hi = dMax + span * 0.1;
    if (dMin >= 0 && lo < 0) lo = 0;
  } else {
    lo = dMin < 0 ? dMin : 0;
    hi = niceCeil(dMax);
    if (hi <= lo) hi = lo + 1;
  }
  const range = hi - lo || 1;
  const ticks = Array.from({ length: ticksN + 1 }, (_, i) => lo + (range * i) / ticksN);

  const PT = 10, PB = 26, PR = 12;
  const maxLabel = Math.max(...ticks.map((t) => formatValue(t).length));
  const PL = Math.max(30, maxLabel * 6.2 + 12);
  const plotW = Math.max(10, width - PL - PR);
  const plotH = Math.max(10, height - PT - PB);
  const base = PT + plotH;

  const xAt = (i: number) => PL + (i / (n - 1)) * plotW;
  const yAt = (v: number) => {
    const t = (v - lo) / range;
    return invertY ? PT + t * plotH : PT + (1 - t) * plotH;
  };
  const f1 = (x: number) => x.toFixed(1);

  // แยกเส้นเป็นช่วง ๆ ตามค่า null
  const runsOf = (s: AreaSeries): { x: number; y: number }[][] => {
    const runs: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    s.points.forEach((p, i) => {
      if (p.value === null || !Number.isFinite(p.value)) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push({ x: xAt(i), y: yAt(p.value) });
    });
    if (cur.length) runs.push(cur);
    return runs;
  };
  const linePath = (run: { x: number; y: number }[]) => {
    let d = `M${f1(run[0].x)},${f1(run[0].y)}`;
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i];
      const mx = (a.x + b.x) / 2;
      d += ` C${f1(mx)},${f1(a.y)} ${f1(mx)},${f1(b.y)} ${f1(b.x)},${f1(b.y)}`;
    }
    return d;
  };

  // ป้ายแกน X: ไม่เกิน 6 และห่างกันอย่างน้อย ~72px
  const labelCount = Math.max(2, Math.min(6, Math.floor(plotW / 72), n));
  const labelIdx = Array.from(new Set(Array.from({ length: labelCount }, (_, i) => Math.round((i * (n - 1)) / (labelCount - 1)))));
  const labelOf = (i: number) => main.points[i]?.label ?? series.find((s) => s.points[i])?.points[i]?.label ?? "";

  const onMove = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left - PL;
    const idx = Math.round((px / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  const hx = hover === null ? 0 : xAt(hover);
  const tipW = 176;
  const tipLeft = hover === null ? 0 : Math.max(0, Math.min(width - tipW, hx + 12 + tipW > width ? hx - 12 - tipW : hx + 12));

  return (
    <div className={cn("w-full", className)}>
      <div ref={wrapRef} className="relative w-full min-w-0 overflow-hidden" style={{ height }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          className="block touch-pan-y select-none tabular-nums"
          onPointerMove={(e) => onMove(e.clientX, e.currentTarget)}
          onPointerDown={(e) => onMove(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cols[0]} stopOpacity="0.28" />
              <stop offset="100%" stopColor={cols[0]} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PL} x2={PL + plotW} y1={yAt(t)} y2={yAt(t)} stroke={GRID} strokeDasharray="3 5" />
              <text x={PL - 8} y={yAt(t) + 3.5} textAnchor="end" fontSize="10.5" fill={AXIS}>{formatValue(t)}</text>
            </g>
          ))}
          {labelIdx.map((i, k) => (
            <text
              key={i}
              x={xAt(i)}
              y={height - 7}
              fontSize="10.5"
              fill={AXIS}
              textAnchor={k === 0 ? "start" : k === labelIdx.length - 1 ? "end" : "middle"}
            >
              {labelOf(i)}
            </text>
          ))}
          {/* พื้นใต้เส้นหลัก */}
          {main.fill !== false
            ? runsOf(main).filter((r) => r.length >= 2).map((r, i) => (
                <path key={i} d={`${linePath(r)} L${f1(r[r.length - 1].x)},${f1(base)} L${f1(r[0].x)},${f1(base)} Z`} fill={`url(#${uid}-fill)`} />
              ))
            : null}
          {/* เส้นรอง (วาดก่อนเส้นหลักให้เส้นหลักอยู่บนสุด) */}
          {Array.from(series.keys()).reverse().map((si) => {
            const s = series[si];
            return runsOf(s).map((r, ri) =>
              r.length >= 2 ? (
                <path
                  key={`${si}-${ri}`}
                  d={linePath(r)}
                  fill="none"
                  stroke={cols[si]}
                  strokeWidth={si === 0 ? 2.25 : 1.75}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <circle key={`${si}-${ri}`} cx={r[0].x} cy={r[0].y} r={2.5} fill={cols[si]} />
              ),
            );
          })}
          {hover !== null ? (
            <g>
              <line x1={hx} x2={hx} y1={PT} y2={base} stroke="var(--chart-cursor)" strokeWidth="1" />
              {series.map((s, si) => {
                const v = s.points[hover]?.value;
                if (v === null || v === undefined || !Number.isFinite(v)) return null;
                return <circle key={si} cx={hx} cy={yAt(v)} r={4} fill="var(--chart-surface)" stroke={cols[si]} strokeWidth="2" />;
              })}
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: tipLeft, width: tipW }}
          >
            <div className="mb-1 font-semibold text-brand-navy">{labelOf(hover)}</div>
            {series.map((s, si) => {
              const v = s.points[hover]?.value;
              return (
                <div key={si} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="flex min-w-0 items-center gap-1.5 text-gray-600">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cols[si] }} />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-brand-navy">
                    {v === null || v === undefined || !Number.isFinite(v) ? "–" : formatValue(v)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {legend}
    </div>
  );
}

/* ───────────────────────── BarChart ───────────────────────── */

export interface BarDatum { label: string; value: number; color?: string; hint?: string }

export function BarChart({ data, height = 220, formatValue = formatCompact, color = CHART_COLORS[0], highlightIndex, horizontal = false, showValues = false, maxBars, className, ariaLabel }: {
  data: BarDatum[];
  height?: number;
  formatValue?: (n: number) => string;
  color?: string;
  highlightIndex?: number;
  horizontal?: boolean;
  showValues?: boolean;
  maxBars?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState<number | null>(null);
  const rows = typeof maxBars === "number" && maxBars > 0 ? data.slice(0, maxBars) : data;
  const max = Math.max(0, ...rows.map((d) => safe(d.value)));

  if (rows.length === 0) {
    return (
      <div ref={wrapRef} role="img" aria-label={ariaLabel} className={cn("flex w-full items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-400", className)} style={{ height }}>
        ยังไม่มีข้อมูล
      </div>
    );
  }

  if (horizontal) {
    return (
      <div ref={wrapRef} role="img" aria-label={ariaLabel} className={cn("flex w-full flex-col gap-2.5 tabular-nums", className)}>
        {rows.map((d, i) => {
          const pct = max > 0 ? Math.max(0, Math.min(100, (safe(d.value) / max) * 100)) : 0;
          const c = d.color ?? color;
          const dim = highlightIndex !== undefined && highlightIndex !== i;
          return (
            <div key={`${d.label}-${i}`} className="flex items-center gap-3" title={d.hint ?? `${d.label}: ${formatValue(safe(d.value))}`}>
              <div className="w-28 shrink-0 truncate text-xs text-gray-600 sm:w-44" title={d.label}>{d.label}</div>
              <div className="h-2.5 min-w-0 flex-1 rounded-full bg-gray-100">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: dim ? rgba(c, 0.35) : c }} />
              </div>
              <div className="w-14 shrink-0 text-right text-xs font-semibold text-brand-navy">{formatValue(safe(d.value))}</div>
            </div>
          );
        })}
      </div>
    );
  }

  const hi = niceCeil(max);
  const ticksN = 4;
  const ticks = Array.from({ length: ticksN + 1 }, (_, i) => (hi * i) / ticksN);
  const PT = showValues ? 18 : 10, PB = 26, PR = 8;
  const PL = Math.max(28, Math.max(...ticks.map((t) => formatValue(t).length)) * 6.2 + 12);
  const plotW = Math.max(10, width - PL - PR);
  const plotH = Math.max(10, height - PT - PB);
  const slot = plotW / rows.length;
  const bw = Math.max(2, Math.min(44, slot * 0.62));
  const yAt = (v: number) => PT + (1 - safe(v) / hi) * plotH;
  const base = PT + plotH;
  const maxChars = Math.max(2, Math.floor(slot / 6.5));
  const every = slot < 28 ? Math.ceil(28 / slot) : 1;

  // แท่งมุมบนมน (เหลี่ยมล่าง)
  const barPath = (x: number, y: number, w: number, h: number) => {
    const r = Math.min(8, w / 2, h);
    if (h <= 0) return "";
    return `M${x.toFixed(1)},${(y + h).toFixed(1)} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + w - r).toFixed(1)} Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)} V${(y + h).toFixed(1)} Z`;
  };

  const hx = hover === null ? 0 : PL + slot * hover + slot / 2;
  const tipW = 150;
  const tipLeft = Math.max(0, Math.min(width - tipW, hx + 10 + tipW > width ? hx - 10 - tipW : hx + 10));

  return (
    <div ref={wrapRef} className={cn("relative w-full min-w-0 overflow-hidden", className)} style={{ height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="block touch-pan-y select-none tabular-nums"
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={PL + plotW} y1={yAt(t)} y2={yAt(t)} stroke={GRID} strokeDasharray="3 5" />
            <text x={PL - 8} y={yAt(t) + 3.5} textAnchor="end" fontSize="10.5" fill={AXIS}>{formatValue(t)}</text>
          </g>
        ))}
        {rows.map((d, i) => {
          const cx = PL + slot * i + slot / 2;
          const y = yAt(d.value);
          const c = d.color ?? color;
          const dim = highlightIndex !== undefined && highlightIndex !== i;
          return (
            <g key={`${d.label}-${i}`} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect x={PL + slot * i} y={PT} width={slot} height={plotH} fill="transparent" />
              <path d={barPath(cx - bw / 2, y, bw, base - y)} fill={dim ? rgba(c, 0.35) : c} />
              {showValues ? (
                <text x={cx} y={y - 5} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--chart-ink)">{formatValue(safe(d.value))}</text>
              ) : null}
              {i % every === 0 ? (
                <text x={cx} y={height - 8} textAnchor="middle" fontSize="10.5" fill={AXIS}>
                  <title>{d.label}</title>
                  {truncate(d.label, maxChars)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] ? (
        <div className="pointer-events-none absolute top-1 z-10 rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs shadow-lg" style={{ left: tipLeft, width: tipW }}>
          <div className="truncate font-semibold text-brand-navy">{rows[hover].label}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-gray-600">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: rows[hover].color ?? color }} />
            <span className="font-semibold tabular-nums text-brand-navy">{formatValue(safe(rows[hover].value))}</span>
          </div>
          {rows[hover].hint ? <div className="mt-0.5 text-gray-500">{rows[hover].hint}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── DonutChart ───────────────────────── */

export interface Segment { label: string; value: number; color?: string }

export function DonutChart({ segments, size = 180, thickness = 22, centerValue, centerLabel, showLegend = true, formatValue = formatCompact, className, ariaLabel }: {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerValue?: ReactNode;
  centerLabel?: ReactNode;
  showLegend?: boolean;
  formatValue?: (n: number) => string;
  className?: string;
  ariaLabel?: string;
}) {
  const segs = segments.map((s, i) => ({ ...s, value: Math.max(0, safe(s.value)), color: s.color ?? chartColor(i) }));
  const total = segs.reduce((a, s) => a + s.value, 0);
  const r = Math.max(1, (size - thickness) / 2);
  const C = 2 * Math.PI * r;
  const visible = segs.filter((s) => s.value > 0).length;
  let acc = 0;
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-5 sm:justify-start", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} className="block -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TRACK} strokeWidth={thickness} />
          {total > 0
            ? segs.map((s, i) => {
                if (s.value <= 0) return null;
                const len = (s.value / total) * C;
                const gap = visible > 1 && len > 5 ? 3 : 0;
                const off = acc;
                acc += len;
                return (
                  <circle
                    key={i}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={thickness}
                    strokeDasharray={`${Math.max(0, len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}`}
                    strokeDashoffset={(-off).toFixed(2)}
                  />
                );
              })
            : null}
        </svg>
        {centerValue !== undefined || centerLabel !== undefined ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center tabular-nums">
            {centerValue !== undefined ? <div className="text-2xl font-semibold leading-none text-brand-navy">{centerValue}</div> : null}
            {centerLabel !== undefined ? <div className="mt-1 text-xs text-gray-500">{centerLabel}</div> : null}
          </div>
        ) : null}
      </div>
      {showLegend ? (
        <ul className="min-w-[160px] flex-1 space-y-2 text-sm">
          {segs.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="min-w-0 flex-1 truncate text-gray-600" title={s.label}>{s.label}</span>
              <span className="font-semibold tabular-nums text-brand-navy">{formatValue(s.value)}</span>
              <span className="w-12 text-right text-xs tabular-nums text-gray-500">{total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : "0%"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Gauge ───────────────────────── */

export function Gauge({ value, max = 100, label, caption, size = 200, color, thresholds, higherIsBetter = true, formatValue, className, ariaLabel }: {
  value: number;
  max?: number;
  label?: ReactNode;
  caption?: ReactNode;
  size?: number;
  color?: string;
  thresholds?: { warn: number; bad: number };
  higherIsBetter?: boolean;
  formatValue?: (n: number) => string;
  className?: string;
  ariaLabel?: string;
}) {
  const v = safe(value);
  const m = max > 0 && Number.isFinite(max) ? max : 100;
  const frac = Math.max(0, Math.min(1, v / m));
  const stroke = Math.max(8, Math.round(size * 0.1));
  const r = size / 2 - stroke / 2 - 1;
  const cx = size / 2, cy = size / 2;
  const h = size / 2 + stroke / 2 + 2;
  const pt = (t: number) => {
    const th = Math.PI - t * Math.PI;
    return `${(cx + r * Math.cos(th)).toFixed(2)},${(cy - r * Math.sin(th)).toFixed(2)}`;
  };
  let col = color ?? CHART_COLORS[0];
  if (thresholds) {
    if (higherIsBetter) col = v >= thresholds.warn ? EMERALD : v >= thresholds.bad ? AMBER : RED;
    else col = v <= thresholds.warn ? EMERALD : v <= thresholds.bad ? AMBER : RED;
  }
  const fmt = formatValue ?? formatCompact;
  return (
    <div className={cn("relative mx-auto max-w-full", className)} style={{ width: size, height: h }}>
      <svg width="100%" viewBox={`0 0 ${size} ${h}`} role="img" aria-label={ariaLabel} className="block">
        <path d={`M${pt(0)} A${r},${r} 0 0 1 ${pt(1)}`} fill="none" stroke={TRACK} strokeWidth={stroke} strokeLinecap="round" />
        {frac > 0 ? (
          <path d={`M${pt(0)} A${r},${r} 0 0 1 ${pt(frac)}`} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round" />
        ) : null}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center tabular-nums">
        <div className="font-semibold leading-none text-brand-navy" style={{ fontSize: Math.round(size * 0.2) }}>{fmt(v)}</div>
        {label ? <div className="mt-1 text-xs font-medium text-gray-600">{label}</div> : null}
        {caption ? <div className="text-[11px] text-gray-500">{caption}</div> : null}
      </div>
    </div>
  );
}

/* ───────────────────────── StackedBar ───────────────────────── */

export function StackedBar({ segments, height = 14, showLegend = true, legendColumns = 1, formatValue = formatCompact, className, ariaLabel }: {
  segments: Segment[];
  height?: number;
  showLegend?: boolean;
  legendColumns?: 1 | 2;
  formatValue?: (n: number) => string;
  className?: string;
  ariaLabel?: string;
}) {
  const segs = segments.map((s, i) => ({ ...s, value: Math.max(0, safe(s.value)), color: s.color ?? chartColor(i) }));
  const total = segs.reduce((a, s) => a + s.value, 0);
  return (
    <div className={cn("w-full", className)}>
      <div role="img" aria-label={ariaLabel} className="flex w-full gap-0.5 overflow-hidden rounded-full bg-gray-200/80" style={{ height }}>
        {total > 0
          ? segs.filter((s) => s.value > 0).map((s, i) => (
              <div key={i} title={`${s.label}: ${formatValue(s.value)}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} />
            ))
          : null}
      </div>
      {showLegend ? (
        <ul className={cn("mt-3 grid gap-x-6 gap-y-2 text-sm tabular-nums", legendColumns === 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
          {segs.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="min-w-0 flex-1 truncate text-gray-600" title={s.label}>{s.label}</span>
              <span className="font-semibold text-brand-navy">{formatValue(s.value)}</span>
              <span className="w-12 text-right text-xs text-gray-500">{total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : "0%"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ───────────────────────── MeterBar ───────────────────────── */

const METER_FILL = {
  blue: "bg-brand-blue",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  navy: "bg-brand-navy",
} as const;

export function MeterBar({ value, max = 100, mark, tone = "blue", showValue = false, formatValue = formatCompact, className, ariaLabel }: {
  value: number;
  max?: number;
  mark?: number;
  tone?: "blue" | "ok" | "warn" | "bad" | "navy";
  showValue?: boolean;
  formatValue?: (n: number) => string;
  className?: string;
  ariaLabel?: string;
}) {
  const m = max > 0 && Number.isFinite(max) ? max : 100;
  const pct = Math.max(0, Math.min(100, (safe(value) / m) * 100));
  const markPct = mark === undefined ? null : Math.max(0, Math.min(100, (safe(mark) / m) * 100));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="meter min-w-0 flex-1" role="img" aria-label={ariaLabel}>
        <div className={cn("meter-fill", METER_FILL[tone])} style={{ width: `${pct}%` }} />
        {markPct !== null ? <div className="meter-mark" style={{ left: `calc(${markPct}% - 1px)` }} /> : null}
      </div>
      {showValue ? <span className="shrink-0 text-xs font-semibold tabular-nums text-brand-navy">{formatValue(safe(value))}</span> : null}
    </div>
  );
}

/* ───────────────────────── HeatGrid ───────────────────────── */

export function HeatGrid({ rows, columns, values, formatValue = formatCompact, color = "#1d48f3", onCellClick, className, ariaLabel }: {
  rows: string[];
  columns: string[];
  values: (number | null)[][];
  formatValue?: (n: number) => string;
  color?: string;
  onCellClick?: (row: number, col: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const flat: number[] = [];
  values.forEach((r) => r.forEach((v) => { if (v !== null && Number.isFinite(v)) flat.push(v); }));
  const lo = flat.length ? Math.min(...flat) : 0;
  const hi = flat.length ? Math.max(...flat) : 0;
  const span = hi - lo;
  const alphaOf = (v: number) => 0.06 + 0.84 * (span > 0 ? (v - lo) / span : v > 0 ? 1 : 0);
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="grid gap-1 tabular-nums"
        style={{ gridTemplateColumns: `minmax(64px,auto) repeat(${Math.max(1, columns.length)}, minmax(40px,1fr))`, minWidth: 64 + columns.length * 44 }}
      >
        <div />
        {columns.map((c, i) => (
          <div key={i} className="truncate pb-1 text-center text-[11px] text-gray-500" title={c}>{c}</div>
        ))}
        {rows.map((rl, ri) => (
          <HeatRow key={ri} label={rl} ri={ri} columns={columns} values={values[ri] ?? []} alphaOf={alphaOf} color={color} formatValue={formatValue} onCellClick={onCellClick} />
        ))}
      </div>
    </div>
  );
}

function HeatRow({ label, ri, columns, values, alphaOf, color, formatValue, onCellClick }: {
  label: string;
  ri: number;
  columns: string[];
  values: (number | null)[];
  alphaOf: (v: number) => number;
  color: string;
  formatValue: (n: number) => string;
  onCellClick?: (row: number, col: number) => void;
}) {
  return (
    <>
      <div className="flex items-center truncate pr-2 text-xs text-gray-600" title={label}>{label}</div>
      {columns.map((c, ci) => {
        const v = values[ci];
        const has = v !== null && v !== undefined && Number.isFinite(v);
        const a = has ? alphaOf(v) : 0;
        const style = has ? { backgroundColor: rgba(color, a) } : undefined;
        const cls = cn(
          "flex h-9 items-center justify-center rounded-lg text-[11px] font-medium",
          has ? (a > 0.5 ? "text-white" : "text-brand-navy") : "bg-gray-100 text-gray-400",
          onCellClick && "cursor-pointer transition hover:ring-2 hover:ring-brand-blue/40",
        );
        const text = has ? formatValue(v) : "–";
        const title = `${label} · ${c}: ${text}`;
        return onCellClick ? (
          <button key={ci} type="button" title={title} style={style} className={cls} onClick={() => onCellClick(ri, ci)}>{text}</button>
        ) : (
          <div key={ci} title={title} style={style} className={cls}>{text}</div>
        );
      })}
    </>
  );
}

/* ───────────────────────── Sparkline ───────────────────────── */

export function Sparkline({ values, color = CHART_COLORS[0], width = 96, height = 28, fill = true, ariaLabel }: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  ariaLabel?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const vs = values.filter((v) => Number.isFinite(v));
  const pad = 2;
  if (vs.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="block">
        <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke={GRID} strokeDasharray="3 3" />
      </svg>
    );
  }
  const mn = Math.min(...vs), mx = Math.max(...vs);
  const rg = mx - mn || 1;
  const pts = vs.map((v, i) => [pad + (i / (vs.length - 1)) * (width - pad * 2), pad + (1 - (v - mn) / rg) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="block">
      <defs>
        <linearGradient id={`${uid}-sp`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <path d={`${d} L${(width - pad).toFixed(1)},${height} L${pad},${height} Z`} fill={`url(#${uid}-sp)`} /> : null}
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
