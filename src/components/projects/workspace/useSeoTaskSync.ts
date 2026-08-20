"use client";

/**
 * useSeoTaskSync — ตัวประสาน SeoTask ให้ทุกหน้าที่เกี่ยวข้องเห็นตรงกัน
 *
 * SeoTask มี source of truth เดียว (ตาราง SeoTask) แต่แต่ละแท็บ/หน้าต่างโหลด
 * ข้อมูลของตัวเองแยกกัน พอสร้าง/แก้/ลบ task ที่หน้าใดหน้าหนึ่ง หน้าอื่นจะยังค้าง
 * ตัวเลขเก่าจนกว่าจะ remount ไฟล์นี้อุดช่องนั้นด้วย 3 สัญญาณ:
 *   1) same-window CustomEvent — panel อื่นในหน้าเดียวกัน (เช่น overview + timeline)
 *   2) storage event         — แท็บ/หน้าต่าง browser อื่นของโปรเจกต์เดียวกัน
 *   3) window focus           — กันเคสเปิดค้างไว้แล้วข้อมูลถูกแก้ที่อื่น
 *
 * ทุกอย่างกรองด้วย projectId เสมอ — โปรเจกต์อื่นจะไม่พลอย refetch ตาม
 */

import { useEffect } from "react";

const CHANNEL = "seo-tasks:changed";

interface ChangePayload {
  projectId: string;
  /** id ของ component ที่เป็นคนแจ้ง — ใช้กันตัวเองไม่ให้ refetch ซ้ำใน same-window */
  sourceId?: string;
  ts?: number;
}

/** เรียกหลัง mutation (create / update / delete) ของ SeoTask สำเร็จ */
export function notifySeoTaskChange(projectId: string, sourceId?: string): void {
  if (typeof window === "undefined") return;
  const payload: ChangePayload = { projectId, sourceId, ts: Date.now() };
  // 1) same-window: แจ้ง component อื่นในหน้าเดียวกันทันที
  window.dispatchEvent(new CustomEvent<ChangePayload>(CHANNEL, { detail: payload }));
  // 2) cross-tab: เขียน localStorage เพื่อให้แท็บอื่นได้ storage event (แท็บนี้จะไม่ได้เอง)
  try {
    localStorage.setItem(CHANNEL, JSON.stringify(payload));
  } catch {
    /* private mode อาจปิด localStorage — ข้ามไป ไม่ให้พัง */
  }
}

/**
 * subscribe การเปลี่ยนแปลง SeoTask ของโปรเจกต์นี้ แล้วเรียก onChange เพื่อ refetch
 *
 * onChange ควรเป็น "quiet refetch" (ไม่ toggle loading ให้ skeleton กระพริบ)
 * sourceId ใส่ค่าเดียวกับที่ component นี้ใช้ตอน notify เพื่อกัน refetch ซ้ำของตัวเอง
 */
export function useSeoTaskSync(
  projectId: string,
  onChange: () => void,
  sourceId?: string
): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleCustom = (e: Event) => {
      const detail = (e as CustomEvent<ChangePayload>).detail;
      if (!detail || detail.projectId !== projectId) return;
      if (sourceId && detail.sourceId === sourceId) return; // ตัวเองที่เพิ่งแจ้ง — ข้าม
      onChange();
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== CHANNEL || !e.newValue) return;
      try {
        const detail = JSON.parse(e.newValue) as ChangePayload;
        if (detail.projectId === projectId) onChange();
      } catch {
        /* ค่าที่ parse ไม่ได้ — ข้าม */
      }
    };
    const handleFocus = () => onChange();

    window.addEventListener(CHANNEL, handleCustom as EventListener);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener(CHANNEL, handleCustom as EventListener);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [projectId, onChange, sourceId]);
}
