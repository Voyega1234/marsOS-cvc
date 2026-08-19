"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, CheckCircle2, XCircle } from "lucide-react";

import { AUTOMATION_RULES, WEBHOOK_EVENTS, MOCK_WEBHOOK_DELIVERIES } from "./mockData";
import { Switch } from "@/components/ui/switch";
import { MockBadge, SectionCard, StatusPill } from "./shared";

const RULE_STATUS_MAP: Record<string, string> = {
  Healthy: "Active",
  Retrying: "Permission Missing",
  Failed: "Sync Failed",
};

export function WebhooksTab() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    () => Object.fromEntries(AUTOMATION_RULES.map((r) => [r.id, r.enabledDefault]))
  );

  function toggle(id: string, name: string) {
    setEnabled((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      toast.success(`${next[id] ? "เปิด" : "ปิด"} Automation: ${name}`);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <SectionCard title="Automation Rules" description="งานอัตโนมัติที่ทำงานร่วมกับ Website Connection" action={<MockBadge />}>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
                <th className="py-2 pr-4">Automation</th>
                <th className="py-2 pr-4">Trigger</th>
                <th className="py-2 pr-4">Connection</th>
                <th className="py-2 pr-4">Last Run</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {AUTOMATION_RULES.map((rule) => (
                <tr key={rule.id}>
                  <td className="py-2.5 pr-4 text-gray-800 font-medium">{rule.name}</td>
                  <td className="py-2.5 pr-4 text-gray-500 font-mono text-xs">{rule.trigger}</td>
                  <td className="py-2.5 pr-4 text-gray-600">{rule.connection}</td>
                  <td className="py-2.5 pr-4 text-gray-500">{rule.lastRun}</td>
                  <td className="py-2.5 pr-4"><StatusPill status={RULE_STATUS_MAP[rule.status]} /></td>
                  <td className="py-2.5 pr-4">
                    <Switch checked={enabled[rule.id]} onCheckedChange={() => toggle(rule.id, rule.name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Webhook Events">
        <div className="flex flex-wrap gap-2">
          {WEBHOOK_EVENTS.map((event) => (
            <span key={event} className="px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-xs font-mono text-gray-600">
              {event}
            </span>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Delivery Log" description="ประวัติการส่ง Webhook (ตัวอย่าง)" action={<MockBadge />}>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Event</th>
                <th className="py-2 pr-4">Connection</th>
                <th className="py-2 pr-4">Status Code</th>
                <th className="py-2 pr-4">Attempt</th>
                <th className="py-2 pr-4">Signature</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MOCK_WEBHOOK_DELIVERIES.map((d) => (
                <tr key={d.id}>
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">{d.timestamp}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-gray-700">{d.event}</td>
                  <td className="py-2.5 pr-4 text-gray-600">{d.connection}</td>
                  <td className={`py-2.5 pr-4 font-semibold ${d.statusCode >= 200 && d.statusCode < 300 ? "text-emerald-600" : "text-rose-600"}`}>{d.statusCode}</td>
                  <td className="py-2.5 pr-4 text-gray-500">{d.attempt}</td>
                  <td className="py-2.5 pr-4">
                    {d.signatureValid ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium"><CheckCircle2 className="h-3.5 w-3.5" />Valid</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-600 text-xs font-medium"><XCircle className="h-3.5 w-3.5" />Invalid</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          <ShieldCheck className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
          ทุก Webhook ที่เข้ามาจะถูกตรวจสอบ Signature ก่อนประมวลผลเสมอ — Payload ที่ Signature ไม่ถูกต้องจะถูกปฏิเสธและบันทึกลง Log
        </div>
      </SectionCard>
    </div>
  );
}
