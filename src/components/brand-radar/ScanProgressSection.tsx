"use client";

/**
 * Brand Radar — Scan Progress: how the brand moved from one scan round to the next.
 * All values come from the server (ScanProgressPoint); differences are computed here, always against the round before.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { AreaChart, Chip, Panel } from "@/components/ds";
import type { ScanProgressPoint } from "@/lib/brand-radar/types";
import { ColumnHelp } from "./ColumnHelp";
import { pct } from "./ReportCards";
import { fmtNum } from "./shared";

type Kind = "rate" | "count" | "position";
type Dir = "up" | "down" | "flat";

interface Delta {
  /** signed text such as "+5.0 จุด"; null = nothing to compare */
  text: string | null;
  dir: Dir | null;
  /** true = better, false = worse, null = same / unknown */
  good: boolean | null;
  /** Thai sentence for title / aria-label */
  phrase: string;
}

const NO_DELTA: Delta = { text: null, dir: null, good: null, phrase: "ไม่มีรอบก่อนหน้าให้เทียบ" };

const sign = (n: number) => (n > 0 ? "+" : "");

/** difference between two values of one metric; either side null = no difference */
function computeDelta(cur: number | null | undefined, prev: number | null | undefined, kind: Kind): Delta {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return NO_DELTA;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return NO_DELTA;
  let diff: number;
  let shown: string;
  let unit = "";
  if (kind === "rate") {
    diff = Math.round((cur - prev) * 1000) / 10;
    shown = Math.abs(diff).toFixed(1);
    unit = " จุด";
  } else if (kind === "count") {
    diff = Math.round(cur - prev);
    shown = String(Math.abs(diff));
  } else {
    diff = Math.round((cur - prev) * 10) / 10;
    shown = Math.abs(diff).toFixed(1);
  }
  if (diff === 0) return { text: `${shown}${unit}`, dir: "flat", good: null, phrase: "เท่าเดิม" };
  const dir: Dir = diff > 0 ? "up" : "down";
  // for Avg. Position a lower number is better
  const good = kind === "position" ? diff < 0 : diff > 0;
  return {
    text: `${sign(diff)}${diff < 0 ? "-" : ""}${shown}${unit}`.replace("+-", "-"),
    dir,
    good,
    phrase: `${good ? "ดีขึ้น" : "แย่ลง"} ${shown}${unit} จากรอบก่อนหน้า`,
  };
}

function fmtPos(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(1);
}

function DeltaChip({ d, dim }: { d: Delta; dim?: boolean }) {
  if (d.text === null || d.dir === null) {
    return <span className="text-xs text-gray-400" title={d.phrase} aria-label={d.phrase}>—</span>;
  }
  const tone = d.good === null ? "muted" : d.good ? "ok" : "bad";
  return (
    <Chip tone={tone} title={d.phrase} className={`tabular-nums ${dim ? "opacity-60" : ""}`}>
      {d.dir === "up" && <ArrowUp className="h-3 w-3" aria-hidden />}
      {d.dir === "down" && <ArrowDown className="h-3 w-3" aria-hidden />}
      <span aria-label={d.phrase}>{d.text}</span>
    </Chip>
  );
}

interface Metric {
  key: string;
  label: string;
  kind: Kind;
  get: (s: ScanProgressPoint) => number | null;
  show: (s: ScanProgressPoint) => string;
}

const METRICS: Metric[] = [
  // Visibility = answers that name the brand or cite our site (appearRate); the appearRate key now carries the name-only rate
  { key: "visibility", label: "Visibility", kind: "rate", get: (s) => s.appearRate, show: (s) => pct(s.appearRate) },
  { key: "mentions", label: "Brand Mention", kind: "count", get: (s) => s.mentioned, show: (s) => `${fmtNum(s.mentioned)} คำตอบ` },
  { key: "citationRate", label: "AI Citation", kind: "rate", get: (s) => s.citationRate, show: (s) => pct(s.citationRate) },
  { key: "appearRate", label: "Brand Mention rate", kind: "rate", get: (s) => s.mentionRate, show: (s) => pct(s.mentionRate) },
  { key: "avgPosition", label: "Avg. Position", kind: "position", get: (s) => s.avgPosition, show: (s) => fmtPos(s.avgPosition) },
];

const toPct = (v: number | null) => (v === null ? null : v * 100);

export function ScanProgressSection({ scans }: { scans: ScanProgressPoint[] }) {
  if (scans.length === 0) return null;
  const newest = scans[scans.length - 1];
  const before = scans.length > 1 ? scans[scans.length - 2] : null;
  // newest first for the table; the "previous" round is the next row down
  const rows = [...scans].reverse();
  const multi = scans.length >= 2;

  return (
    <Panel title="Scan Progress" subtitle="พัฒนาการของแบรนด์ในแต่ละรอบสแกน เทียบกับรอบก่อนหน้า">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {METRICS.map((m) => (
            <div key={m.key} className="min-w-0 rounded-xl border border-gray-100 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/5">
              <div className="truncate text-xs text-gray-500">{m.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{m.show(newest)}</div>
              <div className="mt-1">
                <DeltaChip d={before ? computeDelta(m.get(newest), m.get(before), m.kind) : NO_DELTA} />
              </div>
            </div>
          ))}
        </div>

        {!multi && (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5">
            มีรอบสแกนรอบเดียว ต้องมีอย่างน้อย 2 รอบจึงจะเทียบพัฒนาการได้
          </p>
        )}

        {multi && (
          <div className="space-y-4">
            <AreaChart
              height={240}
              showLegend
              formatValue={(n) => `${Math.round(n)}%`}
              ariaLabel="กราฟ Visibility, AI Citation และ Brand Mention rate ในแต่ละรอบสแกน"
              series={[
                { name: "Visibility", points: scans.map((s) => ({ label: s.label, value: toPct(s.appearRate) })) },
                { name: "AI Citation", points: scans.map((s) => ({ label: s.label, value: toPct(s.citationRate) })) },
                { name: "Brand Mention rate", points: scans.map((s) => ({ label: s.label, value: toPct(s.mentionRate) })) },
              ]}
            />
            {scans.some((s) => s.avgPosition !== null) && <div>
              <p className="mb-1 text-xs text-gray-500">Avg. Position (ยิ่งน้อยยิ่งดี)</p>
              <AreaChart
                height={140}
                invertY
                formatValue={(n) => n.toFixed(1)}
                ariaLabel="กราฟ Avg. Position ในแต่ละรอบสแกน ยิ่งน้อยยิ่งดี"
                series={[{ name: "Avg. Position", points: scans.map((s) => ({ label: s.label, value: s.avgPosition })) }]}
              />
            </div>}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1.5 pr-3 font-medium"><ColumnHelp k="scanRound" align="start">รอบสแกน</ColumnHelp></th>
                <th className="py-1.5 pr-3 text-right font-medium"><ColumnHelp k="scanAnswers">คำตอบ</ColumnHelp></th>
                {METRICS.map((m) => (
                  <th key={m.key} className="py-1.5 pr-3 text-right font-medium last:pr-0">
                    <ColumnHelp k={m.key as "visibility" | "mentions" | "citationRate" | "appearRate" | "avgPosition"}>{m.label}</ColumnHelp>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const prev = rows[i + 1] ?? null;
                const dim = s.sameSetAsPrevious === false;
                return (
                  <tr key={s.runId} className="border-t border-gray-100 align-top">
                    <td className="py-2 pr-3 text-gray-800">
                      <span className="whitespace-nowrap tabular-nums">{s.label}</span>
                      {dim && (
                        <Chip tone="warn" className="ml-2" title="รอบนี้ใช้ชุดคำถามหรือแอป AI ไม่เหมือนรอบก่อนหน้า ตัวเลขส่วนต่างจึงเทียบกันตรง ๆ ไม่ได้">
                          เทียบตรงไม่ได้
                        </Chip>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(s.asked)}</td>
                    {METRICS.map((m) => (
                      <td key={m.key} className="py-2 pr-3 text-right last:pr-0">
                        <div className="tabular-nums">{m.show(s)}</div>
                        <div className="mt-0.5 flex justify-end">
                          <DeltaChip d={prev ? computeDelta(m.get(s), m.get(prev), m.kind) : NO_DELTA} dim={dim} />
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          <ColumnHelp k="scanDelta" align="start">ตัวเลขสีเขียว/แดง = เทียบกับรอบสแกนก่อนหน้า</ColumnHelp>
        </p>
      </div>
    </Panel>
  );
}
