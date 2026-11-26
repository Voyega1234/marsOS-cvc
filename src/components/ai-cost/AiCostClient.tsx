"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertCircle, CalendarDays, Cpu, DollarSign, Filter, Zap } from "lucide-react";

import { EmptyState, KpiTile, Panel } from "@/components/ds";
import {
  buildAiCostQuery, hasActiveAiCostFilters, type AiCostFilterKey, type AiCostFilters, type AiCostSort,
} from "@/lib/ai-cost-filters";
import type { AiCostPreset, AiCostRange } from "@/lib/ai-cost-range";
import { fmtInt, fmtThb, pctChange } from "@/lib/ai-cost-format";
import type { AiCostView } from "@/lib/ai-cost-data";
import { AiCostFilterBar } from "./AiCostFilterBar";
import { AiCostChart } from "./AiCostChart";
import { AiCostBreakdown } from "./AiCostBreakdown";
import { AiCostJobsTable } from "./AiCostJobsTable";

type RangeSel = Pick<AiCostRange, "preset" | "from" | "to">;

export function AiCostClient({ view, range, filters, sort }: {
  view: AiCostView;
  range: AiCostRange;
  filters: AiCostFilters;
  sort: AiCostSort;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  // ทุกการเปลี่ยนมุมมองเป็นการเปลี่ยน URL (push) — ปุ่ม back ย้อนกลับมุมมองก่อนหน้าได้
  const nav = (r: RangeSel, f: AiCostFilters, s: AiCostSort, page = 1) =>
    start(() => router.push(`${pathname}${buildAiCostQuery(r, f, { sort: s, page })}`, { scroll: false }));

  const onRange = (r: { preset: AiCostPreset | "custom"; from?: string; to?: string }) =>
    nav({ preset: r.preset, from: r.from || null, to: r.to || null }, filters, sort);
  const onFilter = (key: AiCostFilterKey, value: string) => {
    const next: AiCostFilters = { ...filters };
    if (value) (next as Record<string, string>)[key] = value; else delete next[key];
    if (key === "module" && next.type) delete next.type; // เปลี่ยนระบบแล้ว ประเภทงานเดิมอาจไม่อยู่ในระบบนั้น
    nav(range, next, sort);
  };
  const onDrill = (patch: Partial<Record<AiCostFilterKey, string>>) => nav(range, { ...filters, ...patch } as AiCostFilters, sort);
  const onClear = () => nav(range, {}, sort);

  const s = view.summary;
  const prev = view.previous;
  const empty = s.calls === 0;
  const avg = s.calls > 0 ? s.cost / s.calls : 0;

  return (
    <div className="min-w-0 space-y-5">
      <AiCostFilterBar range={range} filters={filters} options={view.options} pending={pending}
        onRange={onRange} onFilter={onFilter} onClear={onClear} />

      <div className={`space-y-5 transition-opacity ${pending ? "pointer-events-none opacity-50" : ""}`} aria-busy={pending}>
        {empty ? (
          <Panel>
            <EmptyState
              icon={hasActiveAiCostFilters(filters) ? <Filter size={22} /> : <CalendarDays size={22} />}
              title="ยังไม่มีการใช้ AI ในช่วงเวลานี้"
              description={hasActiveAiCostFilters(filters) ? "ไม่มีรายการตรงกับตัวกรอง ลองกด ล้างตัวกรอง หรือเลือกช่วงเวลาอื่น" : "ลองเลือกช่วงเวลาอื่น หรือกด ทั้งหมด"}
              action={hasActiveAiCostFilters(filters) ? (
                <button type="button" onClick={onClear} className="rounded-full bg-brand-navy px-4 py-1.5 text-xs font-semibold text-white">ล้างตัวกรอง</button>
              ) : undefined}
            />
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-5">
              <KpiTile tone="blue" icon={<DollarSign size={16} />} label="ค่าใช้จ่ายรวม" value={fmtThb(s.cost)}
                delta={prev ? pctChange(s.cost, prev.cost) : null} invertDelta
                hint={`เทียบช่วงก่อนหน้าที่ยาวเท่ากัน${prev ? ` (${fmtThb(prev.cost)})` : ""}`} />
              <KpiTile tone="sky" icon={<Zap size={16} />} label="จำนวนครั้งที่เรียก AI" value={fmtInt(s.calls)}
                delta={prev ? pctChange(s.calls, prev.calls) : null}
                hint={prev ? `ช่วงก่อนหน้า ${fmtInt(prev.calls)} ครั้ง` : "ทุกครั้งที่ระบบเรียก AI/API"} />
              <KpiTile tone="mist" icon={<Cpu size={16} />} label="Tokens รวม" value={fmtInt(s.tokens)} hint="เฉพาะงานที่บันทึก tokens" />
              <KpiTile tone="plain" icon={<DollarSign size={16} />} label="ค่าเฉลี่ยต่อครั้ง" value={fmtThb(avg)} hint="เฉลี่ยจากทุกครั้งที่เรียก" />
              <KpiTile tone={s.failed > 0 ? "warm" : "plain"} icon={<AlertCircle size={16} />} label="งานที่ล้มเหลว" value={fmtInt(s.failed)}
                hint={s.failed > 0 ? `เสียค่าใช้จ่ายไป ${fmtThb(s.failedCost)}` : "ไม่มีงานล้มเหลว"} />
            </div>

            <Panel title="ค่าใช้จ่ายรายวัน" subtitle="แท่งแบ่งสีตามระบบ · วันที่ตามเวลาไทย">
              <AiCostChart daily={view.daily} />
            </Panel>

            <Panel title="แยกค่าใช้จ่าย" subtitle="เรียงจากค่าใช้จ่ายมากไปน้อย">
              <AiCostBreakdown breakdown={view.breakdown} total={s.cost} filters={filters} onDrill={onDrill} />
            </Panel>

            <Panel title="รายการ AI แต่ละครั้ง">
              <AiCostJobsTable jobs={view.jobs} total={s.calls} page={view.page} pageSize={view.pageSize} totalPages={view.totalPages}
                sort={sort} onSort={(next) => nav(range, filters, next)} onPage={(p) => nav(range, filters, sort, p)} />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
