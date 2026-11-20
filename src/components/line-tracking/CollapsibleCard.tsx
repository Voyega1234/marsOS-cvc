"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_PREFIX = "marsos.lt.card.";

/**
 * Card whose body collapses to save space. The header (title + status badges)
 * stays visible; click it to expand/edit. Server-rendered `header`/`children`
 * are passed in as props.
 *
 * ทุกครั้งที่กด Save / Test หน้าจะถูก render ใหม่จากเซิร์ฟเวอร์ คอมโพเนนต์นี้จึงถูก
 * mount ใหม่และเด้งกลับไปเป็น defaultOpen เสมอ — การ์ดที่เพิ่งปิดไปจะกางกลับมาเอง
 * ทั้งที่ไม่ได้กด ใส่ storageKey แล้วสถานะเปิด/ปิดจะถูกจำไว้ใน localStorage ของเครื่อง
 * (ต่อโปรเจกต์ต่อการ์ด) ปิดแล้วปิดยาวจนกว่าจะกดเปิดเอง
 */
export function CollapsibleCard({
  header,
  children,
  defaultOpen = false,
  storageKey,
  className = "card p-5",
}: {
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** คีย์จำสถานะ — ไม่ใส่ = ไม่จำ (ทำงานเหมือนเดิมทุกอย่าง) */
  storageKey?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // อ่านหลัง mount เท่านั้น ถ้าอ่านตอน render แรก markup จะไม่ตรงกับที่เซิร์ฟเวอร์ส่งมา
  // (hydration mismatch) เพราะเซิร์ฟเวอร์ไม่มีทางรู้ค่าใน localStorage ของเครื่องผู้ใช้
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (saved === "1" || saved === "0") setOpen(saved === "1");
    } catch {
      // โหมดส่วนตัว / ปิด storage ไว้ — ถือว่าไม่เคยจำ ใช้ค่า default ต่อไป
    }
  }, [storageKey]);

  function toggle() {
    // updater ต้องบริสุทธิ์ — เขียน localStorage นอก setState (StrictMode เรียก updater ซ้ำ)
    const next = !open;
    setOpen(next);
    if (storageKey) {
      try {
        window.localStorage.setItem(STORAGE_PREFIX + storageKey, next ? "1" : "0");
      } catch {
        // เขียนไม่ได้ก็ไม่เป็นไร แค่ไม่ถูกจำข้ามการ refresh
      }
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-start justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">{header}</div>
        <span className="mt-1 shrink-0 text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>}
    </div>
  );
}
