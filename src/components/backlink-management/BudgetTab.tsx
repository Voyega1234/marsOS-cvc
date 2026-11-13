"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip, EmptyState, KpiTile, MeterBar, Panel } from "@/components/ds";
import { STATUS_LABEL, type BlmStatus } from "@/lib/backlink-management/types";
import { api, money, type Meta } from "./shared";

interface BudgetRow {
  projectId: string; projectName: string; clientName: string; note: string;
  approved: number; pending: number; reserved: number; actual: number; remaining: number; overBudget: boolean;
  counts: Record<string, number>;
}
interface BudgetResp {
  period: string; rows: BudgetRow[];
  totals: { approved: number; pending: number; reserved: number; actual: number; remaining: number; overBudget: boolean };
}

export default function BudgetTab({ period, projectId, meta, refreshKey }: { period: string; projectId: string; meta: Meta | null; refreshKey: number }) {
  const [data, setData] = useState<BudgetResp | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const canEdit = !!meta?.me.canApprove;

  const load = useCallback(async () => {
    try {
      setData(await api<BudgetResp>(`/api/backlink-management/budgets?period=${period}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    }
  }, [period]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function save(pid: string, note: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return toast.error("งบต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
    setSaving(true);
    try {
      await api("/api/backlink-management/budgets", { method: "PUT", json: { projectId: pid, period, approvedAmount: n, note } });
      toast.success("บันทึกงบแล้ว");
      setEditing(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const rows = projectId ? data.rows.filter((r) => r.projectId === projectId) : data.rows;
  const t = projectId ? rows.reduce((a, r) => ({ approved: a.approved + r.approved, pending: a.pending + r.pending, reserved: a.reserved + r.reserved, actual: a.actual + r.actual, remaining: a.remaining + r.remaining }), { approved: 0, pending: 0, reserved: 0, actual: 0, remaining: 0 }) : data.totals;
  // โปรเจกต์ที่ยังไม่มีแถวงบ/คำขอ ให้ตั้งงบได้จากการเลือกโปรเจกต์ด้านบน
  const selected = projectId && rows.length === 0 ? meta?.projects.find((p) => p.id === projectId) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="อนุมัติ" value={money(t.approved)} tone="blue" />
        <KpiTile label="รออนุมัติ" value={money(t.pending)} tone="warm" hint="ยังไม่นับในงบ" />
        <KpiTile label="กันงบ" value={money(t.reserved)} tone="sky" />
        <KpiTile label="ใช้จริง" value={money(t.actual)} tone="mist" />
        <KpiTile label="คงเหลือ" value={money(t.remaining)} tone={t.remaining < 0 ? "warm" : "navy"} hint={t.remaining < 0 ? "เกินงบ" : undefined} />
      </div>
      <Panel title={`งบรายโปรเจกต์ · ${period}`} padded={false} bodyClassName="p-4 pt-3 md:p-5 md:pt-4">
        {rows.length === 0 && !selected ? (
          <EmptyState title="ยังไม่มีงบหรือคำขอในเดือนนี้" description="เลือกโปรเจกต์ด้านบนเพื่อตั้งงบ หรือสร้างคำขอใหม่" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
            <table className="tbl w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left">โปรเจกต์</th><th className="num">อนุมัติ</th><th className="num">รออนุมัติ</th><th className="num">กันงบ</th>
                  <th className="num">ใช้จริง</th><th className="num">คงเหลือ</th><th className="min-w-[140px] text-left">การใช้งบ</th><th className="text-left">คำขอ</th>
                </tr>
              </thead>
              <tbody>
                {[...rows, ...(selected ? [{ projectId: selected.id, projectName: selected.name, clientName: selected.clientName, note: "", approved: 0, pending: 0, reserved: 0, actual: 0, remaining: 0, overBudget: false, counts: {} as Record<string, number> }] : [])].map((r) => {
                  const used = r.reserved + r.actual;
                  return (
                    <tr key={r.projectId}>
                      <td className="whitespace-nowrap">{r.projectName}</td>
                      <td className="num whitespace-nowrap">
                        {editing === r.projectId ? (
                          <span className="inline-flex items-center gap-1">
                            <Input type="number" min={0} className="h-8 w-28" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
                            <Button size="sm" className="h-8 px-2" disabled={saving} onClick={() => save(r.projectId, r.note)}><Check className="h-3.5 w-3.5" /></Button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {money(r.approved)}
                            {canEdit ? (
                              <button type="button" aria-label="แก้งบ" className="p-1 text-gray-400 hover:text-brand-navy" onClick={() => { setEditing(r.projectId); setVal(String(r.approved)); }}>
                                <Pencil className="h-3 w-3" />
                              </button>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="num whitespace-nowrap">{money(r.pending)}</td>
                      <td className="num whitespace-nowrap">{money(r.reserved)}</td>
                      <td className="num whitespace-nowrap">{money(r.actual)}</td>
                      <td className={`num whitespace-nowrap ${r.overBudget ? "font-semibold text-red-600" : ""}`}>{money(r.remaining)}</td>
                      <td><MeterBar value={used} max={r.approved || 1} tone={r.overBudget || (!r.approved && used > 0) ? "bad" : used / (r.approved || 1) > 0.8 ? "warn" : "ok"} ariaLabel="การใช้งบ" /></td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(r.counts).map(([s, c]) => <Chip key={s} tone="muted">{STATUS_LABEL[s as BlmStatus] ?? s} {c}</Chip>)}
                          {r.overBudget ? <Chip tone="bad">เกินงบ</Chip> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!canEdit ? <p className="mt-2 text-xs text-gray-400">เฉพาะ ADMIN / SEO Manager เท่านั้นที่ตั้งงบได้</p> : null}
      </Panel>
    </div>
  );
}
