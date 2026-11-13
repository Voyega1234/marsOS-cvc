"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Panel, SearchPill } from "@/components/ds";
import { STATUS_LABEL, STATUS_TONE, BLM_STATUSES, type BlmStatus } from "@/lib/backlink-management/types";
import { api, fmtDate, money, selectCls, useAutoRefresh, type BlmRow } from "./shared";

export default function RequestsTab({ projectId, period, refreshKey, onOpen, onCreate }: {
  projectId: string;
  period: string;
  refreshKey: number;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [rows, setRows] = useState<BlmRow[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (projectId) p.set("projectId", projectId);
      if (period) p.set("period", period);
      if (status) p.set("status", status);
      if (dq) p.set("q", dq);
      const d = await api<{ requests: BlmRow[] }>(`/api/backlink-management/requests?${p}`);
      setRows(d.requests);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [projectId, period, status, dq]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useAutoRefresh(() => void load());

  return (
    <Panel
      title="คำขอ backlink"
      subtitle={rows ? `${rows.length.toLocaleString()} รายการ` : undefined}
      actions={<Button size="sm" onClick={onCreate}><Plus className="mr-1 h-4 w-4" /> สร้างคำขอ</Button>}
      padded={false}
      bodyClassName="p-4 pt-3 md:p-5 md:pt-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหาเว็บ / URL / anchor / keyword" className="w-full sm:w-72" />
        <select className={`${selectCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="กรองสถานะ">
          <option value="">ทุกสถานะ</option>
          {BLM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : null}
      </div>
      {error ? <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
      {rows === null ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="ยังไม่มีคำขอ" description="กด “สร้างคำขอ” เพื่อเริ่มขอ backlink" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">โปรเจกต์</th>
                <th className="text-left">เว็บที่ฝาก</th>
                <th className="text-left">หน้าลูกค้า / Anchor</th>
                <th className="num">ราคา</th>
                <th className="text-left">เดือน</th>
                <th className="text-left">สถานะ</th>
                <th className="text-left">ผู้รับผิดชอบ</th>
                <th className="text-left">กำหนดส่ง</th>
                <th className="text-left">Asana</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-brand-mist/40" onClick={() => onOpen(r.id)}>
                  <td className="whitespace-nowrap">{r.projectName}</td>
                  <td className="whitespace-nowrap">{r.vendorDomain || <span className="text-gray-400">ยังไม่เลือกเว็บ</span>}</td>
                  <td className="max-w-[260px]">
                    <div className="truncate" title={r.targetUrl}>{r.targetUrl}</div>
                    <div className="truncate text-gray-400">{r.anchorText || r.keyword || "—"}</div>
                  </td>
                  <td className="num whitespace-nowrap">{money(r.actualPrice ?? r.quotedPrice)}</td>
                  <td className="whitespace-nowrap">{r.budgetPeriod}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <Chip tone={STATUS_TONE[r.status as BlmStatus] ?? "muted"}>{STATUS_LABEL[r.status as BlmStatus] ?? r.status}</Chip>
                      {r.asanaCompleted && !r.liveUrl && (r.status === "APPROVED" || r.status === "IN_PROGRESS") ? (
                        <Chip tone="warn">Asana เสร็จแล้ว — รอใส่ URL ที่ลิงก์อยู่</Chip>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{r.assigneeName || "—"}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.dueDate)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {r.asanaTaskUrl ? (
                        <a href={r.asanaTaskUrl} target="_blank" rel="noopener noreferrer" className="text-brand-blue" aria-label="เปิดงานใน Asana">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                      {r.asanaSyncError ? <Chip tone="warn" title={r.asanaSyncError}>sync ผิดพลาด</Chip> : null}
                    </div>
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
