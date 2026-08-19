"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Loader2, Zap, RefreshCw, Settings2, MapPin, PauseCircle, PlayCircle,
  Unplug, ScrollText, KeyRound,
} from "lucide-react";

import type { ConnectionRow, SettingsTabId } from "./types";
import { DEFAULT_FIELD_MAPPING, type FieldMappingRow } from "./mockData";
import { Drawer, Field, MockBadge, Modal, StatusPill } from "./shared";

interface Props {
  rows: ConnectionRow[];
  setRows: React.Dispatch<React.SetStateAction<ConnectionRow[]>>;
  onOpenWizard: () => void;
  onGoTo: (tab: SettingsTabId) => void;
}

function CapabilityDot({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${enabled ? "text-emerald-600" : "text-gray-300"}`}>
      {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

export function ConnectionsTab({ rows, setRows, onOpenWizard, onGoTo }: Props) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [configureRow, setConfigureRow] = useState<ConnectionRow | null>(null);
  const [rotateRow, setRotateRow] = useState<ConnectionRow | null>(null);

  function updateRow(id: string, patch: Partial<ConnectionRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function handleTest(row: ConnectionRow) {
    setTestingId(row.id);
    updateRow(row.id, { verification: "กำลังตรวจสอบ" });
    await new Promise((r) => setTimeout(r, 1400));
    setTestingId(null);
    updateRow(row.id, {
      verification: "ตรวจสอบแล้ว",
      status: row.status === "Draft" ? "Active" : row.status,
      error: null,
    });
    toast.success(`Test Connection สำเร็จ: ${row.name}`);
  }

  async function handleSync(row: ConnectionRow) {
    setSyncingId(row.id);
    await new Promise((r) => setTimeout(r, 1600));
    setSyncingId(null);
    updateRow(row.id, { lastSync: "เมื่อสักครู่" });
    toast.success(`Sync Website "${row.name}" เสร็จสมบูรณ์ (mock)`);
  }

  function handlePauseToggle(row: ConnectionRow) {
    const willPause = row.status !== "Paused";
    if (!confirm(willPause ? `Pause connection "${row.name}"?` : `Resume connection "${row.name}"?`)) return;
    updateRow(row.id, { status: willPause ? "Paused" : "Active" });
    toast.success(willPause ? `หยุดชั่วคราว: ${row.name}` : `เปิดใช้งานอีกครั้ง: ${row.name}`);
  }

  function handleDisconnect(row: ConnectionRow) {
    if (!confirm(`ยืนยันยกเลิกการเชื่อมต่อ "${row.name}"? การกระทำนี้จะเปลี่ยนสถานะเป็น Disconnected`)) return;
    updateRow(row.id, { status: "Disconnected" });
    toast.success(`ยกเลิกการเชื่อมต่อแล้ว: ${row.name}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} connections ทั้งหมด</p>
        <button
          onClick={onOpenWizard}
          className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          + Connect Website ใหม่
        </button>
      </div>

      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-brand-navy">{row.name}</h3>
                  {row.isMock && <MockBadge />}
                  <StatusPill status={row.status} />
                  <StatusPill status={row.verification} />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {row.client} · {row.domain} · {row.platform} · {row.environment}
                </p>
                <p className="text-xs text-gray-400 font-mono truncate max-w-md">{row.websiteUrl}</p>
              </div>
              <div className="flex items-center gap-3">
                <CapabilityDot enabled={row.readCapability} label="Read" />
                <CapabilityDot enabled={row.writeCapability} label="Write" />
                <CapabilityDot enabled={row.publishCapability} label="Publish" />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 px-6 py-4 border-b border-gray-100 overflow-x-auto">
              <Field label="Permission Mode" value={row.permissionMode} />
              <Field label="Last Sync" value={row.lastSync} />
              <Field label="Next Sync" value={row.nextSync} />
              <Field label="Pages" value={row.pageCount} />
              <Field label="Media" value={row.mediaCount} />
              <Field label="Authors" value={row.authors} />
              <Field label="Connector Version" value={row.connectorVersion} />
              <Field label="Created By" value={row.createdBy} />
              <Field label="Error" value={row.error ? <span className="text-rose-600">{row.error}</span> : "—"} />
            </div>

            <div className="flex flex-wrap items-center gap-2 px-6 py-3">
              <button
                onClick={() => handleTest(row)}
                disabled={testingId === row.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 disabled:opacity-50"
              >
                {testingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Test
              </button>
              <button
                onClick={() => handleSync(row)}
                disabled={syncingId === row.id || row.status === "Paused" || row.status === "Disconnected"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 disabled:opacity-50"
              >
                {syncingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync Now
              </button>
              <button
                onClick={() => setConfigureRow(row)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Configure
              </button>
              <button
                onClick={() => setConfigureRow(row)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700"
              >
                <MapPin className="h-3.5 w-3.5" />
                Map Fields
              </button>
              <button
                onClick={() => handlePauseToggle(row)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700"
              >
                {row.status === "Paused" ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                {row.status === "Paused" ? "Resume" : "Pause"}
              </button>
              <button
                onClick={() => handleDisconnect(row)}
                disabled={row.status === "Disconnected"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold disabled:opacity-50"
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </button>
              <button
                onClick={() => onGoTo("logs")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700"
              >
                <ScrollText className="h-3.5 w-3.5" />
                View Logs
              </button>
              <button
                onClick={() => setRotateRow(row)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Rotate Credential
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfigureDrawer row={configureRow} onClose={() => setConfigureRow(null)} />
      <RotateCredentialModal row={rotateRow} onClose={() => setRotateRow(null)} />
    </div>
  );
}

// ─── Configure / Field Mapping drawer ───────────────────────────────────────

function ConfigureDrawer({ row, onClose }: { row: ConnectionRow | null; onClose: () => void }) {
  const [mapping, setMapping] = useState<FieldMappingRow[]>(DEFAULT_FIELD_MAPPING);

  function updateSource(idx: number, value: string) {
    setMapping((prev) => prev.map((m, i) => (i === idx ? { ...m, sourceField: value } : m)));
  }

  function handleSave() {
    toast.success(`บันทึก Field Mapping ของ "${row?.name}" แล้ว (mock)`);
    onClose();
  }

  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      title={`Configure / Map Fields — ${row?.name ?? ""}`}
      description="Two-column Field Mapping ระหว่าง CMS Field กับ Source Field"
      widthClassName="max-w-xl"
      footer={
        <>
          <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
            บันทึก Mapping
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-500 hover:text-gray-700 text-sm">
            ยกเลิก
          </button>
        </>
      }
    >
      {row?.isMock && <MockBadge className="mb-3" />}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1">
          <span>CMS Field</span>
          <span>Source Field</span>
        </div>
        {mapping.map((m, idx) => (
          <div key={m.cmsField} className="grid grid-cols-2 gap-2 items-center">
            <span className="text-sm text-gray-800">{m.cmsField}</span>
            <input
              value={m.sourceField}
              onChange={(e) => updateSource(idx, e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        ))}
      </div>
    </Drawer>
  );
}

// ─── Rotate credential — secure flow stub ──────────────────────────────────

function RotateCredentialModal({ row, onClose }: { row: ConnectionRow | null; onClose: () => void }) {
  function handleConfirm() {
    toast.success(`เริ่มกระบวนการ Rotate Credential ของ "${row?.name}" ผ่าน Secure Flow (mock)`);
    onClose();
  }
  return (
    <Modal open={!!row} onClose={onClose} widthClassName="max-w-md">
      <div className="p-6 space-y-4">
        <h3 className="text-base font-bold text-brand-navy">Rotate Credential — {row?.name}</h3>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Secret ถูกเก็บฝั่ง Server แบบเข้ารหัส — จะไม่แสดงอีก การหมุนเวียน Credential จะสร้างค่าใหม่ฝั่ง Server
          และเพิกถอนค่าเดิมทันที ระบบจะไม่แสดง Secret บน Front-end ไม่ว่ากรณีใด
        </div>
        <p className="text-sm text-gray-500">
          หลังยืนยัน ระบบจะสร้าง Application Password / Token ใหม่ฝั่ง Server และแจ้งผู้ดูแลให้ตั้งค่าใหม่ในแหล่งข้อมูลปลายทาง
        </p>
        <div className="flex items-center gap-2 pt-2">
          <button onClick={handleConfirm} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
            ยืนยัน Rotate
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-500 hover:text-gray-700 text-sm">
            ยกเลิก
          </button>
        </div>
      </div>
    </Modal>
  );
}
