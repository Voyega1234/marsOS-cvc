"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Panel } from "@/components/ds";
import { CHECK_LABEL, CHECK_TONE, STATUS_LABEL, STATUS_TONE, type BlmStatus, type CheckStatus } from "@/lib/backlink-management/types";
import { api, fmtDateTime, useAutoRefresh, type BlmRow } from "./shared";

export default function TrackingTab({ projectId, period, refreshKey, onOpen, onChanged }: {
  projectId: string; period: string; refreshKey: number; onOpen: (id: string) => void; onChanged: () => void;
}) {
  const [rows, setRows] = useState<BlmRow[] | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [all, setAll] = useState<{ done: number; remaining: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (projectId) p.set("projectId", projectId);
      if (period) p.set("period", period);
      const d = await api<{ requests: BlmRow[] }>(`/api/backlink-management/requests?${p}`);
      setRows(d.requests.filter((r) => r.liveUrl));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
      setRows([]);
    }
  }, [projectId, period]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useAutoRefresh(() => { if (!all && !checking) void load(); });

  async function checkOne(id: string) {
    setChecking(id);
    try {
      await api(`/api/backlink-management/requests/${id}/verify`, { method: "POST" });
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ตรวจไม่สำเร็จ");
    } finally {
      setChecking(null);
    }
  }

  async function checkAll() {
    const before = new Date().toISOString();
    let done = 0;
    setAll({ done: 0, remaining: 0 });
    try {
      for (let i = 0; i < 100; i++) {
        const d = await api<{ checked: number; remaining: number }>("/api/backlink-management/verify-batch", { method: "POST", json: { before } });
        done += d.checked;
        setAll({ done, remaining: d.remaining });
        if (d.remaining <= 0 || d.checked === 0) break;
      }
      toast.success(`ตรวจแล้ว ${done} ลิงก์`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ตรวจไม่สำเร็จ");
    } finally {
      setAll(null);
      await load();
      onChanged();
    }
  }

  return (
    <Panel
      title="ติดตามลิงก์"
      subtitle="ตรวจว่าหน้าที่ลิงก์อยู่ยังมีลิงก์ชี้มาหน้าลูกค้าและเป็น follow"
      actions={
        <Button size="sm" onClick={checkAll} disabled={!!all}>
          {all ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}
          {all ? `กำลังตรวจ ${all.done} · เหลือ ${all.remaining}` : "ตรวจทั้งหมด"}
        </Button>
      }
    >
      {rows === null ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="ยังไม่มีลิงก์ที่เผยแพร่" description="เมื่อบันทึกว่าเผยแพร่แล้วพร้อม URL ลิงก์จะมาแสดงที่นี่" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">โปรเจกต์</th><th className="text-left">URL ที่ลิงก์อยู่</th><th className="text-left">สถานะคำขอ</th>
                <th className="text-left">ผลตรวจ</th><th className="text-left">ตรวจล่าสุด</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{r.projectName}</td>
                  <td className="max-w-[280px]">
                    <a href={r.liveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-brand-blue">
                      <span className="truncate">{r.liveUrl}</span><ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </td>
                  <td><Chip tone={STATUS_TONE[r.status as BlmStatus] ?? "muted"}>{STATUS_LABEL[r.status as BlmStatus] ?? r.status}</Chip></td>
                  <td>
                    {r.checkStatus ? (
                      <Chip tone={CHECK_TONE[r.checkStatus as CheckStatus] ?? "muted"} title={r.checkDetail}>{CHECK_LABEL[r.checkStatus as CheckStatus] ?? r.checkStatus}</Chip>
                    ) : <span className="text-gray-400">ยังไม่ตรวจ</span>}
                  </td>
                  <td className="whitespace-nowrap">{fmtDateTime(r.lastCheckedAt)}</td>
                  <td className="whitespace-nowrap">
                    <Button size="sm" variant="outline" className="h-8" disabled={checking === r.id || !!all} onClick={() => checkOne(r.id)}>
                      {checking === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "ตรวจลิงก์"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => onOpen(r.id)}>รายละเอียด</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
