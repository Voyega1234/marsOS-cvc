"use client";

/** รายการหมวดของเว็บ PBN โครง magazine (khaoduan / roothan) — โหลดครั้งเดียวต่อเว็บ ใช้ร่วมกันทั้งหน้า Write และ Push */
import { useEffect, useRef, useState } from "react";
import type { PbnSiteDTO } from "@/lib/upload-article/pbn";
import type { MagazineSection } from "@/lib/upload-article/pbn-magazine";

export type SiteClustersState = { status: "loading" | "ok" | "error"; sections?: MagazineSection[]; error?: string };

/** enabled=false (หน้า Upload Article) = ไม่โหลดอะไรเลย */
export function useMagazineClusters(enabled: boolean, sites: PbnSiteDTO[]): Record<string, SiteClustersState> {
  const [siteClusters, setSiteClusters] = useState<Record<string, SiteClustersState>>({});
  const requested = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled) return;
    for (const site of sites) {
      if (site.ghLayout !== "magazine" || requested.current.has(site.id)) continue;
      requested.current.add(site.id);
      setSiteClusters(prev => ({ ...prev, [site.id]: { status: "loading" } }));
      fetch(`/api/pbn-backlinks/sites/${site.id}/clusters`)
        .then(async r => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !Array.isArray(d.sections)) {
            setSiteClusters(prev => ({ ...prev, [site.id]: { status: "error", error: d?.error || "โหลดรายการหมวดไม่สำเร็จ" } }));
          } else {
            setSiteClusters(prev => ({ ...prev, [site.id]: { status: "ok", sections: d.sections as MagazineSection[] } }));
          }
        })
        .catch(e => {
          setSiteClusters(prev => ({ ...prev, [site.id]: { status: "error", error: e instanceof Error && e.message ? e.message : "โหลดรายการหมวดไม่สำเร็จ" } }));
        });
    }
  }, [enabled, sites]);
  return siteClusters;
}
