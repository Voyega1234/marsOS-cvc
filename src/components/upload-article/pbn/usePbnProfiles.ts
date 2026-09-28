"use client";

/** โหลด set ข้อมูลโปรเจกต์ PBN เพิ่มเติม (set หลัก = website / language ของโปรเจกต์ PBN เอง) */
import { useCallback, useEffect, useState } from "react";
import type { PbnProfile } from "@/lib/upload-article/pbn-sets";

/** enabled=false (หน้า Upload Article) = ไม่โหลดอะไรเลย */
export function usePbnProfiles(enabled = true) {
  const [profiles, setProfiles] = useState<PbnProfile[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/pbn-backlinks/profiles", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `โหลด set ข้อมูลโปรเจกต์ไม่สำเร็จ (${r.status})`);
      setProfiles(Array.isArray(d.profiles) ? d.profiles : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);

  return { profiles, setProfiles, loading, error, reload };
}
