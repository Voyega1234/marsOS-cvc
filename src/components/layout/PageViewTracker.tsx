"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** เปิดหน้าเดิมซ้ำภายในเวลานี้ = ไม่จดซ้ำ (กัน refresh/สลับแท็บรัว ๆ) */
const SAME_PAGE_GAP_MS = 60_000;

/** จด Activity Log ทุกครั้งที่ผู้ใช้เปลี่ยนหน้า (ใครเปิดหน้าไหน เมื่อไร) — ไม่มี UI */
export function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const now = Date.now();
    if (last.current && last.current.path === pathname && now - last.current.at < SAME_PAGE_GAP_MS) return;
    last.current = { path: pathname, at: now };
    fetch("/api/activity-logs/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "view", path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
