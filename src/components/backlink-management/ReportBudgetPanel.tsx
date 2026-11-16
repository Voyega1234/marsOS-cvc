"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Chip, EmptyState, KpiTile, MeterBar, Panel } from "@/components/ds";
import { affordableSites } from "@/lib/backlink-management/affordable";
import { api, money, type Vendor } from "./shared";
import SearchSelect from "./SearchSelect";

export interface BudgetRow {
  projectId: string; projectName: string; clientName: string; note: string;
  approved: number; pending: number; reserved: number; actual: number; remaining: number; overBudget: boolean;
  counts: Record<string, number>;
}
export interface Totals { approved: number; pending: number; reserved: number; actual: number; remaining: number; overBudget?: boolean }
interface BudgetResp { period: string; rows: BudgetRow[]; totals: Totals }

export default function ReportBudgetPanel({ period, projectId, onData }: {
  period: string; projectId: string;
  onData?: (d: { period: string; rows: BudgetRow[]; totals: Totals } | null) => void;
}) {
  const [data, setData] = useState<BudgetResp | null>(null);
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [vendorsFailed, setVendorsFailed] = useState(false);
  const [error, setError] = useState(false);
  const [choice, setChoice] = useState("");
  const seq = useRef(0);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(period)) return;
    const my = ++seq.current;
    setError(false);
    (async () => {
      try {
        const b = await api<BudgetResp>(`/api/backlink-management/budgets?period=${period}`);
        if (my !== seq.current) return;
        setData(b);
        onDataRef.current?.({ period: b.period ?? period, rows: b.rows, totals: b.totals });
      } catch (e) {
        if (my !== seq.current) return;
        setError(true);
        setData(null);
        onDataRef.current?.(null);
        toast.error(e instanceof Error ? e.message : "โหลดงบประมาณไม่สำเร็จ");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await api<{ vendors: Vendor[] }>("/api/backlink-management/vendors?status=ACTIVE");
        if (!cancelled) setVendors(v.vendors ?? []);
      } catch {
        // คลังเว็บโหลดไม่ได้ ไม่กระทบตัวเลขงบ — แค่บอกว่าโหลดไม่สำเร็จแทนการค้างที่ "กำลังโหลด"
        if (!cancelled) setVendorsFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return projectId ? data.rows.filter((r) => r.projectId === projectId) : data.rows;
  }, [data, projectId]);
  const t: Totals | null = useMemo(() => {
    if (!data) return null;
    return projectId
      ? rows.reduce((a, r) => ({ approved: a.approved + r.approved, pending: a.pending + r.pending, reserved: a.reserved + r.reserved, actual: a.actual + r.actual, remaining: a.remaining + r.remaining }), { approved: 0, pending: 0, reserved: 0, actual: 0, remaining: 0 })
      : data.totals;
  }, [data, projectId, rows]);

  const selectedId = useMemo(() => {
    if (rows.some((r) => r.projectId === choice)) return choice;
    if (projectId && rows.some((r) => r.projectId === projectId)) return projectId;
    return rows.reduce<BudgetRow | null>((best, r) => (!best || r.remaining > best.remaining ? r : best), null)?.projectId ?? "";
  }, [rows, choice, projectId]);
  const selectedRow = rows.find((r) => r.projectId === selectedId) ?? null;

  const result = useMemo(() => (vendors && selectedRow ? affordableSites(selectedRow.remaining, vendors) : null), [vendors, selectedRow]);

  if (error) return <Panel title={`งบประมาณเดือน ${period}`}><p className="text-sm text-red-600">โหลดข้อมูลงบประมาณไม่สำเร็จ</p></Panel>;
  if (!data || !t) return <Panel title={`งบประมาณเดือน ${period}`}><p className="text-sm text-gray-400">กำลังโหลด...</p></Panel>;

  const used = t.reserved + t.actual;
  const over = t.remaining < 0;

  return (
    <div className="space-y-4">
      <Panel title={`งบประมาณเดือน ${period}`} padded={false} bodyClassName="p-4 pt-3 md:p-5 md:pt-4">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label="งบที่อนุมัติ" value={money(t.approved)} tone="blue" />
            <KpiTile label="ใช้ไปแล้ว" value={money(used)} tone="sky" hint={`กันงบ ${money(t.reserved)} · จ่ายจริง ${money(t.actual)}`} />
            <KpiTile label="คงเหลือ" value={money(t.remaining)} tone={over ? "warm" : "navy"} hint={over ? "เกินงบ" : undefined} />
            <KpiTile label="รออนุมัติ" value={money(t.pending)} tone="warm" hint="ยังไม่นับในงบ" />
          </div>
          <MeterBar value={used} max={t.approved || 1} tone={over || (!t.approved && used > 0) ? "bad" : used / (t.approved || 1) > 0.8 ? "warn" : "ok"} ariaLabel="การใช้งบ" />
          {rows.length === 0 ? (
            <EmptyState title="ยังไม่ได้ตั้งงบหรือมีคำขอในเดือนนี้" description="ตั้งงบได้ที่แท็บ งบประมาณ" />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
              <table className="tbl w-full text-xs">
                <thead><tr><th className="text-left">โปรเจกต์</th><th className="num">งบที่อนุมัติ</th><th className="num">ใช้ไปแล้ว</th><th className="num">คงเหลือ</th><th className="num">เว็บที่ซื้อได้</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.projectId}>
                      <td>{r.projectName}</td>
                      <td className="num whitespace-nowrap">{money(r.approved)}</td>
                      <td className="num whitespace-nowrap">{money(r.reserved + r.actual)}</td>
                      <td className={`num whitespace-nowrap ${r.overBudget ? "font-semibold text-red-600" : ""}`}>{money(r.remaining)}</td>
                      <td className="num">{vendors ? affordableSites(r.remaining, vendors).total : "—"}</td>
                      <td><button type="button" className="rounded-lg border border-input bg-white/90 px-2 py-1 text-xs hover:bg-gray-50" onClick={() => setChoice(r.projectId)}>ดูเว็บ</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="งบที่เหลือซื้ออะไรได้บ้าง">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่มีงบในเดือนนี้</p>
        ) : (
          <div className="space-y-3">
            <SearchSelect
              className="!w-auto min-w-[200px]"
              value={selectedId}
              onChange={setChoice}
              ariaLabel="เลือกโปรเจกต์"
              options={rows.map((r) => ({ value: r.projectId, label: r.projectName, hint: r.clientName || undefined }))}
            />
            {vendorsFailed ? (
              <p className="text-sm text-red-600">โหลดคลังเว็บไม่สำเร็จ — รีเฟรชหน้าเพื่อลองใหม่</p>
            ) : !selectedRow || !result ? (
              <p className="text-sm text-gray-400">กำลังโหลดคลังเว็บ...</p>
            ) : selectedRow.remaining <= 0 ? (
              <p className="text-sm text-gray-500">งบเดือนนี้ไม่เหลือแล้ว</p>
            ) : result.pricedSites === 0 ? (
              <p className="text-sm text-gray-500">คลังเว็บยังไม่มีเว็บที่ใส่ราคา</p>
            ) : result.total === 0 ? (
              <p className="text-sm text-gray-500">{`งบคงเหลือไม่พอสำหรับเว็บใดในคลัง (ราคาถูกสุด ${money(result.cheapest)})`}</p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  {`งบคงเหลือ ${money(selectedRow.remaining)} · ซื้อได้ ${result.total} เว็บ จาก ${result.pricedSites} เว็บที่มีราคาในคลัง · ราคาถูกสุด ${money(result.cheapest)} · ถ้าเลือกเว็บราคาถูกสุดก่อน ซื้อได้สูงสุด ${result.greedyCount} เว็บ (เว็บละ 1 ลิงก์ รวม ${money(result.greedyCost)})`}
                </p>
                <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
                  <table className="tbl w-full text-xs">
                    <thead><tr><th className="text-left">เว็บ</th><th className="text-left">หมวด</th><th className="num">DR</th><th className="num">Traffic</th><th className="text-left">ราคาที่ซื้อได้</th><th className="num">ซื้อได้สูงสุด</th></tr></thead>
                    <tbody>
                      {result.sites.map((s) => (
                        <tr key={s.id}>
                          <td>{s.domain}</td>
                          <td>{s.category || "—"}</td>
                          <td className="num">{s.domainRating ?? "—"}</td>
                          <td className="num">{s.traffic !== null ? s.traffic.toLocaleString("th-TH") : "—"}</td>
                          <td><div className="flex flex-wrap gap-1">{s.options.map((o) => <Chip key={o.label} tone="muted">{`${o.label} ${o.price.toLocaleString("th-TH")}`}</Chip>)}</div></td>
                          <td className="num whitespace-nowrap">{`${s.maxLinks} ลิงก์`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.total > result.sites.length ? <p className="text-xs text-gray-400">{`แสดง ${result.sites.length} จาก ${result.total} เว็บ (เรียงตาม DR สูงสุด)`}</p> : null}
              </>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
