"use client";

import { AreaChart, KpiTile, Panel, Segmented, StackedBar } from "@/components/ds";
import type { GscOverview, PositionBuckets } from "@/lib/upload-article/gsc-report";

/**
 * กราฟของแท็บ Report — SVG มือเขียนล้วน (ไม่มี chart lib ในโปรเจกต์นี้) อ้างอิงแนวทางจาก
 * SKLineChart/SimpleBarChart ใน src/components/report/ClientReportClient.tsx
 */

export interface GscLinePoint {
  date: string;
  value: number;
}

/** เส้นวันต่อวัน: ปัจจุบัน (เส้นทึบ) เทียบกับช่วงก่อนหน้า (เส้นประ) — จับคู่กันตาม index (offset วัน) */
export function GscLineChart({ current, previous, color = "#137333" }: {
  current: GscLinePoint[];
  previous?: GscLinePoint[];
  color?: string;
}) {
  const W = 640; const H = 200; const PL = 44; const PB = 24; const PT = 10;
  const TH = H + PT + PB;

  const vals = current.map((d) => d.value);
  if (vals.length < 2) {
    return (
      <div className="w-full" style={{ height: TH }}>
        <svg viewBox={`0 0 ${W} ${TH}`} className="w-full h-full" preserveAspectRatio="none">
          <line x1={0} y1={PT + H / 2} x2={W} y2={PT + H / 2} stroke="#e8eaed" strokeWidth="1" />
        </svg>
      </div>
    );
  }

  const prevVals = previous?.map((d) => d.value) ?? [];
  const max = Math.max(...vals, ...prevVals, 1);
  const fmtLabel = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K` : String(Math.round(v)));
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: PT + H * (1 - f), label: fmtLabel(max * f) }));

  const toX = (i: number, n: number) => (i / (n - 1)) * W;
  const toY = (v: number) => PT + H * (1 - v / max);
  const mainPath = vals.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i, vals.length).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const fillPath = mainPath + ` L${W},${PT + H} L0,${PT + H} Z`;

  let prevPath = "";
  if (prevVals.length >= 2) {
    prevPath = prevVals.map((v, i) => `${i === 0 ? "M" : "L"}${toX(Math.min(i, vals.length - 1), vals.length).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  }

  const dateLabels = [0, Math.floor((current.length - 1) / 2), current.length - 1].map((i) => {
    const raw = current[i]?.date ?? "";
    const p = raw.split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}` : raw;
  });

  return (
    <div className="w-full flex" style={{ height: TH }}>
      <div className="relative shrink-0" style={{ width: PL - 4 }}>
        {gridLines.map((g, i) => (
          <span key={i} className="absolute right-1.5 text-[10px] leading-none text-gray-500 tabular-nums" style={{ top: g.y - 5 }}>{g.label}</span>
        ))}
      </div>
      <div className="relative flex-1 min-w-0">
        <svg viewBox={`0 0 ${W} ${TH}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="gsc-line-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.15" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridLines.map((g, i) => <line key={i} x1={0} y1={g.y} x2={W} y2={g.y} stroke="#e8eaed" strokeWidth="0.8" />)}
          <path d={fillPath} fill="url(#gsc-line-fill)" />
          {prevPath && <path d={prevPath} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.5" />}
          <path d={mainPath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <line x1={0} y1={PT + H} x2={W} y2={PT + H} stroke="#e8eaed" strokeWidth="0.8" />
        </svg>
        <div className="absolute left-0 right-0 flex justify-between text-[10px] text-gray-500" style={{ top: PT + H + 6 }}>
          {dateLabels.map((d, i) => <span key={i}>{d}</span>)}
        </div>
      </div>
    </div>
  );
}

export interface GscBarDatum {
  label: string;
  value: number;
  prevValue?: number;
}

/** กราฟแท่งแนวนอน — ใช้กับ position bucket (ปัจจุบันเทียบก่อนหน้า) */
export function GscBarChart({ data }: { data: GscBarDatum[] }) {
  const max = Math.max(...data.map((d) => Math.max(d.value, d.prevValue ?? 0)), 1);
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{d.label}</span>
            <span className="font-semibold text-brand-navy">{d.value.toLocaleString()}{d.prevValue !== undefined ? <span className="text-gray-400 font-normal"> (ก่อนหน้า {d.prevValue.toLocaleString()})</span> : null}</span>
          </div>
          <div className="h-2.5 bg-brand-mist rounded-full overflow-hidden relative">
            <div className="h-full bg-brand-blue rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          {d.prevValue !== undefined && (
            <div className="h-1.5 bg-gray-100/70 rounded-full overflow-hidden">
              <div className="h-full bg-gray-300 rounded-full transition-all" style={{ width: `${(d.prevValue / max) * 100}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function fmtNumK(n: number): string { return Math.round(n).toLocaleString(); }
function fmtDm(raw: string): string {
  const p = raw.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : raw;
}

/** แถว KPI 4 ช่อง (คลิก / การแสดงผล / CTR / อันดับเฉลี่ย) พร้อม delta เทียบช่วงก่อนหน้า */
export function GscKpiRow({ overview }: { overview: GscOverview }) {
  const c = overview.current;
  const d = overview.deltaPct;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiTile tone="blue" label="คลิก" value={fmtNumK(c.clicks)} delta={d.clicks} hint="vs ก่อนหน้า" />
      <KpiTile tone="sky" label="การแสดงผล" value={fmtNumK(c.impressions)} delta={d.impressions} hint="vs ก่อนหน้า" />
      <KpiTile tone="mist" label="CTR" value={`${(c.ctr * 100).toFixed(2)}%`} delta={d.ctr} hint="vs ก่อนหน้า" />
      <KpiTile tone="warm" label="อันดับเฉลี่ย" value={c.position ? c.position.toFixed(1) : "—"} delta={d.position} invertDelta hint="vs ก่อนหน้า" />
    </div>
  );
}

/** กราฟรายวัน (ปัจจุบัน + เส้นประช่วงเทียบ) พร้อมสวิตช์ คลิก/การแสดงผล */
export function GscTrendPanel({ current, previous, metric, onMetricChange }: {
  current: GscLinePoint[];
  previous: GscLinePoint[];
  metric: "clicks" | "impressions";
  onMetricChange: (m: "clicks" | "impressions") => void;
}) {
  const name = metric === "clicks" ? "คลิก" : "การแสดงผล";
  return (
    <Panel
      title="แนวโน้มรายวัน"
      actions={
        <Segmented
          size="sm"
          ariaLabel="เลือกตัวชี้วัด"
          value={metric}
          onChange={onMetricChange}
          options={[{ value: "clicks", label: "คลิก" }, { value: "impressions", label: "การแสดงผล" }]}
        />
      }
    >
      <AreaChart
        height={260}
        showLegend
        formatValue={fmtNumK}
        series={[
          { name: `${name} (ช่วงปัจจุบัน)`, points: current.map((d) => ({ label: fmtDm(d.date), value: d.value })) },
          ...(previous.length >= 2
            ? [{ name: `${name} (ช่วงเทียบ)`, dashed: true, fill: false, points: previous.map((d) => ({ label: fmtDm(d.date), value: d.value })) }]
            : []),
        ]}
      />
      <p className="mt-2 text-[11px] text-gray-400">เส้นทึบ = ช่วงปัจจุบัน, เส้นประ = ช่วงเทียบ</p>
    </Panel>
  );
}

/** สัดส่วนอันดับคำค้นหา: แถบรวมคลิกปัจจุบัน + แท่งเทียบก่อนหน้า (ตัวเลขชุดเดิม) */
export function GscBucketPanel({ buckets }: { buckets: PositionBuckets }) {
  return (
    <Panel title="สัดส่วนอันดับคำค้นหา (ปัจจุบันเทียบก่อนหน้า)">
      <div className="space-y-4">
        <StackedBar
          legendColumns={2}
          formatValue={fmtNumK}
          segments={buckets.current.map((b) => ({ label: `อันดับ ${b.bucket} (${b.count} คำ)`, value: b.clicks }))}
        />
        <GscBarChart data={buckets.current.map((b, i) => ({ label: `อันดับ ${b.bucket} (${b.count} คำ)`, value: b.clicks, prevValue: buckets.previous[i]?.clicks ?? 0 }))} />
        <p className="text-[11px] text-gray-400">แถบเข้ม = คลิกช่วงปัจจุบัน, แถบเทา = คลิกช่วงก่อนหน้า</p>
      </div>
    </Panel>
  );
}
