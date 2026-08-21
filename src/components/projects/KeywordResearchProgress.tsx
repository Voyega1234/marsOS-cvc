'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * ตัวแสดง "กำลังทำงาน" กลางจอสำหรับหน้า Keyword Research
 *
 * รองรับ 2 โหมด:
 * - `logs`  : ป้อน log จริงที่ stream มาจากเซิร์ฟเวอร์ (โหมดไม่มีหน้าร้าน /pipeline)
 *            แสดงเป็น feed ไล่ทีละบรรทัด บรรทัดล่าสุดเด่นสุด
 * - `steps` : รายการขั้นตอน (โหมดมีหน้าร้านที่เป็น POST เดียว ไม่มี stream)
 *            ไล่ไฮไลต์ทีละขั้นตามเวลา แล้วค้างที่ขั้นสุดท้ายจนได้ผลลัพธ์
 *
 * ถ้าส่ง `logs` มาจะใช้ log จริงก่อนเสมอ (ตรงความจริงกว่า)
 */
export function KeywordResearchProgress({
  title = 'กำลังค้นหาคีย์เวิร์ด',
  steps,
  logs,
}: {
  title?: string;
  steps?: string[];
  logs?: string[];
}) {
  const useLogs = Array.isArray(logs);

  // โหมด steps จำลอง: ไล่ไฮไลต์ทีละขั้น ขั้นแรกเร็ว ขั้นหลัง (ดึง volume) ช้าลง
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (useLogs || !steps || active >= steps.length - 1) return;
    const delay = 4500 + active * 2000;
    const timer = setTimeout(() => setActive(a => Math.min(a + 1, steps.length - 1)), delay);
    return () => clearTimeout(timer);
  }, [active, steps, useLogs]);

  // เลื่อน log ไปบรรทัดล่าสุดอัตโนมัติ
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs]);

  return (
    <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-[#e3e8f1] bg-white px-6 py-12 text-center shadow-sm">
      <div className="relative mb-5 h-12 w-12" aria-hidden>
        <span className="absolute inset-0 rounded-full border-[3px] border-[#e6ecfa]" />
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-[#155eef]" />
      </div>
      <p className="text-sm font-bold text-[#17233a]">{title}…</p>
      <p className="mt-1 text-[11px] text-[#91a0b8]">ใช้เวลาสักครู่ ระบบกำลังไล่ทำทีละขั้น — อย่าปิดหน้านี้</p>

      {useLogs ? (
        <div className="mt-6 w-full max-w-lg">
          {logs!.length === 0 ? (
            <p className="text-xs text-[#a7b1c4]">กำลังเชื่อมต่อเซิร์ฟเวอร์…</p>
          ) : (
            <ol className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-[#f7f9fd] px-4 py-3 text-left">
              {logs!.map((line, i) => {
                const last = i === logs!.length - 1;
                return (
                  <li
                    key={`${i}-${line}`}
                    className={`flex items-start gap-2 text-xs leading-5 ${last ? 'font-bold text-[#17233a]' : 'text-[#8b98af]'}`}
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${last ? 'animate-pulse bg-[#155eef]' : 'bg-[#cdd6e6]'}`} />
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
                      ? 'bg-[#155eef] text-white'
                      : state === 'active'
                        ? 'border-2 border-[#155eef]'
                        : 'border border-[#dbe1ee]'
                  }`}
                >
                  {state === 'done' ? '✓' : state === 'active' ? <span className="h-2 w-2 animate-ping rounded-full bg-[#155eef]" /> : null}
                </span>
                <span
                  className={`text-xs leading-5 ${
                    state === 'done'
                      ? 'font-medium text-[#495975]'
                      : state === 'active'
                        ? 'font-bold text-[#17233a]'
                        : 'text-[#a7b1c4]'
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
