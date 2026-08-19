"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { UIMode } from "@/types";

// ── One-time purge: ล้างงานค้างใน localStorage (2026-08-19 ล้างระบบเริ่มใหม่) ──
//  ร่าง/รีวิว/หัวข้อของ Content Studio และประวัติแชท Mars เก็บใน localStorage
//  รายเครื่อง ลบจากฝั่ง DB ไม่ได้ — โค้ดนี้อยู่ใน module ของ root provider
//  จึงรันก่อน useState ของทุกหน้า และรันครั้งเดียวต่อเบราว์เซอร์ (ปักธงไว้)
//  ถ้าต้องล้างยกชุดอีกในอนาคต ให้เปลี่ยนวันที่ใน PURGE_KEY
const PURGE_KEY = "mars_local_purged_20260819";

if (typeof window !== "undefined" && !localStorage.getItem(PURGE_KEY)) {
  // Content Studio: ข้อมูลงาน
  localStorage.removeItem("content_studio_draft_html");
  localStorage.removeItem("content_studio_review_text");
  localStorage.removeItem("content_studio_review_html");
  // Mars Chat: ประวัติแชททั้งหมด
  localStorage.removeItem("mars_chat_sessions");
  localStorage.removeItem("mars_active_session");
  // ค่าตั้งเครื่อง (สี/ธีม/CTA/ui-mode) เก็บไว้ — ล้างเฉพาะ keyword ที่เป็นข้อมูลงาน
  try {
    const raw = localStorage.getItem("content_studio_settings_v3");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        parsed.keyword = "";
        localStorage.setItem("content_studio_settings_v3", JSON.stringify(parsed));
      }
    }
  } catch {}
  localStorage.setItem(PURGE_KEY, "1");
}

interface UIModeContextValue {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
}

const UIModeContext = createContext<UIModeContextValue>({ mode: "professional", setMode: () => {} });

export function UIModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<UIMode>("professional");

  useEffect(() => {
    const saved = localStorage.getItem("ui-mode") as UIMode | null;
    if (saved === "simple" || saved === "professional") setModeState(saved);
  }, []);

  function setMode(m: UIMode) {
    setModeState(m);
    localStorage.setItem("ui-mode", m);
  }

  return <UIModeContext.Provider value={{ mode, setMode }}>{children}</UIModeContext.Provider>;
}

export function useUIMode() {
  return useContext(UIModeContext);
}
