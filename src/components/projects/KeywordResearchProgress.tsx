'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * ตัวแสดง "กำลังทำงาน" กลางจอสำหรับหน้า Keyword Research
 *
 * รองรับ 3 โหมด:
 * - `progressMeta` : โหมดเต็ม (Online research) — แสดงเฟสงาน + เวลาที่ใช้/เหลือ
 *                    + progress bar + log จริง ให้ทีมรู้ว่าระบบทำอะไรอยู่และต้องรออีกเท่าไหร่
 * - `logs`  : ป้อน log จริงที่ stream มาจากเซิร์ฟเวอร์ แสดงเป็น feed ไล่ทีละบรรทัด
 * - `steps` : รายการขั้นตอนจำลอง (โหมด POST เดียว ไม่มี stream) ไล่ไฮไลต์ตามเวลา
 *
 * ลำดับความจริง: progressMeta > logs > steps
 */

export interface ResearchPhaseView {
  label: string;
  desc: string;
  state: 'done' | 'active' | 'pending';
  estLabel: string;
  actualLabel?: string;
}

export interface ResearchProgressMeta {
  stepLabel: string;
  stepIndex: number;
  stepTotal: number;
  percent: number;
  elapsedLabel: string;
  remainingLabel: string;
  phases: ResearchPhaseView[];
}

export function KeywordResearchProgress({
  title = 'กำลังค้นหาคีย์เวิร์ด',
  steps,
  logs,
  progressMeta,
}: {
  title?: string;
  steps?: string[];
  logs?: string[];
  progressMeta?: ResearchProgressMeta;
}) {
  const useLogs = Array.isArray(logs);

  // โหมด steps จำลอง: ไล่ไฮไลต์ทีละขั้น ขั้นแรกเร็ว ขั้นหลัง (ดึง volume) ช้าลง
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (progressMeta || useLogs || !steps || active >= steps.length - 1) return;
    const delay = 4500 + active * 2000;
    const timer = setTimeout(() => setActive(a => Math.min(a + 1, steps.length - 1)), delay);
    return () => clearTimeout(timer);
  }, [active, steps, useLogs, progressMeta]);

  // เลื่อน log ไปบรรทัดล่าสุดอัตโนมัติ
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs]);

  // ── โหมดเต็ม: เฟสงาน + เวลา + progress bar + log จริง ──
  if (progressMeta) {
    const m = progressMeta;
    return (
      <section className="rounded-2xl border border-white/80 bg-white/75 backdrop-blur px-6 py-6 shadow-sm">
        {/* หัว: กำลังทำอะไร + เวลา */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative h-9 w-9 shrink-0" aria-hidden>
            <span className="absolute inset-0 rounded-full border-[3px] border-gray-100" />
            <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-brand-blue" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-brand-navy">
              กำลังทำ: {m.stepLabel}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              ขั้นที่ {m.stepIndex}/{m.stepTotal} · ผ่านไปแล้ว {m.elapsedLabel} · เหลืออีกประมาณ{' '}
              <span className="font-bold text-brand-blue">{m.remainingLabel}</span> — อย่าปิดหน้านี้
            </p>
          </div>
          <span className="rounded-xl bg-brand-mist px-2.5 py-1.5 text-sm font-bold tabular-nums text-brand-blue">
            {m.percent}%
          </span>
        </div>

        {/* progress bar รวม */}
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-blue to-[#3b82f6] transition-all duration-700"
            style={{ width: `${Math.max(2, m.percent)}%` }}
          />
        </div>

        {/* เฟสงานใหญ่ 6 เฟส — เห็นชัดว่าอยู่ตรงไหน แต่ละเฟสกินเวลาเท่าไหร่ */}
        <ol className="mt-5 space-y-1.5">
          {m.phases.map((ph, i) => (
            <li
              key={`${i}-${ph.label}`}
              className={`flex items-start gap-3 rounded-xl border px-3.5 py-2.5 transition ${
                ph.state === 'active'
                  ? 'border-brand-blue/20 bg-brand-mist'
                  : ph.state === 'done'
                    ? 'border-transparent bg-emerald-50/60'
                    : 'border-transparent bg-white/60'
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  ph.state === 'done'
                    ? 'bg-[#157347] text-white'
                    : ph.state === 'active'
                      ? 'border-2 border-brand-blue text-brand-blue'
                      : 'border border-gray-200 text-gray-400'
                }`}
              >
                {ph.state === 'done' ? '✓' : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-xs leading-5 ${
                  ph.state === 'active' ? 'font-bold text-brand-blue' : ph.state === 'done' ? 'font-semibold text-[#157347]' : 'font-medium text-gray-400'
                }`}>
                  {ph.label}
                </span>
                {ph.state === 'active' ? (
                  <span className="mt-0.5 block text-[11px] leading-4 text-gray-600">{ph.desc}</span>
                ) : null}
              </span>
              <span className={`mt-0.5 shrink-0 text-[11px] tabular-nums ${
                ph.state === 'done' ? 'text-[#157347]' : ph.state === 'active' ? 'font-bold text-brand-blue' : 'text-gray-400'
              }`}>
                {ph.state === 'done'
                  ? (ph.actualLabel ? `เสร็จใน ${ph.actualLabel}` : 'เสร็จแล้ว')
                  : ph.state === 'active'
                    ? `กำลังทำ… ${ph.estLabel}`
                    : ph.estLabel}
              </span>
            </li>
          ))}
        </ol>

        {/* log จริงจากเซิร์ฟเวอร์ — บรรทัดล่าสุดเด่นสุด */}
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">รายละเอียดจากระบบ (real-time)</p>
          {(logs?.length ?? 0) === 0 ? (
            <p className="text-xs text-gray-400">กำลังเชื่อมต่อเซิร์ฟเวอร์…</p>
          ) : (
            <ol className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-white/60 px-4 py-3 text-left">
              {logs!.map((line, i) => {
                const last = i === logs!.length - 1;
                return (
                  <li
                    key={`${i}-${line}`}
                    className={`flex items-start gap-2 text-xs leading-5 ${last ? 'font-bold text-brand-navy' : 'text-gray-400'}`}
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${last ? 'animate-pulse bg-brand-blue' : 'bg-gray-300'}`} />
                    <span>{line}</span>
                  </li>
                );
              })}
              <div ref={endRef} />
            </ol>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-white/80 bg-white/75 backdrop-blur px-6 py-12 text-center shadow-sm">
      <div className="relative mb-5 h-12 w-12" aria-hidden>
        <span className="absolute inset-0 rounded-full border-[3px] border-gray-100" />
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-brand-blue" />
      </div>
      <p className="text-sm font-bold text-brand-navy">{title}…</p>
      <p className="mt-1 text-[11px] text-gray-400">ใช้เวลาสักครู่ ระบบกำลังไล่ทำทีละขั้น — อย่าปิดหน้านี้</p>

      {useLogs ? (
        <div className="mt-6 w-full max-w-lg">
          {logs!.length === 0 ? (
            <p className="text-xs text-gray-400">กำลังเชื่อมต่อเซิร์ฟเวอร์…</p>
          ) : (
            <ol className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-white/60 px-4 py-3 text-left">
              {logs!.map((line, i) => {
                const last = i === logs!.length - 1;
                return (
                  <li
                    key={`${i}-${line}`}
                    className={`flex items-start gap-2 text-xs leading-5 ${last ? 'font-bold text-brand-navy' : 'text-gray-400'}`}
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${last ? 'animate-pulse bg-brand-blue' : 'bg-gray-300'}`} />
                    <span>{line}</span>
                  </li>
                );
              })}
              <div ref={endRef} />
            </ol>
          )}
        </div>
      ) : (
        <ol className="mx-auto mt-6 w-full max-w-sm space-y-2.5 text-left">
          {(steps ?? []).map((label, i) => {
            const state = i < active ? 'done' : i === active ? 'active' : 'pending';
            return (
              <li key={`${i}-${label}`} className="flex items-center gap-2.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    state === 'done'
                      ? 'bg-brand-blue text-white'
                      : state === 'active'
                        ? 'border-2 border-brand-blue'
                        : 'border border-gray-200'
                  }`}
                >
                  {state === 'done' ? '✓' : state === 'active' ? <span className="h-2 w-2 animate-ping rounded-full bg-brand-blue" /> : null}
                </span>
                <span
                  className={`text-xs leading-5 ${
                    state === 'done'
                      ? 'font-medium text-gray-600'
                      : state === 'active'
                        ? 'font-bold text-brand-navy'
                        : 'text-gray-400'
                  }`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
