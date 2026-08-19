"use client";

import { toast } from "sonner";
import {
  Globe, CheckCircle2, AlertTriangle, Eye, Rocket, ShieldAlert, RefreshCw,
  Clock, FileWarning, XCircle, ShieldQuestion, Plug, Zap, MapPin, Settings2, ScrollText,
} from "lucide-react";

import type { ConnectionRow, SettingsTabId } from "./types";
import { SectionCard } from "./shared";

interface Props {
  rows: ConnectionRow[];
  onOpenWizard: () => void;
  onGoTo: (tab: SettingsTabId) => void;
}

export function OverviewTab({ rows, onOpenWizard, onGoTo }: Props) {
  const errorStatuses = ["Sync Failed", "Authentication Expired", "Permission Missing"];

  const cards = [
    { label: "Connected Websites", value: rows.length, icon: Globe, tone: "default" as const, mock: false },
    { label: "Active Connections", value: rows.filter((r) => r.status === "Active" || r.status === "Publish Enabled").length, icon: CheckCircle2, tone: "success" as const, mock: false },
    { label: "Connection Errors", value: rows.filter((r) => errorStatuses.includes(r.status)).length, icon: AlertTriangle, tone: "danger" as const, mock: false },
    { label: "Read-only Connections", value: rows.filter((r) => r.status === "Read-only").length, icon: Eye, tone: "default" as const, mock: false },
    { label: "Publish-enabled Connections", value: rows.filter((r) => r.publishCapability).length, icon: Rocket, tone: "success" as const, mock: false },
    { label: "Websites Missing Verification", value: rows.filter((r) => r.verification === "ยังไม่ตรวจสอบ").length, icon: ShieldQuestion, tone: "warning" as const, mock: false },
    { label: "Sync Running", value: 1, icon: RefreshCw, tone: "default" as const, mock: true },
    { label: "Stale Website Data", value: 1, icon: Clock, tone: "warning" as const, mock: true },
    { label: "Articles Waiting for CMS Draft", value: 4, icon: FileWarning, tone: "default" as const, mock: true },
    { label: "Failed Publish", value: 1, icon: XCircle, tone: "danger" as const, mock: true },
    { label: "Verification Failed", value: rows.filter((r) => r.verification === "ตรวจสอบไม่ผ่าน").length, icon: ShieldAlert, tone: "danger" as const, mock: false },
  ];

  const toneClasses: Record<string, string> = {
    default: "bg-gray-50 text-gray-600",
    success: "bg-emerald-50 text-emerald-600",
    warning: "bg-amber-50 text-amber-600",
    danger: "bg-rose-50 text-rose-600",
  };

  const quickActions = [
    { label: "Connect Website", icon: Plug, run: () => onOpenWizard() },
    { label: "Test Connection", icon: Zap, run: () => { toast.message("เปิดหน้า Connections เพื่อเลือก Connection ที่จะ Test"); onGoTo("connections"); } },
    { label: "Sync Website", icon: RefreshCw, run: () => { toast.message("เปิดหน้า Connections เพื่อสั่ง Sync Now"); onGoTo("connections"); } },
    { label: "Map CMS Fields", icon: MapPin, run: () => { toast.message("เปิดหน้า Connections เพื่อ Map Fields"); onGoTo("connections"); } },
    { label: "Configure Publishing", icon: Settings2, run: () => onGoTo("cms-publishing") },
    { label: "View Logs", icon: ScrollText, run: () => onGoTo("logs") },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${toneClasses[c.tone]}`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold text-brand-navy">{c.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
              {c.mock && <p className="text-[10px] text-gray-400 mt-1">ตัวอย่าง</p>}
            </div>
          );
        })}
      </div>

      <SectionCard title="Quick Actions" description="ทางลัดสำหรับงานที่ทำบ่อย">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                onClick={a.run}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 px-3 py-4 text-center transition-colors"
              >
                <Icon className="h-5 w-5 text-indigo-600" />
                <span className="text-xs font-medium text-gray-700 leading-tight">{a.label}</span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="วัตถุประสงค์ของ Website Connections">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
          {[
            "ดึง Page Inventory จริง",
            "ดึง Title, URL, Content Type, Author, Category, Tags และ Media",
            "ตรวจ Internal Link จริง",
            "ตรวจ Existing Content และ Cannibalization",
            "ใช้ข้อมูลเว็บไซต์ใน Article Brief",
            "ส่งบทความเป็น CMS Draft",
            "Publish หลัง Approval",
            "Verify หลัง Publish",
            "เก็บ Rollback Snapshot",
            "เชื่อมบทความกับ Published URL และ Version",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
              {t}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
