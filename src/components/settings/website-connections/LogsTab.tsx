"use client";

import { useMemo, useState } from "react";

import type { ConnectionRow } from "./types";
import { MOCK_AUDIT_LOG, type AuditLogEntry } from "./mockData";
import { Drawer, Field, MockBadge, SectionCard, StatusPill } from "./shared";

interface Props {
  rows: ConnectionRow[];
}

const RESULT_STATUS_MAP: Record<AuditLogEntry["result"], string> = {
  Success: "Active",
  Failed: "Sync Failed",
  Blocked: "Permission Missing",
};

export function LogsTab({ rows }: Props) {
  const [connectionFilter, setConnectionFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  const connections = useMemo(() => Array.from(new Set([...rows.map((r) => r.name), ...MOCK_AUDIT_LOG.map((l) => l.connection)])), [rows]);
  const actions = useMemo(() => Array.from(new Set(MOCK_AUDIT_LOG.map((l) => l.action))), []);

  const filtered = MOCK_AUDIT_LOG.filter((l) => {
    if (connectionFilter !== "all" && l.connection !== connectionFilter) return false;
    if (actionFilter !== "all" && l.action !== actionFilter) return false;
    if (resultFilter !== "all" && l.result !== resultFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <SectionCard title="Logs & Audit" description="รวม Sync, Publish, Webhook, Permission Log" action={<MockBadge />}>
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={connectionFilter}
            onChange={(e) => setConnectionFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="all">ทุก Connection</option>
            {connections.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="all">ทุก Action</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="all">ทุกผลลัพธ์</option>
            <option value="Success">Success</option>
            <option value="Failed">Failed</option>
            <option value="Blocked">Blocked</option>
          </select>
        </div>

        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Connection</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Result</th>
                <th className="py-2 pr-4">Run ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((log) => (
                <tr key={log.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setDetail(log)}>
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">{log.timestamp}</td>
                  <td className="py-2.5 pr-4 text-gray-700">{log.actor}</td>
                  <td className="py-2.5 pr-4 text-gray-600">{log.connection}</td>
                  <td className="py-2.5 pr-4 text-gray-700">{log.action}</td>
                  <td className="py-2.5 pr-4"><StatusPill status={RESULT_STATUS_MAP[log.result]} /></td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-gray-500">{log.runId ?? "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm">ไม่พบรายการที่ตรงกับตัวกรอง</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title="รายละเอียด Log"
        description={detail?.id}
        footer={
          <button onClick={() => setDetail(null)} className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm font-semibold text-gray-700">
            ปิด
          </button>
        }
      >
        {detail && (
          <div className="space-y-4">
            <MockBadge />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Timestamp" value={detail.timestamp} />
              <Field label="Actor" value={detail.actor} />
              <Field label="Connection" value={detail.connection} />
              <Field label="Action" value={detail.action} />
              <Field label="Result" value={<StatusPill status={RESULT_STATUS_MAP[detail.result]} />} />
              <Field label="Run ID" value={detail.runId ?? "—"} />
            </div>
            <Field label="รายละเอียด" value={detail.detail} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
