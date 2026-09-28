"use client";

/** โหลดรายการเว็บ PBN (ไม่มี secret) + ประวัติ push ต่อบทความต่อเว็บ */
import { useCallback, useEffect, useState } from "react";
import type { PbnPushes, PbnSiteDTO } from "@/lib/upload-article/pbn";

/** enabled=false (หน้า Upload Article) = ไม่โหลดอะไรเลย */
export function usePbnSites(enabled = true) {
  const [sites, setSites] = useState<PbnSiteDTO[]>([]);
  const [pushes, setPushes] = useState<PbnPushes>({});
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/pbn-backlinks/sites", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `โหลดเว็บ PBN ไม่สำเร็จ (${r.status})`);
      setSites(Array.isArray(d.sites) ? d.sites : []);
      setPushes(d.pushes && typeof d.pushes === "object" ? d.pushes : {});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);

  return { sites, setSites, pushes, loading, error, reload };
}
