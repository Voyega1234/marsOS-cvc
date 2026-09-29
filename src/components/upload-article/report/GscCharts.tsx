"use client";

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
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden relative">
            <div className="h-full bg-brand-blue rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          {d.prevValue !== undefined && (
            <div className="h-1.5 bg-gray-50 rounded-full overflow-hidden">
              <div className="h-full bg-gray-300 rounded-full transition-all" style={{ width: `${(d.prevValue / max) * 100}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
