"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Panel } from "@/components/ds";
import { AUDIT_ACTION_LABEL } from "@/lib/compliance/types";
import { api, fmtDateTime } from "./shared";

interface AuditRow {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  actorName: string;
  actorId: string;
  createdAt: string;
}

function summarize(d: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === "" || v === null || v === undefined) continue;
    parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(" · ").slice(0, 300);
}

export default function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const { ok, data } = await api<{ logs: AuditRow[] }>("/api/compliance/audit");
      if (!ok) setError(data.error || "โหลด Audit Log ไม่สำเร็จ");
      else setRows(Array.isArray(data.logs) ? data.logs : []);
      setLoading(false);
    })();
  }, []);

  return (
    <Panel padded={false} title="Audit Log" subtitle="200 รายการล่าสุด — เพิ่มอย่างเดียว แก้ไขหรือลบไม่ได้" className="pb-2">
      {loading ? (
        <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="กำลังโหลด..." />
      ) : error ? (
        <EmptyState title={error} />
      ) : rows.length === 0 ? (
        <EmptyState title="ยังไม่มีรายการ" />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>ผู้ดำเนินการ</TableHead>
                <TableHead>การกระทำ</TableHead>
                <TableHead>รายละเอียด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{r.actorName || r.actorId}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs font-medium text-brand-navy">{AUDIT_ACTION_LABEL[r.action] ?? r.action}</TableCell>
                  <TableCell className="min-w-[220px] text-xs text-gray-600 break-words">{summarize(r.detail)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
