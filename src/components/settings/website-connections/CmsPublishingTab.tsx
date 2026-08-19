"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, CheckCircle2 } from "lucide-react";

import { PUBLISHING_MODES, PUBLISH_FLOW_STEPS, PUBLISH_PROHIBITED } from "./mockData";
import { SectionCard } from "./shared";

export function CmsPublishingTab() {
  const [mode, setMode] = useState(PUBLISHING_MODES.find((m) => m.default)?.id ?? "draft-only");

  const [config, setConfig] = useState({
    defaultAuthor: "System (Content Engine)",
    defaultCategory: "บทความทั่วไป",
    defaultTags: "seo, content",
    defaultStatus: "draft",
    slugPolicy: "kebab-case จาก Primary Keyword",
    timezone: "Asia/Bangkok",
    approvalFlow: "Content Director → SEO Manager",
    rollbackPolicy: "เก็บ Snapshot ก่อน Publish ทุกครั้ง",
  });

  function updateConfig<K extends keyof typeof config>(key: K, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    toast.success("บันทึก Publish Configuration แล้ว (mock)");
  }

  return (
    <div className="space-y-5">
      <SectionCard title="Publishing Modes" description="เลือกโหมดการเผยแพร่เริ่มต้นของ Connection">
        <div className="space-y-2.5">
          {PUBLISHING_MODES.map((m) => (
            <label
              key={m.id}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                m.disabled
                  ? "border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed"
                  : mode === m.id
                  ? "border-indigo-300 bg-indigo-50/50 cursor-pointer"
                  : "border-gray-200 hover:border-gray-300 cursor-pointer"
              }`}
            >
              <input
                type="radio"
                name="publishing-mode"
                checked={mode === m.id}
                disabled={m.disabled}
                onChange={() => setMode(m.id)}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-semibold text-brand-navy">
                  {m.label}
                  {m.default && <span className="ml-2 text-[10px] font-medium text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full">Default</span>}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
                {m.note && <p className="text-xs text-amber-600 mt-1 font-medium">{m.note}</p>}
              </div>
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Publish Flow" description="ลำดับขั้นตอนตั้งแต่ Approved Content จนถึง Measurement">
        <ol className="space-y-0">
          {PUBLISH_FLOW_STEPS.map((step, idx) => (
            <li key={step} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                  {idx + 1}
                </div>
                {idx < PUBLISH_FLOW_STEPS.length - 1 && <div className="w-px flex-1 bg-gray-200 min-h-[16px]" />}
              </div>
              <p className="text-sm text-gray-700 pb-4">{step}</p>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard
        title="Publish Configuration"
        description="ค่าเริ่มต้นสำหรับการสร้าง CMS Draft และ Publish"
        action={
          <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold">
            บันทึก
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([
            ["defaultAuthor", "Default Author"],
            ["defaultCategory", "Default Category"],
            ["defaultTags", "Default Tags"],
            ["defaultStatus", "Default Status"],
            ["slugPolicy", "Slug Policy"],
            ["timezone", "Publish Timezone"],
            ["approvalFlow", "Approval Flow"],
            ["rollbackPolicy", "Rollback Policy"],
          ] as [keyof typeof config, string][]).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
              <input
                value={config[key]}
                onChange={(e) => updateConfig(key, e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-500">
          {["Default Reviewer", "Featured Image Policy", "Meta Field Mapping", "Schema Field Mapping", "CTA Component Mapping", "Internal Link Policy"].map((f) => (
            <div key={f} className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-gray-300" />
              {f} — กำหนดค่าที่ Field Mapping ของแต่ละ Connection
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="bg-white rounded-2xl border-2 border-rose-200 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-rose-100 bg-rose-50">
          <ShieldAlert className="h-4 w-4 text-rose-600" />
          <h2 className="text-sm font-bold text-rose-700">ข้อห้ามในการ Publish</h2>
        </div>
        <ul className="p-6 space-y-2">
          {PUBLISH_PROHIBITED.map((rule) => (
            <li key={rule} className="flex items-start gap-2 text-sm text-rose-700">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />
              {rule}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
