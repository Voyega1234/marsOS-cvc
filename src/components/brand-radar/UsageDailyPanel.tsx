"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { BarChart, Segmented } from "@/components/ds";
import { USAGE_RANGE_MAX_DAYS, costPerCall, parseUsageRange, type UsageDTO, type UsageDailyDTO } from "@/lib/brand-radar/types";
import { ColumnHelp } from "./ColumnHelp";
import { api, dayLabelTh, fmtNum, fmtUsd, fmtUsdPerCall } from "./shared";

type Preset = "7" | "30" | "90" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
  { value: "custom", label: "กำหนดเอง" },
];

const DAY_MS = 86_400_000;
const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

const dateInputCls =
  "h-9 min-w-0 flex-1 rounded-xl border border-input bg-white/90 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Per-day usage table + chart in the Settings usage summary. Opens on the last 30 days that came with /usage;
 * another preset or a custom range is fetched from /usage/daily. `initial` is oldest first and ends today (Bangkok).
 */
export function UsageDailyPanel({ projectId, initial }: { projectId: string; initial: UsageDTO["daily"] }) {
  const today = initial.length > 0 ? initial[initial.length - 1].day : "";
  const [preset, setPreset] = useState<Preset>("30");
  const [from, setFrom] = useState(initial[0]?.day ?? "");
  const [to, setTo] = useState(today);
  const [daily, setDaily] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqRef = useRef(0);

  // new project or a reload of the usage summary: back to the default 30 days
  useEffect(() => {
    reqRef.current += 1;
    setPreset("30");
    setFrom(initial[0]?.day ?? "");
    setTo(initial.length > 0 ? initial[initial.length - 1].day : "");
    setDaily(initial);
    setLoading(false);
    setError("");
  }, [projectId, initial]);

  const load = async (f: string, t: string) => {
    const range = parseUsageRange(f, t, today);
    if ("error" in range) {
      reqRef.current += 1;
      setLoading(false);
      setError(range.error === "from is after to" ? "วันเริ่มต้องไม่หลังวันสิ้นสุด" : `เลือกได้สูงสุด ${USAGE_RANGE_MAX_DAYS} วัน และไม่เกินวันนี้`);
      return;
    }
    const reqId = ++reqRef.current;
    setLoading(true);
    setError("");
    const res = await api<UsageDailyDTO>(
      `/api/brand-radar/usage/daily?projectId=${encodeURIComponent(projectId)}&from=${range.from}&to=${range.to}`,
    );
    if (reqId !== reqRef.current) return;
    setLoading(false);
    if (!res.ok) { setError(res.data.error || "โหลดข้อมูลไม่สำเร็จ"); return; }
    setDaily((res.data as UsageDailyDTO).daily ?? []);
  };

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p === "custom") return; // keep the current range in the date boxes until one is changed
    const f = shiftDay(today, -(Number(p) - 1));
    setFrom(f);
    setTo(today);
    if (p === "30") { reqRef.current += 1; setLoading(false); setError(""); setDaily(initial); return; }
    void load(f, today);
  };

  const changeDate = (which: "from" | "to", v: string) => {
    const f = which === "from" ? v : from;
    const t = which === "to" ? v : to;
    if (which === "from") setFrom(v); else setTo(v);
    if (f && t) void load(f, t);
  };

  const shown = daily;
  const first = shown[0]?.day ?? from;
  const last = shown[shown.length - 1]?.day ?? to;
  // add the (Buddhist, 2-digit) year to day labels when the range crosses a year
  const crossYear = first.slice(0, 4) !== last.slice(0, 4);
  const dayLabel = (d: string) => (crossYear ? `${dayLabelTh(d)} ${String((Number(d.slice(0, 4)) + 543) % 100).padStart(2, "0")}` : dayLabelTh(d));
  const title = preset === "custom" ? `${dayLabel(first)} – ${dayLabel(last)}` : `${shown.length} วันล่าสุด`;

  // newest first, only the days something was asked or charged
  const rows = useMemo(() => [...shown].reverse().filter((d) => d.calls > 0 || d.costUsd > 0), [shown]);
  const total = useMemo(
    () => shown.reduce((s, d) => ({ costUsd: s.costUsd + d.costUsd, calls: s.calls + d.calls, failed: s.failed + d.failed }), { costUsd: 0, calls: 0, failed: 0 }),
    [shown],
  );

  if (!today) return null;

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-600">
        <span className="min-w-0 flex-1">รายวัน {title} (USD)</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" aria-label="กำลังโหลด" />}
      </div>
      <Segmented<Preset> size="sm" ariaLabel="ช่วงเวลาค่าใช้จ่ายรายวัน" value={preset} onChange={choosePreset} options={PRESETS} />
      {preset === "custom" && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="date"
            aria-label="ตั้งแต่วันที่"
            className={dateInputCls}
            value={from}
            min={shiftDay(today, -(USAGE_RANGE_MAX_DAYS - 1))}
            max={today}
            onChange={(e) => changeDate("from", e.target.value)}
          />
          <span className="text-xs text-gray-400">ถึง</span>
          <input
            type="date"
            aria-label="ถึงวันที่"
            className={dateInputCls}
            value={to}
            min={from || undefined}
            max={today}
            onChange={(e) => changeDate("to", e.target.value)}
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-2 text-xs text-gray-500">
        รวม <span className="font-medium text-gray-700 tabular-nums">{fmtUsd(total.costUsd)}</span>
        {" · "}<span className="tabular-nums">{fmtNum(total.calls)}</span> ครั้ง
        {" · "}ต่อครั้ง <span className="tabular-nums">{fmtUsdPerCall(costPerCall(total.costUsd, total.calls, total.failed))}</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">ไม่มีการใช้งานในช่วงนี้</p>
      ) : (
        <div className="mt-1 max-h-64 overflow-y-auto pr-1">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="py-1 pr-1 font-medium"><ColumnHelp k="usageDay" align="start">วัน</ColumnHelp></th>
                <th className="py-1 pr-1 text-right font-medium"><ColumnHelp k="usageCalls" align="end">ครั้ง</ColumnHelp></th>
                <th className="py-1 pr-1 text-right font-medium"><ColumnHelp k="usageCost" align="end">รวม</ColumnHelp></th>
                <th className="py-1 text-right font-medium"><ColumnHelp k="usagePerCall" align="end">ต่อครั้ง</ColumnHelp></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.day} className="border-t border-gray-100">
                  <td className="py-1.5 pr-1">{dayLabel(d.day)}</td>
                  <td className="py-1.5 pr-1 text-right tabular-nums">{fmtNum(d.calls)}</td>
                  <td className="py-1.5 pr-1 text-right tabular-nums">{fmtUsd(d.costUsd)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtUsdPerCall(costPerCall(d.costUsd, d.calls, d.failed))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BarChart
        className="mt-3"
        height={140}
        formatValue={(n) => fmtUsd(n)}
        data={shown.map((d) => ({ label: dayLabelTh(d.day, true), value: d.costUsd, hint: `${dayLabel(d.day)}: ${fmtUsd(d.costUsd)}` }))}
        ariaLabel={`ค่าใช้จ่ายรายวัน ${title}`}
      />
    </div>
  );
}
