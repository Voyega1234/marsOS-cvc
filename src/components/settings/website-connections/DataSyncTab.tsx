"use client";

import { useState } from "react";
import { ChevronRight, CheckSquare, Square } from "lucide-react";

import type { ConnectionRow } from "./types";
import { SYNCED_FIELDS, SYNC_MODES, SYNC_PIPELINE, MOCK_SYNC_RUNS, type SyncRun } from "./mockData";
import { Drawer, Field, MockBadge, SectionCard, StatusPill } from "./shared";

interface Props {
  rows: ConnectionRow[];
}

const RUN_STATUS_MAP: Record<SyncRun["status"], string> = {
  Success: "Active",
  Partial: "Permission Missing",
  Failed: "Sync Failed",
  Running: "Verifying",
};

export function DataSyncTab({ rows }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set(SYNCED_FIELDS));
  const [detailRun, setDetailRun] = useState<SyncRun | null>(null);

  function toggle(field: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <SectionCard title="ข้อมูลที่ Sync จริงจากเว็บไซต์" description="เลือกฟิลด์ที่ต้องการดึงจาก Website Adapter">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {SYNCED_FIELDS.map((field) => {
            const isChecked = checked.has(field);
            return (
              <button
                key={field}
                onClick={() => toggle(field)}
                className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {isChecked ? <CheckSquare className="h-4 w-4 text-indigo-600 flex-shrink-0" /> : <Square className="h-4 w-4 text-gray-300 flex-shrink-0" />}
                <span className="text-sm text-gray-700">{field}</span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Sync Modes">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SYNC_MODES.map((m) => (
            <div key={m.id} className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-brand-navy">{m.label}</p>
              <p className="text-xs text-gray-500 mt-1">{m.desc}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Sync Pipeline">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {SYNC_PIPELINE.map((step, idx) => (
            <div key={step} className="flex items-center gap-1 flex-shrink-0">
              <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700 whitespace-nowrap">
                {step}
              </div>
              {idx < SYNC_PIPELINE.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Sync Runs" description="ประวัติการ Sync (ตัวอย่าง)">
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
                <th className="py-2 pr-4">Run ID</th>
                <th className="py-2 pr-4">Connection</th>
                <th className="py-2 pr-4">Mode</th>
                <th className="py-2 pr-4">Start / End</th>
                <th className="py-2 pr-4">Read / Written / Failed</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MOCK_SYNC_RUNS.map((run) => (
                <tr key={run.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setDetailRun(run)}>
                  <td className="py-2.5 pr-4 font-mono text-xs text-gray-700">{run.id}</td>
                  <td className="py-2.5 pr-4 text-gray-700">{run.connection}</td>
                  <td className="py-2.5 pr-4 text-gray-500">{run.mode}</td>
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">{run.startedAt} → {run.completedAt ?? "…"}</td>
                  <td className="py-2.5 pr-4 text-gray-500">{run.rowsRead} / {run.rowsWritten} / {run.rowsFailed}</td>
                  <td className="py-2.5 pr-4"><StatusPill status={RUN_STATUS_MAP[run.status]} /></td>
                  <td className="py-2.5 pr-4 text-rose-600">{run.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">Connections จริง: {rows.filter((r) => !r.isMock).map((r) => r.name).join(", ") || "ยังไม่มี"}</p>
      </SectionCard>

      <Drawer
        open={!!detailRun}
        onClose={() => setDetailRun(null)}
        title={`Sync Run — ${detailRun?.id ?? ""}`}
        description="รายละเอียดการ Sync (ตัวอย่าง)"
        footer={
          <button onClick={() => setDetailRun(null)} className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm font-semibold text-gray-700">
            ปิด
          </button>
        }
      >
        {detailRun && (
          <div className="space-y-4">
            <MockBadge />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Connection" value={detailRun.connection} />
              <Field label="Mode" value={detailRun.mode} />
              <Field label="Started" value={detailRun.startedAt} />
              <Field label="Completed" value={detailRun.completedAt ?? "กำลังทำงาน"} />
              <Field label="Rows Read" value={detailRun.rowsRead} />
              <Field label="Rows Written" value={detailRun.rowsWritten} />
              <Field label="Rows Failed" value={detailRun.rowsFailed} />
              <Field label="Status" value={<StatusPill status={RUN_STATUS_MAP[detailRun.status]} />} />
            </div>
            <Field label="Error" value={detailRun.error ?? "—"} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
