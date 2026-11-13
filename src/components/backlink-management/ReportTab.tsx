"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BarChart, DonutChart, KpiTile, Panel, downloadCsv } from "@/components/ds";
import { STATUS_LABEL, type BlmStatus } from "@/lib/backlink-management/types";
import { api, money } from "./shared";

interface Report {
  from: string; to: string;
  totals: { requests: number; published: number; verifiedLive: number; lost: number; nofollow: number; spendActual: number; costPerLiveLink: number | null };
  byMonth: { period: string; requests: number; published: number; live: number; spend: number }[];
  byProject: { projectId: string; projectName: string; requests: number; published: number; live: number; lost: number; spend: number; costPerLive: number | null }[];
  byVendor: { domain: string; requests: number; published: number; live: number; spend: number; liveRate: number | null }[];
  byStatus: { status: string; count: number }[];
}

export default function ReportTab({ period }: { period: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(period);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      setData(await api<Report>(`/api/backlink-management/report?${p}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    if (!data) return;
    const rows: (string | number | null)[][] = [
      [`รายงาน Backlink ${data.from} ถึง ${data.to}`],
      [],
      ["เดือน", "คำขอ", "เผยแพร่", "ลิงก์ปกติ", "ค่าใช้จ่ายจริง"],
      ...data.byMonth.map((m) => [m.period, m.requests, m.published, m.live, m.spend]),
      [],
      ["โปรเจกต์", "คำขอ", "เผยแพร่", "ลิงก์ปกติ", "ลิงก์หาย", "ค่าใช้จ่ายจริง", "ต้นทุนต่อลิงก์ปกติ"],
      ...data.byProject.map((p) => [p.projectName, p.requests, p.published, p.live, p.lost, p.spend, p.costPerLive]),
      [],
      ["เว็บ", "คำขอ", "เผยแพร่", "ลิงก์ปกติ", "ค่าใช้จ่ายจริง", "% ลิงก์ยังอยู่"],
      ...data.byVendor.map((v) => [v.domain, v.requests, v.published, v.live, v.spend, v.liveRate]),
    ];
    downloadCsv(`backlink-report-${data.from}_${data.to}.csv`, rows);
  }

  if (!data) return <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const t = data.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500">จากเดือน<input type="month" value={from || data.from} onChange={(e) => setFrom(e.target.value)} className="ml-2 h-9 rounded-xl border border-input bg-white/90 px-2 text-sm" /></label>
        <label className="text-xs text-gray-500">ถึงเดือน<input type="month" value={to || data.to} onChange={(e) => setTo(e.target.value)} className="ml-2 h-9 rounded-xl border border-input bg-white/90 px-2 text-sm" /></label>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : null}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1 h-4 w-4" /> Export CSV</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="คำขอทั้งหมด" value={t.requests.toLocaleString()} tone="blue" />
        <KpiTile label="เผยแพร่แล้ว" value={t.published.toLocaleString()} tone="sky" />
        <KpiTile label="ลิงก์ปกติ (ตรวจแล้ว)" value={t.verifiedLive.toLocaleString()} tone="mist" hint={`หาย ${t.lost} · nofollow ${t.nofollow}`} />
        <KpiTile label="ใช้จริง" value={money(t.spendActual)} tone="navy" hint={t.costPerLiveLink !== null ? `ต้นทุนต่อลิงก์ปกติ ${money(t.costPerLiveLink)}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="ค่าใช้จ่ายรายเดือน" className="lg:col-span-2">
          <BarChart data={data.byMonth.map((m) => ({ label: m.period, value: m.spend }))} formatValue={(n) => money(n)} ariaLabel="ค่าใช้จ่ายรายเดือน" />
        </Panel>
        <Panel title="สถานะคำขอ">
          <DonutChart segments={data.byStatus.map((s) => ({ label: STATUS_LABEL[s.status as BlmStatus] ?? s.status, value: s.count }))} centerValue={t.requests} centerLabel="คำขอ" ariaLabel="สัดส่วนสถานะ" />
        </Panel>
      </div>

      <Panel title="รายโปรเจกต์" padded={false} bodyClassName="p-4 pt-3 md:p-5 md:pt-4">
        <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
          <table className="tbl w-full text-xs">
            <thead><tr><th className="text-left">โปรเจกต์</th><th className="num">คำขอ</th><th className="num">เผยแพร่</th><th className="num">ปกติ</th><th className="num">หาย</th><th className="num">ใช้จริง</th><th className="num">ต้นทุน/ลิงก์ปกติ</th></tr></thead>
            <tbody>
              {data.byProject.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-gray-400">ไม่มีข้อมูล</td></tr> : data.byProject.map((p) => (
                <tr key={p.projectId}><td>{p.projectName}</td><td className="num">{p.requests}</td><td className="num">{p.published}</td><td className="num">{p.live}</td><td className="num">{p.lost}</td><td className="num">{money(p.spend)}</td><td className="num">{p.costPerLive !== null ? money(p.costPerLive) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="เว็บที่ใช้จ่ายสูงสุด 20 อันดับ" padded={false} bodyClassName="p-4 pt-3 md:p-5 md:pt-4">
        <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
          <table className="tbl w-full text-xs">
            <thead><tr><th className="text-left">เว็บ</th><th className="num">คำขอ</th><th className="num">เผยแพร่</th><th className="num">ปกติ</th><th className="num">ใช้จริง</th><th className="num">% ลิงก์ยังอยู่</th></tr></thead>
            <tbody>
              {data.byVendor.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-400">ไม่มีข้อมูล</td></tr> : data.byVendor.map((v) => (
                <tr key={v.domain}><td>{v.domain}</td><td className="num">{v.requests}</td><td className="num">{v.published}</td><td className="num">{v.live}</td><td className="num">{money(v.spend)}</td><td className="num">{v.liveRate !== null ? `${v.liveRate}%` : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
