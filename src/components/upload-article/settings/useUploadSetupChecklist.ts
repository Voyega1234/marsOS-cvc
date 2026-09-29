"use client";

/**
 * useUploadSetupChecklist — ดึงสถานะ setup checklist ของลูกค้า Upload Article แบบเบา ๆ
 * ใช้แสดง badge สีแดงบนปุ่ม Project Setting เวลายังตั้งค่าไม่ครบ (PBN ไม่ใช้ — enabled=false)
 */
import { useCallback, useEffect, useState } from "react";

export interface UploadSetupChecklistStatus {
  missingRequired: number;
  doneCount: number;
  totalCount: number;
}

export function useUploadSetupChecklist(clientId: string, enabled: boolean, refreshKey?: unknown) {
  const [status, setStatus] = useState<UploadSetupChecklistStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await fetch(`/api/upload-article/clients/${clientId}/setup-checklist`);
      if (!r.ok) return;
      const d = await r.json();
      setStatus({ missingRequired: d.missingRequired ?? 0, doneCount: d.doneCount ?? 0, totalCount: d.totalCount ?? 0 });
    } catch {
      /* เงียบ — badge ไม่ขึ้นถ้าดึงไม่ได้ ไม่ใช่ error ที่ต้องแจ้งผู้ใช้ */
    }
  }, [clientId, enabled]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  return { status: enabled ? status : null, setStatus, refresh };
}
