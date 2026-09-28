"use client";

/**
 * PBN Backlinks > Report — รายงาน GSC / GA4 แยกตามเว็บ PBN
 * ทีมเลือกเองว่าจะดูเว็บไหน (ผูก GSC property / GA4 property ต่อเว็บที่ Project Setting > เว็บ PBN & Connect)
 * ใช้หน้ารายงานชุดเดียวกับ SEO SME (ClientReportClient) แบบฝัง
 */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientReportClient } from "@/components/report/ClientReportClient";
import { usePbnSites } from "./usePbnSites";

const SELECTED_KEY = "pbn-report-site";

export default function PbnReportTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { sites, loading, error } = usePbnSites();
  const reportable = useMemo(() => sites.filter(s => s.gscSiteUrl || s.ga4PropertyId), [sites]);
  const [siteId, setSiteId] = useState("");

  // จำเว็บที่ดูล่าสุดไว้ในเบราว์เซอร์นี้ (สะดวกเฉย ๆ — ไม่มีก็เลือกเว็บแรก)
  useEffect(() => {
    if (!reportable.length || reportable.some(s => s.id === siteId)) return;
    let saved = "";
    try { saved = localStorage.getItem(SELECTED_KEY) ?? ""; } catch { /* ignore */ }
    setSiteId(reportable.some(s => s.id === saved) ? saved : reportable[0].id);
  }, [reportable, siteId]);

  function choose(id: string) {
    setSiteId(id);
    try { localStorage.setItem(SELECTED_KEY, id); } catch { /* ignore */ }
  }

  const site = reportable.find(s => s.id === siteId) ?? null;

  if (loading) {
    return <p className="text-xs text-gray-400 flex items-center gap-1.5 py-10 justify-center"><Loader2 size={12} className="animate-spin" /> กำลังโหลด...</p>;
  }
  if (error) return <p className="text-sm text-red-600 py-10 text-center">{error}</p>;

  if (!reportable.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center space-y-3">
        <BarChart3 size={28} className="mx-auto text-gray-300" />
        <p className="text-sm text-gray-500">
          {sites.length ? "ยังไม่มีเว็บ PBN ที่ผูก GSC หรือ GA4" : "ยังไม่มีเว็บ PBN"} — ผูก property ต่อเว็บได้ที่ Project Setting
        </p>
        <Button size="sm" variant="outline" onClick={onOpenSettings}>ไปที่ เว็บ PBN & Connect</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
        <label htmlFor="pbn-report-site" className="text-xs font-semibold text-gray-600">ดูรายงานของเว็บ</label>
        <select id="pbn-report-site" value={siteId} onChange={e => choose(e.target.value)}
          className="h-9 min-w-[240px] rounded-md border border-gray-200 px-3 text-sm bg-white">
          {reportable.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} — {[s.gscSiteUrl && "GSC", s.ga4PropertyId && "GA4"].filter(Boolean).join(" + ")}
            </option>
          ))}
        </select>
        {sites.length > reportable.length && (
          <span className="text-[11px] text-gray-400">อีก {sites.length - reportable.length} เว็บยังไม่ผูก GSC/GA4</span>
        )}
      </div>

      {site && (
        <ClientReportClient
          key={site.id}
          embedded
          setupHint="ผูก GSC / GA4 ของเว็บนี้ที่ Project Setting › เว็บ PBN & Connect"
          project={{
            id: site.id,
            name: site.name,
            website: site.siteUrl,
            gscSiteUrl: site.gscSiteUrl || null,
            ga4PropertyId: site.ga4PropertyId || null,
          }}
        />
      )}
    </div>
  );
}
