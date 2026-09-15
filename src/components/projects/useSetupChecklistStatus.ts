"use client";

/**
 * useSetupChecklistStatus — ดึงสถานะ setup checklist ของโปรเจกต์แบบเบา ๆ
 * ใช้แสดง badge สีแดงบนปุ่มฟันเฟือง (Project Settings) เวลายังตั้งค่าไม่ครบ
 * แยกไฟล์ออกมาเพื่อไม่ต้องแก้ ClientDetailTabs.tsx เยอะ (ไฟล์ใหญ่มาก)
 */
import { useCallback, useEffect, useState } from "react";

export interface SetupChecklistStatus {
  missingRequired: number;
  doneCount: number;
  totalCount: number;
}

export function useSetupChecklistStatus(projectId: string, refreshKey?: unknown) {
  const [status, setStatus] = useState<SetupChecklistStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/setup-checklist`);
      if (!r.ok) return;
      const d = await r.json();
      setStatus({ missingRequired: d.missingRequired ?? 0, doneCount: d.doneCount ?? 0, totalCount: d.totalCount ?? 0 });
    } catch {
      /* เงียบ — badge ไม่ขึ้นถ้าดึงไม่ได้ ไม่ใช่ error ที่ต้องแจ้งผู้ใช้ */
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  return { status, refresh };
}
