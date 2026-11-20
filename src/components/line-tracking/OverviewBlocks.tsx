import type { ReactNode } from "react";
import { FigureRow, Gauge, HeroProgress, TRACK } from "@/components/ui/Widgets";
import { SectionCard, StatusBadge, EmptyRow } from "@/components/line-tracking/ui";
import { DailyLeadsChart } from "@/components/line-tracking/Charts";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import { fmtMoney } from "@/lib/line-tracking/format";
import { pctChange } from "@/lib/line-tracking/compare";
import { DAILY_MAX_DAYS, dayLabel, rateDialMax, type DailySeries } from "@/lib/line-tracking/overview";

/**
 * Blocks of the LINE Tracking project Overview. Presentation only: every number comes in
 * through props, so the real page and its sample-data preview render the same markup.
 */

export type PeriodMetrics = { leads: number; purchases: number; revenue: number };

const CARD = "rounded-2xl border border-gray-200 bg-white p-4 sm:p-5";
const BLUE = "#1d48f3";
const NAVY = "#000E3F";

/** A change this small prints as 0.0%: neither good nor bad. */
const isFlat = (d: number) => Math.abs(d) < 0.05;

/**
 * `delta` props for a KPI TintTile: the change against the comparison period.
 * Empty when there is no comparison period, so the tile shows no arrow.
 */
export function tileDelta(cur: number, prev: number | null | undefined): { delta?: number; deltaGood?: null } {
  if (prev == null) return {};
  const d = pctChange(cur, prev);
  return isFlat(d) ? { delta: d, deltaGood: null } : { delta: d };
}

/**
 * "▲ 12.3%" in the form the KPI tiles use. More is better for every number on this page,
 * except a cost (CPA), which passes `downIsGood`.
 */
function Delta({ cur, prev, downIsGood = false }: { cur: number; prev: number; downIsGood?: boolean }) {
  const d = pctChange(cur, prev);
  const good = downIsGood ? d < 0 : d > 0;
  const tone = isFlat(d) ? "text-gray-500" : good ? "text-green-600" : "text-red-500";
  return (
    <span className={`text-xs font-semibold ${tone}`}>
      {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}%
    </span>
  );
}

/**
 * The chosen period against the comparison period: revenue as a bar with a mark at the
 * comparison period's revenue, the other numbers under it, and the close rate on a dial.
 * `compared` null: nothing to compare with, so no bar, no mark and no arrows.
 */
export function PeriodPerformance({
  periodLabel,
  compareTitle,
  comparedLabel,
  notCompared,
  current,
  compared,
  currency,
}: {
  periodLabel: string;
  compareTitle: string;
  comparedLabel: string;
  notCompared: string;
  current: PeriodMetrics;
  compared: PeriodMetrics | null;
  currency: string;
}) {
  const money = (n: number) => fmtMoney(n, currency);
  const bill = (m: PeriodMetrics) => (m.purchases > 0 ? m.revenue / m.purchases : null);
  const rate = (m: PeriodMetrics) => (m.leads > 0 ? (m.purchases / m.leads) * 100 : null);

  // The longer of the two revenue bars ends at 80% of the track, so both ends stay visible.
  const scale = Math.max(current.revenue, compared?.revenue ?? 0) / 0.8 || 1;
  const curBill = bill(current);
  const prevBill = compared ? bill(compared) : null;
  const curRate = rate(current);
  const prevRate = compared ? rate(compared) : null;
  const dialMax = rateDialMax(curRate ?? 0, prevRate ?? 0);

  const figures: { label: string; title?: string; value: ReactNode; delta?: ReactNode; prev?: string }[] = [
    {
      label: "Leads ใหม่",
      value: current.leads.toLocaleString(),
      delta: compared && <Delta cur={current.leads} prev={compared.leads} />,
      prev: compared ? compared.leads.toLocaleString() : undefined,
    },
    {
      label: "ปิดการขาย",
      value: current.purchases.toLocaleString(),
      delta: compared && <Delta cur={current.purchases} prev={compared.purchases} />,
      prev: compared ? compared.purchases.toLocaleString() : undefined,
    },
    {
      label: "ยอดเฉลี่ยต่อบิล",
      title: "ยอดขาย ÷ จำนวนที่ปิดการขาย",
      value: curBill != null ? money(curBill) : "—",
      delta: curBill != null && prevBill != null && <Delta cur={curBill} prev={prevBill} />,
      prev: compared ? (prevBill != null ? money(prevBill) : "—") : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
      <div className={`${CARD} lg:col-span-2`}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">ผลงานช่วงนี้</h2>
          <span className="text-xs text-gray-500">{compareTitle}</span>
        </div>
        {compared ? (
          <HeroProgress
            label={`ยอดขาย · ${periodLabel}`}
            value={money(current.revenue)}
            sub={<Delta cur={current.revenue} prev={compared.revenue} />}
            pct={(current.revenue / scale) * 100}
            marker={(compared.revenue / scale) * 100}
            markerLabel={`${comparedLabel}: ${money(compared.revenue)}`}
          />
        ) : (
          <div>
            <div className="text-sm text-gray-500">ยอดขาย · {periodLabel}</div>
            <div className="mt-1 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">{money(current.revenue)}</div>
            <div className="mt-2 text-xs text-gray-500">{notCompared}</div>
          </div>
        )}
        <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-gray-100 pt-4 sm:grid-cols-3">
          {figures.map((f) => (
            <div key={f.label} title={f.title}>
              <div className="text-sm text-gray-500">{f.label}</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-bold tracking-tight text-gray-900">{f.value}</span>
                {f.delta}
              </div>
              {f.prev !== undefined && (
                <div className="mt-0.5 text-xs text-gray-500">
                  {comparedLabel}: {f.prev}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <SectionCard title="อัตราปิดการขาย" action={<span className="text-xs text-gray-500">{periodLabel}</span>}>
        <Gauge
          pct={((curRate ?? 0) / dialMax) * 100}
          marker={prevRate != null ? (prevRate / dialMax) * 100 : undefined}
          value={curRate != null ? `${curRate.toFixed(1)}%` : "—"}
          caption={
            current.leads > 0
              ? `ปิดการขาย ${current.purchases.toLocaleString()} จาก ${current.leads.toLocaleString()} leads`
              : "ยังไม่มี lead ในช่วงนี้"
          }
          ariaLabel={
            curRate != null ? `อัตราปิดการขาย ${curRate.toFixed(1)}% บนหน้าปัด 0 ถึง ${dialMax}%` : "อัตราปิดการขาย: ยังไม่มี lead"
          }
          footer={[
            ...(compared
              ? [{ label: `${comparedLabel} (ขีดดำ)`, value: prevRate != null ? `${prevRate.toFixed(1)}%` : "—" }]
              : []),
            { label: "สเกลหน้าปัด", value: `0–${dialMax}%` },
          ]}
        />
      </SectionCard>
    </div>
  );
}

/** Leads per day as one line, with the total, the average per day and the busiest day under it. */
export function DailyLeadsCard({ daily, periodLabel }: { daily: DailySeries; periodLabel: string }) {
  const { points } = daily;
  const total = points.reduce((n, p) => n + p.leads, 0);
  const peak = points.reduce<(typeof points)[number] | null>((best, p) => (!best || p.leads > best.leads ? p : best), null);

  const notes: string[] = [];
  if (daily.capped) notes.push(`กราฟแสดงไม่เกิน ${DAILY_MAX_DAYS} วันล่าสุดของช่วงเวลาที่เลือก`);
  if (daily.partialStart) notes.push("วันแรกในกราฟนับไม่เต็มวัน เพราะช่วงเวลาเริ่มกลางวัน");
  if (daily.partialEnd) notes.push("วันนี้ยังไม่จบวัน");

  return (
    <SectionCard title="Leads รายวัน (แอด LINE)" action={<span className="text-xs text-gray-500">{periodLabel}</span>}>
      {points.length >= 2 ? (
        <>
          <DailyLeadsChart points={points} />
          <FigureRow
            className="mt-3"
            figures={[
              { label: daily.capped ? "รวมในกราฟ" : "รวม", value: `${total.toLocaleString()} leads` },
              { label: "เฉลี่ยต่อวัน", value: daily.spanDays > 0 ? (total / daily.spanDays).toFixed(1) : "—" },
              {
                label: "วันที่มากที่สุด",
                value: peak && peak.leads > 0 ? `${dayLabel(peak.day)} · ${peak.leads.toLocaleString()} leads` : "—",
              },
            ]}
          />
          {notes.length > 0 && <p className="mt-3 text-xs text-gray-500">{notes.join(" · ")}</p>}
        </>
      ) : points.length === 1 ? (
        <div className="flex h-[140px] flex-col items-center justify-center text-center">
          <div className="text-3xl font-bold tracking-tight text-gray-900">{points[0].leads.toLocaleString()}</div>
          <div className="mt-1 text-sm text-gray-600">leads · {dayLabel(points[0].day)}</div>
          <div className="mt-2 text-xs text-gray-500">ช่วงเวลานี้มีวันเดียว จึงไม่มีเส้นรายวัน — เลือก 7 วันขึ้นไปเพื่อดูแนวโน้ม</div>
        </div>
      ) : (
        <div className="flex h-[140px] items-center justify-center text-sm text-gray-500">ยังไม่มีข้อมูล</div>
      )}
    </SectionCard>
  );
}

function BarCell({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-right font-medium tabular-nums text-gray-900">{value.toLocaleString()}</span>
      <div className="h-2.5 min-w-[96px] flex-1 rounded-full" style={{ background: TRACK }}>
        {value > 0 && (
          <div className="h-full rounded-full" style={{ width: `${Math.max((value / max) * 100, 3)}%`, background: color }} />
        )}
      </div>
    </div>
  );
}

/**
 * Leads, closed sales, close rate and sales per channel in one table. The two counts carry a
 * bar each, scaled within their own column: on one shared axis the closed counts were too short
 * to read next to the leads.
 */
export function ChannelTable({
  channels,
  currency,
}: {
  channels: { channelGroup: string; leads: number; purchases: number; revenue: number }[];
  currency: string;
}) {
  const maxLeads = Math.max(1, ...channels.map((c) => c.leads));
  const maxClosed = Math.max(1, ...channels.map((c) => c.purchases));
  const TH = "px-3 py-3 text-left font-semibold";
  const TD = "px-3 py-3 text-sm text-gray-700";
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Leads และ ปิดการขาย แยกตามช่องทาง</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          แถบเทียบกับช่องทางที่มากที่สุดในคอลัมน์เดียวกัน — Leads และ ปิดการขาย ใช้สเกลคนละชุด
        </p>
      </div>
      <div className="overflow-x-auto">
        <ResizableTable storageKey="lt-overview-channels" className="min-w-full">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className={`${TH} px-5`}>Channel</th>
              <th className={`${TH} w-[30%]`}>Leads</th>
              <th className={`${TH} w-[30%]`}>ปิดการขาย (Closed)</th>
              <th className={`${TH} text-right`}>Close Rate</th>
              <th className={`${TH} px-5 text-right`}>Sales</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {channels.length === 0 && <EmptyRow colSpan={5} text="ยังไม่มีข้อมูล" />}
            {channels.map((c) => (
              <tr key={c.channelGroup} className="hover:bg-gray-50">
                <td className={`${TD} whitespace-nowrap px-5`}>
                  <StatusBadge status={c.channelGroup} label={c.channelGroup} />
                </td>
                <td className={TD}>
                  <BarCell value={c.leads} max={maxLeads} color={BLUE} />
                </td>
                <td className={TD}>
                  <BarCell value={c.purchases} max={maxClosed} color={NAVY} />
                </td>
                <td className={`${TD} text-right tabular-nums text-gray-500`}>
                  {c.leads > 0 ? `${((c.purchases / c.leads) * 100).toFixed(0)}%` : "—"}
                </td>
                <td className={`${TD} whitespace-nowrap px-5 text-right font-medium tabular-nums text-gray-900`}>
                  {fmtMoney(c.revenue, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResizableTable>
      </div>
    </div>
  );
}

/**
 * The Lead / LINE / CPA view of "ผลงานช่วงนี้", for a business that does not close sales in
 * the funnel: leads as the bar (marked at the comparison period's leads), ad spend, cost per
 * lead and leads per day under it, and the share of leads that passed quality on the dial.
 * Spend and CPA are "—" with `spendHint` when they cannot be worked out.
 */
export function LeadPeriodPerformance({
  periodLabel,
  compareTitle,
  comparedLabel,
  notCompared,
  leads,
  comparedLeads,
  qualified,
  spend,
  cpa,
  comparedCpa,
  spendHint,
  days,
  currency,
}: {
  periodLabel: string;
  compareTitle: string;
  comparedLabel: string;
  notCompared: string;
  leads: number;
  /** Null: nothing to compare with. */
  comparedLeads: number | null;
  qualified: number;
  spend: number | null;
  cpa: number | null;
  comparedCpa: number | null;
  spendHint: string | null;
  /** Length of the window in days, or null for all time. */
  days: number | null;
  currency: string;
}) {
  const money = (n: number) => fmtMoney(n, currency);
  const cpaText = (n: number) => fmtMoney(n, currency);
  const scale = Math.max(leads, comparedLeads ?? 0) / 0.8 || 1;
  const qualityRate = leads > 0 ? Math.min((qualified / leads) * 100, 100) : null;

  const figures: { label: string; title?: string; value: ReactNode; delta?: ReactNode; prev?: string }[] = [
    {
      label: "งบโฆษณา",
      title: "งบโฆษณาที่ใส่ไว้ต่อเดือน เฉลี่ยตามจำนวนวันของช่วงที่เลือก",
      value: spend != null ? money(spend) : "—",
    },
    {
      label: "CPA (ต้นทุนต่อ Lead)",
      title: "งบโฆษณา ÷ จำนวน Leads",
      value: cpa != null ? cpaText(cpa) : "—",
      delta: cpa != null && comparedCpa != null && <Delta cur={cpa} prev={comparedCpa} downIsGood />,
      prev: comparedLeads != null ? (comparedCpa != null ? cpaText(comparedCpa) : "—") : undefined,
    },
    {
      label: "Leads เฉลี่ยต่อวัน",
      value: days && days > 0 ? (leads / days).toFixed(1) : "—",
    },
  ];

  return (
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
      <div className={`${CARD} lg:col-span-2`}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">ผลงานช่วงนี้</h2>
          <span className="text-xs text-gray-500">{compareTitle}</span>
        </div>
        {comparedLeads != null ? (
          <HeroProgress
            label={`Leads (แอด LINE) · ${periodLabel}`}
            value={leads.toLocaleString()}
            sub={<Delta cur={leads} prev={comparedLeads} />}
            pct={(leads / scale) * 100}
            marker={(comparedLeads / scale) * 100}
            markerLabel={`${comparedLabel}: ${comparedLeads.toLocaleString()}`}
          />
        ) : (
          <div>
            <div className="text-sm text-gray-500">Leads (แอด LINE) · {periodLabel}</div>
            <div className="mt-1 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">{leads.toLocaleString()}</div>
            <div className="mt-2 text-xs text-gray-500">{notCompared}</div>
          </div>
        )}
        <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-gray-100 pt-4 sm:grid-cols-3">
          {figures.map((f) => (
            <div key={f.label} title={f.title}>
              <div className="text-sm text-gray-500">{f.label}</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-bold tracking-tight text-gray-900">{f.value}</span>
                {f.delta}
              </div>
              {f.prev !== undefined && (
                <div className="mt-0.5 text-xs text-gray-500">
                  {comparedLabel}: {f.prev}
                </div>
              )}
            </div>
          ))}
        </div>
        {spendHint && <p className="mt-3 text-xs text-amber-700">{spendHint}</p>}
      </div>

      <SectionCard title="Lead คุณภาพผ่าน" action={<span className="text-xs text-gray-500">{periodLabel}</span>}>
        <Gauge
          pct={qualityRate ?? 0}
          value={qualityRate != null ? `${qualityRate.toFixed(1)}%` : "—"}
          caption={
            leads > 0
              ? `คุณภาพผ่าน ${qualified.toLocaleString()} จาก ${leads.toLocaleString()} leads`
              : "ยังไม่มี lead ในช่วงนี้"
          }
          ariaLabel={qualityRate != null ? `Lead คุณภาพผ่าน ${qualityRate.toFixed(1)}%` : "Lead คุณภาพผ่าน: ยังไม่มี lead"}
          footer={[{ label: "สเกลหน้าปัด", value: "0–100%" }]}
        />
      </SectionCard>
    </div>
  );
}

/** Leads per channel only: the Lead / LINE / CPA view has no closed sales to show. */
export function ChannelLeadsTable({ channels }: { channels: { channelGroup: string; leads: number }[] }) {
  const maxLeads = Math.max(1, ...channels.map((c) => c.leads));
  const total = channels.reduce((n, c) => n + c.leads, 0);
  const TH = "px-3 py-3 text-left font-semibold";
  const TD = "px-3 py-3 text-sm text-gray-700";
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Leads แยกตามช่องทาง</h2>
      </div>
      <div className="overflow-x-auto">
        <ResizableTable storageKey="lt-overview-channels-lead" className="min-w-full">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className={`${TH} px-5`}>Channel</th>
              <th className={`${TH} w-[50%]`}>Leads</th>
              <th className={`${TH} px-5 text-right`}>สัดส่วน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {channels.length === 0 && <EmptyRow colSpan={3} text="ยังไม่มีข้อมูล" />}
            {channels.map((c) => (
              <tr key={c.channelGroup} className="hover:bg-gray-50">
                <td className={`${TD} whitespace-nowrap px-5`}>
                  <StatusBadge status={c.channelGroup} label={c.channelGroup} />
                </td>
                <td className={TD}>
                  <BarCell value={c.leads} max={maxLeads} color={BLUE} />
                </td>
                <td className={`${TD} px-5 text-right tabular-nums text-gray-500`}>
                  {total > 0 ? `${((c.leads / total) * 100).toFixed(0)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </ResizableTable>
      </div>
    </div>
  );
}
