"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";

import { ENVIRONMENTS, STAGING_WARNINGS, PROMOTE_FLOW_STEPS, CAPABILITY_LABELS } from "./mockData";
import { Field, MockBadge, SectionCard } from "./shared";

export function EnvironmentsTab() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">คำเตือนสำหรับ Staging</p>
          <ul className="mt-1.5 space-y-1">
            {STAGING_WARNINGS.map((w) => (
              <li key={w} className="text-xs text-amber-700">• {w}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {ENVIRONMENTS.map((env) => (
          <div key={env.id} className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-brand-navy">{env.name}</h3>
              <MockBadge />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="URL" value={<span className="font-mono text-xs">{env.url}</span>} />
              <Field label="Connection" value={env.connection} />
              <Field label="Credential Reference" value={<span className="font-mono text-xs">{env.credentialRef}</span>} />
              <Field label="Sync Status" value={env.syncStatus} />
              <Field label="Publish Permission" value={env.publishPermission} />
              <Field label="Last Deploy" value={env.lastDeploy} />
              <Field label="Version" value={env.version} />
              <Field
                label="Capabilities"
                value={
                  env.capabilities.length
                    ? env.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(", ")
                    : "—"
                }
              />
            </div>
            {env.robotsWarning && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {env.robotsWarning}
              </p>
            )}
          </div>
        ))}
      </div>

      <SectionCard title="Promote Flow" description="ลำดับการเลื่อนเนื้อหาจาก Draft ไปสู่ Production">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {PROMOTE_FLOW_STEPS.map((step, idx) => (
            <div key={step} className="flex items-center gap-1 flex-shrink-0">
              <div className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-xs font-medium text-indigo-700 whitespace-nowrap">
                {step}
              </div>
              {idx < PROMOTE_FLOW_STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
