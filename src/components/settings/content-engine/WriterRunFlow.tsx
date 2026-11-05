"use client";

// ภาพ Run Test: เส้นขั้นตอน / กราฟแท่ง layer / funnel ไฟล์ — ทุกตัวเลขมาจากผล WriterDryRun จริง
import { CheckCircle2, CircleDashed, MinusCircle, Sparkles, Wrench, XCircle, Zap } from "lucide-react";

import { fileFunnel, flowSteps, layerBars, RUN_FLOW_BAR_COLOR, unsentFiles, type ExcludedLayer } from "@/lib/ce-run-flow";
import type { DryRunFileReport, DryRunLayer, DryRunStep } from "@/lib/ce-writer-dry-run";
import { cn } from "@/lib/utils";

const AI_LABEL: Record<DryRunStep["ai"], string> = {
  no: "ไม่ใช้ AI",
  yes: "ใช้ AI",
  maybe: "ใช้ AI เมื่อจำเป็น",
};

const EXCLUDED_LABEL: Record<ExcludedLayer["state"], string> = {
  missing: "ขาด",
  off: "ไม่ได้ใช้",
  later: "ใช้ขั้นอื่น",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function AiBadge({ ai }: { ai: DryRunStep["ai"] }) {
  const Icon = ai === "no" ? Wrench : ai === "yes" ? Sparkles : Zap;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[11px]", ai === "no" ? "text-gray-500" : "font-medium text-indigo-700")}>
      <Icon className="size-3 shrink-0" aria-hidden /> {AI_LABEL[ai]}
    </span>
  );
}

/** เส้นเชื่อมขั้นตอน: เส้นทึบ = Run Test ทำจริง · เส้นประ = เกิดตอนเขียนจริง */
export function RunStepLine({ steps }: { steps: DryRunStep[] }) {
  const items = flowSteps(steps);
  return (
    <ol className="relative">
      {items.map((s, i) => {
        const last = i === items.length - 1;
        // เส้นลงไปขั้นถัดไปทึบเมื่อขั้นถัดไปยังอยู่ใน Run Test
        const nextInTest = !last && items[i + 1].inTest;
        return (
          <li key={`${s.index}-${s.title}`} className="relative pb-3 pl-9 last:pb-0" title={`${s.index + 1}. ${s.title}: ${s.inTest ? "Run Test ทำให้ดู" : "ตอนเขียนจริง"}`}>
            {!last && (
              <span
                aria-hidden
                className={cn("absolute bottom-0 left-[13px] top-7 border-l-2", nextInTest ? "border-indigo-300" : "border-dashed border-gray-300")}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-0.5 flex size-[28px] items-center justify-center rounded-full border-2 text-[11px] font-semibold",
                s.inTest ? "border-indigo-600 bg-indigo-600 text-white" : "border-dashed border-gray-300 bg-white text-gray-500"
              )}
            >
              {s.index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="break-words text-xs font-semibold text-gray-800">{s.title}</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  {s.inTest ? <CheckCircle2 className="size-3 text-green-600" aria-hidden /> : <CircleDashed className="size-3" aria-hidden />}
                  {s.inTest ? "Run Test ทำให้ดู" : "ตอนเขียนจริง"}
                </span>
                <span className="sm:ml-auto">
                  <AiBadge ai={s.ai} />
                </span>
              </div>
              <p className="mt-0.5 break-words text-xs text-gray-500">{s.detail}</p>
              {s.isLastInTest && (
                <p className="mt-2 rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-center text-[11px] font-medium text-indigo-800">
                  Run Test หยุดตรงนี้ ด้านล่างเกิดตอนเขียนจริงเท่านั้น
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ExcludedIcon({ state }: { state: ExcludedLayer["state"] }) {
  const Icon = state === "missing" ? XCircle : MinusCircle;
  return <Icon className={cn("size-3.5 shrink-0", state === "missing" ? "text-red-600" : "text-gray-400")} aria-hidden />;
}

/** แท่ง = ตัวอักษรของแต่ละ layer ที่ส่งเข้า prompt จริง */
export function LayerBarChart({ layers }: { layers: DryRunLayer[] }) {
  const { bars, excluded, total } = layerBars(layers);
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-gray-700">จำนวนตัวอักษรของแต่ละ layer ที่ส่งเข้า AI (รวม {fmt(total)})</p>
      {bars.length === 0 ? (
        <p className="text-xs text-gray-500">ไม่มี layer ที่ถูกส่งเข้า prompt</p>
      ) : (
        <ul className="space-y-1">
          {bars.map((b) => (
            <li key={b.key} className="group relative rounded-md px-1 py-1.5 outline-none hover:bg-gray-50 focus-visible:bg-gray-50" tabIndex={0} title={`${b.label}: ${fmt(b.chars)} ตัวอักษร`}>
              <p className="break-words text-xs text-gray-700">{b.label}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <div
                  className="h-4 shrink-0 rounded-r-[4px]"
                  style={{ width: `${Math.round(b.pct * 0.75)}%`, minWidth: 2, backgroundColor: RUN_FLOW_BAR_COLOR }}
                  role="img"
                  aria-label={`${b.label} ${fmt(b.chars)} ตัวอักษร`}
                />
                <span className="shrink-0 text-xs tabular-nums text-gray-700">{fmt(b.chars)}</span>
              </div>
              <span
                role="tooltip"
                className="pointer-events-none absolute right-1 top-1 z-10 hidden rounded-md bg-gray-900 px-2 py-1 text-[11px] text-white shadow group-hover:block group-focus-visible:block"
              >
                {b.label}: {fmt(b.chars)} ตัวอักษร ({total > 0 ? Math.round((b.chars / total) * 100) : 0}% ของทั้งหมด)
              </span>
            </li>
          ))}
        </ul>
      )}
      {excluded.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <p className="mb-1 text-[11px] text-gray-500">ไม่มีแท่ง เพราะไม่ได้ส่งเข้า prompt</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {excluded.map((e) => (
              <li key={e.key} className="inline-flex items-center gap-1 text-xs text-gray-600">
                <ExcludedIcon state={e.state} />
                <span className="break-words">{e.label}</span>
                <span className={e.state === "missing" ? "font-medium text-red-700" : "text-gray-500"}>· {EXCLUDED_LABEL[e.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** funnel: ข้อความในไฟล์ที่อัปโหลด → ที่ส่งเข้า prompt จริง */
export function FileFunnel({ files }: { files: DryRunFileReport[] }) {
  const funnel = fileFunnel(files);
  if (!funnel) {
    return (
      <div>
        <p className="mb-1 text-xs font-semibold text-gray-700">ข้อความจากไฟล์ → ส่งเข้า AI</p>
        <p className="text-xs text-gray-500">ไม่มีไฟล์ที่อัปโหลด</p>
      </div>
    );
  }
  const unsent = unsentFiles(files);
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-gray-700">
        ข้อความจากไฟล์ → ส่งเข้า AI ({fmt(funnel.sentChars)} จาก {fmt(funnel.totalChars)} ตัวอักษร)
      </p>
      <ul className="space-y-2">
        {funnel.stages.map((s) => (
          <li key={s.key} className="group relative rounded-md px-1 py-1 outline-none hover:bg-gray-50 focus-visible:bg-gray-50" tabIndex={0} title={`${s.label}: ${fmt(s.value)} ตัวอักษร`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="min-w-0 break-words text-xs text-gray-700">{s.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-gray-700">{fmt(s.value)}</span>
            </div>
            <div className="mt-0.5 flex justify-center">
              <div
                className="h-4 rounded-[4px]"
                style={{ width: `${s.pct}%`, minWidth: s.pct > 0 ? 3 : 0, backgroundColor: s.color }}
                role="img"
                aria-label={`${s.label} ${fmt(s.value)} ตัวอักษร`}
              />
            </div>
            {s.note && <p className="mt-0.5 break-words text-[11px] text-gray-500">{s.note}</p>}
            <span
              role="tooltip"
              className="pointer-events-none absolute right-1 top-1 z-10 hidden rounded-md bg-gray-900 px-2 py-1 text-[11px] text-white shadow group-hover:block group-focus-visible:block"
            >
              {s.label}: {fmt(s.value)} ตัวอักษร ({Math.round((s.value / funnel.totalChars) * 100)}% ของข้อความในไฟล์ทั้งหมด)
            </span>
          </li>
        ))}
      </ul>
      {unsent.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <p className="mb-1 text-[11px] text-gray-500">ไฟล์ที่ไม่ถูกส่งเลย (ไม่มีแท่ง)</p>
          <ul className="space-y-1">
            {unsent.map((f) => (
              <li key={`${f.layer}-${f.id}`} className="flex items-start gap-1 text-xs text-gray-600">
                <MinusCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
                <span className="break-words">
                  {f.name} <span className="text-gray-500">· ไม่ได้ส่ง · {fmt(f.totalChars)} ตัวอักษร</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
